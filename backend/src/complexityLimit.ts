import {
  GraphQLError,
  Kind,
  type FragmentDefinitionNode,
  type SelectionSetNode,
  type ValidationRule,
} from 'graphql';

export interface ComplexityLimits {
  /** Maks antall rotfelt (aliaser teller hver for seg: `a: search`, `b: search` er to). */
  maxRootFields: number;
  /** Maks antall felt totalt i én operasjon, fragmenter ekspandert og aliaser talt hver for seg. */
  maxFields: number;
}

/**
 * Dybdegrensen stopper bare nøsting. Én flat spørring med hundrevis av aliasede `search(...)`
 * (hver gir en egen SQL-spørring) eller `posterUrl`/`overview` (TMDB-oppslag) er grunn, men dyr.
 * Denne regelen teller derfor felt: rotfelt for seg (det er dem som starter databasekall), og alle
 * felt totalt (det som bestemmer størrelsen på svaret og antall resolver-kall).
 *
 * Grensene er satt godt over de største spørringene frontend sender (se operations.ts: Title-
 * detaljene er størst), slik at vanlig bruk aldri kommer i nærheten.
 */
export function complexityLimit({ maxRootFields, maxFields }: ComplexityLimits): ValidationRule {
  return (context) => ({
    OperationDefinition(operation) {
      const fragments = new Map<string, FragmentDefinitionNode>();
      for (const def of context.getDocument().definitions) {
        if (def.kind === Kind.FRAGMENT_DEFINITION) fragments.set(def.name.value, def);
      }

      // Memoisert per fragment: uten dette kan et dokument der fragment A bruker B ti ganger, B
      // bruker C ti ganger osv. få oss til å traversere eksponentielt mange noder bare for å telle.
      const memo = new Map<string, number>();
      const countSet = (set: SelectionSetNode, visiting: Set<string>): number => {
        let n = 0;
        for (const sel of set.selections) {
          if (sel.kind === Kind.FIELD) {
            // Introspeksjon har egen regel (slått av i produksjon) og er stor av natur.
            if (sel.name.value === '__schema' || sel.name.value === '__type') continue;
            n += 1 + (sel.selectionSet ? countSet(sel.selectionSet, visiting) : 0);
          } else if (sel.kind === Kind.INLINE_FRAGMENT) {
            n += countSet(sel.selectionSet, visiting);
          } else {
            const name = sel.name.value;
            const frag = fragments.get(name);
            // Sirkulære fragmenter fanges av NoFragmentCycles; her må vi bare ikke løpe i ring.
            if (!frag || visiting.has(name)) continue;
            let c = memo.get(name);
            if (c === undefined) {
              visiting.add(name);
              c = countSet(frag.selectionSet, visiting);
              visiting.delete(name);
              memo.set(name, c);
            }
            n += c;
          }
        }
        return n;
      };

      const rootFields = (set: SelectionSetNode, visiting: Set<string>): number => {
        let n = 0;
        for (const sel of set.selections) {
          if (sel.kind === Kind.FIELD) {
            if (sel.name.value !== '__schema' && sel.name.value !== '__type') n++;
          } else if (sel.kind === Kind.INLINE_FRAGMENT) {
            n += rootFields(sel.selectionSet, visiting);
          } else {
            const name = sel.name.value;
            const frag = fragments.get(name);
            if (!frag || visiting.has(name)) continue;
            visiting.add(name);
            n += rootFields(frag.selectionSet, visiting);
            visiting.delete(name);
          }
        }
        return n;
      };

      const roots = rootFields(operation.selectionSet, new Set());
      if (roots > maxRootFields) {
        context.reportError(
          new GraphQLError(
            `Spørringen har for mange rotfelt (${roots}); maks tillatt er ${maxRootFields}. ` +
              'Del den opp i flere forespørsler.',
            { nodes: [operation], extensions: { code: 'BAD_USER_INPUT' } },
          ),
        );
        return;
      }
      const total = countSet(operation.selectionSet, new Set());
      if (total > maxFields) {
        context.reportError(
          new GraphQLError(
            `Spørringen er for omfattende (${total} felt); maks tillatt er ${maxFields}. ` +
              'Be om færre felt eller del den opp.',
            { nodes: [operation], extensions: { code: 'BAD_USER_INPUT' } },
          ),
        );
      }
    },
  });
}
