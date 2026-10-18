// Limits on how big a GraphQL query may be, checked during validation, i.e.
// before any resolver or database query runs.
//
// GraphQL lets clients shape their own queries, which can be abused: aliases
// can repeat an expensive field hundreds of times in one request
// ({ a1: tickets { … } a2: tickets { … } … }), and nesting can explode.

import type { ASTNode, FragmentDefinitionNode, SelectionSetNode, ValidationContext } from "graphql";
import { createGraphQLError, type Plugin } from "graphql-yoga";

export const LIMITS = {
  // Top-level fields per operation, counting aliases: stops alias floods.
  rootFields: 10,
  // Fields selected in total across the whole query.
  totalFields: 200,
  // Nesting depth (e.g. tickets → nodes → comments → author → name is 5).
  depth: 8,
};

interface Measure {
  fields: number;
  depth: number;
}

// Walks a selection set, following fragments, counting fields and depth.
function measure(
  set: SelectionSetNode,
  getFragment: (name: string) => FragmentDefinitionNode | null | undefined,
  depth: number,
  seen: Set<string>,
): Measure {
  let fields = 0;
  let maxDepth = depth;
  for (const selection of set.selections) {
    if (selection.kind === "Field") {
      fields++;
      if (selection.selectionSet) {
        const inner = measure(selection.selectionSet, getFragment, depth + 1, seen);
        fields += inner.fields;
        maxDepth = Math.max(maxDepth, inner.depth);
      } else {
        maxDepth = Math.max(maxDepth, depth);
      }
    } else if (selection.kind === "InlineFragment") {
      const inner = measure(selection.selectionSet, getFragment, depth, seen);
      fields += inner.fields;
      maxDepth = Math.max(maxDepth, inner.depth);
    } else if (selection.kind === "FragmentSpread") {
      // Guard against fragments that include themselves.
      if (seen.has(selection.name.value)) continue;
      const fragment = getFragment(selection.name.value);
      if (!fragment) continue;
      const inner = measure(fragment.selectionSet, getFragment, depth, new Set([...seen, selection.name.value]));
      fields += inner.fields;
      maxDepth = Math.max(maxDepth, inner.depth);
    }
  }
  return { fields, depth: maxDepth };
}

function limitsRule(context: ValidationContext) {
  const report = (message: string, node: ASTNode) =>
    // Built with Yoga's helper (not "new GraphQLError"): see server.ts.
    context.reportError(createGraphQLError(message, { nodes: [node], extensions: { code: "QUERY_TOO_COMPLEX" } }) as never);

  return {
    OperationDefinition(node: import("graphql").OperationDefinitionNode) {
      // Introspection (__schema, __type) only describes the schema from
      // memory, never touching the database. GraphiQL's own introspection
      // query is deeper than our limit, so pure introspection is exempt.
      const introspectionOnly = node.selectionSet.selections.every(
        (sel) => sel.kind === "Field" && sel.name.value.startsWith("__"),
      );
      if (introspectionOnly) return;

      const rootFields = node.selectionSet.selections.length;
      if (rootFields > LIMITS.rootFields) {
        report(`Too many top-level fields (${rootFields}); the limit is ${LIMITS.rootFields}`, node);
        return;
      }
      const { fields, depth } = measure(node.selectionSet, (name) => context.getFragment(name), 1, new Set());
      if (fields > LIMITS.totalFields) report(`Query selects too many fields (${fields}); the limit is ${LIMITS.totalFields}`, node);
      if (depth > LIMITS.depth) report(`Query is too deeply nested (${depth} levels); the limit is ${LIMITS.depth}`, node);
    },
  };
}

export const queryLimits: Plugin = {
  onValidate({ addValidationRule }) {
    addValidationRule(limitsRule as never);
  },
};
