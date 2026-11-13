import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const input = createInterface({ input: stdin, output: stdout });
try {
  const password = await input.question("Admin password: ");
  if (password.length === 0) throw new Error("Password cannot be empty.");

  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  console.log(`scrypt$${salt}$${hash}`);
} finally {
  input.close();
}
