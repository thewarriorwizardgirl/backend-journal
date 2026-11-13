import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import test from "node:test";
import {
  createAdminSession,
  verifyAdminPassword,
  verifyAdminSession,
} from "../src/auth.js";

test("admin sessions are signed and password hashes are verified", () => {
  process.env.SESSION_SECRET = randomBytes(32).toString("hex");
  const salt = randomBytes(16).toString("hex");
  const password = "test-password";
  process.env.ADMIN_PASSWORD_HASH =
    `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;

  const session = createAdminSession("admin@example.com");
  assert.equal(verifyAdminSession(session), true);
  assert.equal(verifyAdminSession(`${session}tampered`), false);
  assert.equal(verifyAdminPassword(password), true);
  assert.equal(verifyAdminPassword("wrong-password"), false);
});
