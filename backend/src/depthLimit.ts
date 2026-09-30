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

      const depthOf = (set: SelectionSetNode, level: number, visiting: Set<string>): number => {
        let deepest = level;
        for (const sel of set.selections) {
          if (sel.kind === Kind.FIELD) {
            if (sel.name.value === '__schema' || sel.name.value === '__type') continue;
            const d = sel.selectionSet ? depthOf(sel.selectionSet, level + 1, visiting) : level;
            deepest = Math.max(deepest, d);
          } else if (sel.kind === Kind.INLINE_FRAGMENT) {
            deepest = Math.max(deepest, depthOf(sel.selectionSet, level, visiting));
          } else {
            const name = sel.name.value;
            const frag = fragments.get(name);
            // Sirkulære fragmenter fanges av NoFragmentCycles; her må vi bare ikke løpe i ring.
            if (!frag || visiting.has(name)) continue;
            visiting.add(name);
            deepest = Math.max(deepest, depthOf(frag.selectionSet, level, visiting));
            visiting.delete(name);
          }
        }
        return deepest;
      };

      const depth = depthOf(operation.selectionSet, 0, new Set());
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
