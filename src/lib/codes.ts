import { randomInt } from "node:crypto";

// No 0/O or 1/I/L, so codes are easy to read aloud and type.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

// A join code like "K7QM-3XPA": 31^8 ≈ 850 billion possibilities, from a
// cryptographically secure random source.
export function generateJoinCode(): string {
  const char = () => ALPHABET[randomInt(ALPHABET.length)];
  const part = () => Array.from({ length: 4 }, char).join("");
  return `${part()}-${part()}`;
}

// "Sunrise Hostel, Block A!" → "sunrise-hostel-block-a"
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // drop accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "");
}

// True if `err` is PostgreSQL's "duplicate value" error for the given
// constraint. Drizzle wraps database errors, keeping the original as `cause`.
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  const pgError = (err as { cause?: { code?: string; constraint?: string } })?.cause;
  return pgError?.code === "23505" && pgError.constraint === constraint;
}
