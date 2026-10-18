// The GraphQL endpoint (/graphql), served by GraphQL Yoga inside Express.

import type { Request, Response } from "express";
import { createGraphQLError, createYoga, maskError } from "graphql-yoga";
import { isProduction } from "../config/env.js";
import { HttpError } from "../middleware/errors.js";
import { findSessionUser } from "../modules/auth/auth.service.js";
import { builder, type GraphQLContext } from "./builder.js";
import { createLoaders } from "./loaders.js";
import "./types.js"; // registers the types and queries on the builder

const BEARER_RE = /^Bearer ([A-Za-z0-9_-]{20,200})$/i;

export const schema = builder.toSchema();

// GraphQL wraps errors thrown in resolvers ("originalError"); look through
// the wrappers for one of our expected errors. Duck-typed on purpose (see above).
function findHttpError(error: unknown): HttpError | null {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if (current instanceof HttpError) return current;
    current = (current as { originalError?: unknown; cause?: unknown }).originalError ?? (current as { cause?: unknown }).cause;
  }
  return null;
}

export const yoga = createYoga<{ req: Request; res: Response }, GraphQLContext>({
  schema,
  graphqlEndpoint: "/graphql",
  // The query explorer (GraphiQL) in development only.
  graphiql: !isProduction,
  // CORS is handled by the app's own middleware (CORS_ORIGINS).
  cors: false,
  // Same login as REST: Authorization: Bearer <session token>.
  context: async ({ request }): Promise<GraphQLContext> => {
    const match = BEARER_RE.exec(request.headers.get("authorization") ?? "");
    const auth = match ? await findSessionUser(match[1]!) : null;
    // Fresh loaders per request: batching and caching never cross users.
    return { auth, loaders: auth ? createLoaders(auth) : null };
  },
  maskedErrors: {
    // Expected errors (HttpError from the shared services) keep their message
    // and code. Anything unexpected is hidden, as in the REST error handler.
    maskError(error, message, isDev) {
      const expected = findHttpError(error);
      if (expected) {
        const located = error as { path?: readonly (string | number)[] };
        // Built with Yoga's own helper, never "new GraphQLError" from our code:
        // with two copies of the graphql package loaded (as happens under the
        // test runner), errors from the "other" copy fail Yoga's checks.
        return createGraphQLError(expected.message, {
          ...(located.path && { path: located.path }),
          extensions: {
            code: expected.code,
            ...(expected.details !== undefined && { details: expected.details }),
          },
        });
      }
      return maskError(error, message, isDev);
    },
  },
});
