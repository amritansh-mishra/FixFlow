// Set or reset a user's password from the terminal.
//
//   npm run user:set-password -- --org <organization-slug> --email <email>
//
// The password is typed at a hidden prompt, so it never appears on screen,
// in shell history, or in any file. Setting a password logs the user out of
// every device.

import { parseArgs } from "node:util";
import { pool } from "../db/index.js";
import { newPasswordSchema } from "../modules/auth/auth.schemas.js";
import { setUserPassword } from "../modules/auth/auth.service.js";

// Reads a line from the terminal without echoing the characters.
function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return Promise.reject(new Error("Run this in an interactive terminal so the password can be typed hidden."));
  }
  return new Promise((resolve, reject) => {
    let input = "";
    const finish = (fn: () => void) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
      fn();
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") return finish(() => resolve(input));
        if (char === "\u0003") return finish(() => reject(new Error("Cancelled"))); // Ctrl+C
        if (char === "\u007f" || char === "\b") input = input.slice(0, -1); // Backspace
        else input += char;
      }
    };
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function main() {
  const { values } = parseArgs({
    options: { org: { type: "string" }, email: { type: "string" } },
  });
  if (!values.org || !values.email) {
    throw new Error("Usage: npm run user:set-password -- --org <organization-slug> --email <email>");
  }

  const password = await promptHidden("New password: ");
  const check = newPasswordSchema.safeParse(password);
  if (!check.success) throw new Error(check.error.issues[0]!.message);
  if ((await promptHidden("Repeat password: ")) !== password) {
    throw new Error("Passwords don't match");
  }

  const found = await setUserPassword(values.org, values.email, password);
  if (!found) throw new Error(`No user with that email in organization "${values.org}"`);
  console.log("Password set. Any existing sessions for this user were logged out.");
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
