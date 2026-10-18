// The Pothos schema builder: GraphQL types are defined in TypeScript, so the
// compiler checks that every resolver returns what its type promises.

import SchemaBuilder from "@pothos/core";
import type { AuthContext } from "../middleware/auth.js";
import { HttpError } from "../middleware/errors.js";

export interface GraphQLContext {
  // null when the request has no valid session token.
  auth: AuthContext | null;
}

export const builder = new SchemaBuilder<{
  Context: GraphQLContext;
  Scalars: { DateTime: { Input: Date; Output: Date } };
}>({});

// Timestamps travel as ISO 8601 strings, e.g. "2026-10-18T12:00:00.000Z".
builder.scalarType("DateTime", {
  serialize: (value) => value.toISOString(),
  parseValue: (value) => {
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) throw new TypeError("Invalid DateTime");
    return date;
  },
});

// Every field except the schema itself needs a logged-in user. Resolvers
// throw the app's own HttpError (as the REST API does); server.ts turns it
// into a GraphQL error with the same code.
export function requireAuth(ctx: GraphQLContext): AuthContext {
  if (!ctx.auth) {
    throw new HttpError(401, "UNAUTHENTICATED", "Log in and send your token as 'Authorization: Bearer <token>'");
  }
  return ctx.auth;
}

builder.queryType({});
