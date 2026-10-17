// Password hashing with scrypt (built into Node.js).
//
// scrypt is deliberately slow and memory-hungry, so an attacker who steals the
// users table can only try a few guesses per second per password, not billions.
// Every password gets its own random salt, so two users with the same password
// get different hashes.
//
// Stored format:  scrypt$N$r$p$<salt base64>$<hash base64>
// Keeping the parameters in the string lets us raise them later without
// breaking existing hashes.

import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// OWASP-recommended scrypt settings (N=2^15, r=8, p=3).
const PARAMS = { N: 2 ** 15, r: 8, p: 3 };
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
// scrypt needs 128 * N * r bytes (32 MiB here); Node's default cap is 32 MiB.
const MAX_MEMORY = 64 * 1024 * 1024;

function scryptAsync(password: string, salt: Buffer, keyLength: number, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) => {
    // NFKC makes visually identical Unicode passwords hash the same way.
    scrypt(password.normalize("NFKC"), salt, keyLength, { ...options, maxmem: MAX_MEMORY }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await scryptAsync(password, salt, KEY_LENGTH, PARAMS);
  const { N, r, p } = PARAMS;
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, N, r, p, salt, hash] = stored.split("$");
  if (algorithm !== "scrypt" || !N || !r || !p || !salt || !hash) return false;

  const expected = Buffer.from(hash, "base64");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64"), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  // Constant-time comparison: takes the same time however many bytes match,
  // so response timing reveals nothing about the hash.
  return timingSafeEqual(actual, expected);
}
