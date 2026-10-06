import {
  GraphQLError,
  Kind,
  type ArgumentNode,
  type FieldNode,
  type FragmentDefinitionNode,
  type OperationDefinitionNode,
  type SelectionSetNode,
  type ValidationRule,
} from 'graphql';

export interface ComplexityLimits {
  /** Maks antall rotfelt (aliaser teller hver for seg: `a: search`, `b: search` er to). */
  maxRootFields: number;
  /** Maks antall felt totalt i én operasjon, fragmenter ekspandert og aliaser talt hver for seg. */
  maxFields: number;
  /** Maks vektet kostnad: feltene under en liste teller `first` ganger (se `LIST_FIELDS`). */
  maxCost: number;
}

/**
 * Listefeltene (Relay-forbindelser) og standard sidestørrelse når `first` utelates. Navnene er
 * hardkodet i stedet for å slås opp i skjemaet for å holde regelen enkel; nye forbindelser må
 * legges til her.
 */
export const LIST_FIELDS: Record<string, number> = { search: 20, myList: 20, reviews: 10 };
/** Tak for `first` (samme som MAX_FIRST i validation.ts), brukt når `first` er en variabel. */
const MAX_FIRST_ASSUMED = 50;

/**
 * Dybdegrensen stopper bare nøsting. Én flat spørring med hundrevis av aliasede `search(...)`
 * (hver gir en egen SQL-spørring) eller `posterUrl`/`overview` (TMDB-oppslag) er grunn, men dyr,
 * og `first: 50` på nøstede lister multipliserer arbeidet. Regelen teller derfor tre ting:
 *  - rotfelt (det er dem som starter databasekall),
 *  - alle felt totalt (størrelsen på svaret og antall resolver-kall),
 *  - vektet kostnad: et listefelt koster `first` ganger feltene under seg. En variabel `first`
 *    regnes som 50 (verste tilfelle) siden verdien ikke er kjent ved validering. Det overvurderer
 *    litt (totalCount og pageInfo telles også ganger `first`), som er trygt.
 *
 * Grensene er satt godt over de største spørringene frontend sender (se operations.ts og
 * vaktbikkjetestene i test/server.test.ts), slik at vanlig bruk aldri kommer i nærheten.
 */
export function complexityLimit({
  maxRootFields,
  maxFields,
  maxCost,
}: ComplexityLimits): ValidationRule {
  return (context) => ({
    OperationDefinition(operation) {
      const fragments = new Map<string, FragmentDefinitionNode>();
      for (const def of context.getDocument().definitions) {
        if (def.kind === Kind.FRAGMENT_DEFINITION) fragments.set(def.name.value, def);
      }

      // Alt memoiseres per fragment. Uten det kan en kjede der hvert nivå spres ti ganger i det
      // neste (F0 -> 10 x F1 -> 10 x F2 ...) gi eksponentielt mange besøk, og dermed CPU-DoS under
      // selve valideringen (et dokument på under 1 kB tok minutter).
      interface Counts {
        roots: number;
        fields: number;
        cost: number;
      }
      const memo = new Map<string, Counts>();
      const visitFragment = (name: string, visiting: Set<string>): Counts | null => {
        const frag = fragments.get(name);
        // Sirkulære fragmenter fanges av NoFragmentCycles; her må vi bare ikke løpe i ring.
        if (!frag || visiting.has(name)) return null;
        let c = memo.get(name);
        if (!c) {
          visiting.add(name);
          c = count(frag.selectionSet, visiting);
          visiting.delete(name);
          memo.set(name, c);
        }
        return c;
      };

      const count = (set: SelectionSetNode, visiting: Set<string>): Counts => {
        const total: Counts = { roots: 0, fields: 0, cost: 0 };
        for (const sel of set.selections) {
          if (sel.kind === Kind.FIELD) {
            // Introspeksjon har egen regel (slått av i produksjon) og er stor av natur.
            if (sel.name.value === '__schema' || sel.name.value === '__type') continue;
            const sub = sel.selectionSet ? count(sel.selectionSet, visiting) : null;
            const mult = sub ? multiplier(sel, operation) : 1;
            total.roots += 1;
            total.fields += 1 + (sub?.fields ?? 0);
            total.cost += 1 + mult * (sub?.cost ?? 0);
          } else {
            const c =
              sel.kind === Kind.INLINE_FRAGMENT
                ? count(sel.selectionSet, visiting)
                : visitFragment(sel.name.value, visiting);
            if (!c) continue;
            total.roots += c.roots;
            total.fields += c.fields;
            total.cost += c.cost;
          }
        }
        return total;
      };

      const { roots, fields, cost } = count(operation.selectionSet, new Set());
      const fail = (message: string) =>
        context.reportError(
          new GraphQLError(message, {
            nodes: [operation],
            extensions: { code: 'BAD_USER_INPUT' },
          }),
        );
      if (roots > maxRootFields) {
        fail(
          `Spørringen har for mange rotfelt (${roots}); maks tillatt er ${maxRootFields}. ` +
            'Del den opp i flere forespørsler.',
        );
      } else if (fields > maxFields) {
        fail(
          `Spørringen er for omfattende (${fields} felt); maks tillatt er ${maxFields}. ` +
            'Be om færre felt eller del den opp.',
        );
      } else if (cost > maxCost) {
        fail(
          `Spørringen er for kostbar (${Math.round(cost)}); maks tillatt er ${maxCost}. ` +
            'Be om færre elementer per side (first) eller færre felt.',
        );
      }
    },
  });
}

/** Hvor mange ganger feltene under et listefelt kan gjentas. 1 for alt som ikke er en liste. */
function multiplier(field: FieldNode, operation: OperationDefinitionNode): number {
  const fallback = LIST_FIELDS[field.name.value];
  if (fallback === undefined) return 1;
  const first = field.arguments?.find((a: ArgumentNode) => a.name.value === 'first');
  if (!first) return fallback;
  if (first.value.kind === Kind.INT) return Math.max(1, Number.parseInt(first.value.value, 10));
  if (first.value.kind === Kind.VARIABLE) {
    // Bruk variabelens standardverdi hvis den har en; ellers verste tilfelle.
    const def = operation.variableDefinitions?.find(
      (v) => v.variable.name.value === (first.value as { name: { value: string } }).name.value,
    );
    if (def?.defaultValue?.kind === Kind.INT) {
      return Math.max(1, Number.parseInt(def.defaultValue.value, 10));
    }
    return MAX_FIRST_ASSUMED;
  }
  return MAX_FIRST_ASSUMED;
}
