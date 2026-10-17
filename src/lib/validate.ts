import type { z } from "zod";
import { HttpError } from "../middleware/errors.js";

// Validates untrusted input (body, query, params) against a Zod schema.
// Returns the parsed, typed value, or throws a 400 listing every problem.
export function validate<S extends z.ZodType>(schema: S, input: unknown, label: string): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    throw new HttpError(400, "VALIDATION_ERROR", `Invalid ${label}`, details);
  }
  return result.data;
}
