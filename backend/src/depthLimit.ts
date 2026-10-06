import {
  GraphQLError,
  Kind,
  type FragmentDefinitionNode,
  type SelectionSetNode,
  type ValidationRule,
} from 'graphql';

/**
 * Validerer at ingen spørring nøster dypere enn `max` nivåer (rotfeltet er nivå 0, som i
 * `graphql-depth-limit`). Dagens skjema kan ikke nøstes dypere enn 6, så regelen er et
 * vern mot at en fremtidig sirkulær relasjon (f.eks. Review.title) åpner for dyre spørringer.
 * Introspeksjon (__schema/__type) er dyp av natur og hoppes over; den slås av separat i produksjon.
 */
export function depthLimit(max: number): ValidationRule {
  return (context) => ({
    OperationDefinition(operation) {
      const fragments = new Map<string, FragmentDefinitionNode>();
      for (const def of context.getDocument().definitions) {
        if (def.kind === Kind.FRAGMENT_DEFINITION) fragments.set(def.name.value, def);
      }

      // Dybden regnes relativt til utvalget og memoiseres per fragment. Uten memoisering kan en
      // fragmentkjede der hvert nivå spres ti ganger i det neste (F0 -> 10 x F1 -> ...) gi
      // eksponentielt mange besøk, og dermed CPU-DoS under selve valideringen.
      const memo = new Map<string, number>();
      const heightOf = (set: SelectionSetNode, visiting: Set<string>): number => {
        let deepest = 0;
        for (const sel of set.selections) {
          if (sel.kind === Kind.FIELD) {
            if (sel.name.value === '__schema' || sel.name.value === '__type') continue;
            const d = sel.selectionSet ? 1 + heightOf(sel.selectionSet, visiting) : 0;
            deepest = Math.max(deepest, d);
          } else if (sel.kind === Kind.INLINE_FRAGMENT) {
            deepest = Math.max(deepest, heightOf(sel.selectionSet, visiting));
          } else {
            const name = sel.name.value;
            const frag = fragments.get(name);
            // Sirkulære fragmenter fanges av NoFragmentCycles; her må vi bare ikke løpe i ring.
            if (!frag || visiting.has(name)) continue;
            let h = memo.get(name);
            if (h === undefined) {
              visiting.add(name);
              h = heightOf(frag.selectionSet, visiting);
              visiting.delete(name);
              memo.set(name, h);
            }
            deepest = Math.max(deepest, h);
          }
        }
        return deepest;
      };

      const depth = heightOf(operation.selectionSet, new Set());
      if (depth > max) {
        context.reportError(
          new GraphQLError(`Spørringen er for dyp (${depth}); maks tillatt dybde er ${max}.`, {
            nodes: [operation],
            extensions: { code: 'BAD_USER_INPUT' },
          }),
        );
      }
    },
  });
}
