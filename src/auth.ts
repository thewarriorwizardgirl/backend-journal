import {
  createHmac,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { RequestHandler } from "express";

const SESSION_COOKIE = "journal_admin_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 8;

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }
  return secret;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer);
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret())
    .update(payload)
    .digest("base64url");
}

function getCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return undefined;

  for (const cookie of cookieHeader.split(";")) {
    const [key, ...value] = cookie.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

function cookieOptions(maxAge: number): string {
  const secure = process.env.NODE_ENV === "production";
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    secure ? "SameSite=None" : "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
    `Max-Age=${maxAge}`,
  ].join("; ");
}

export function createAdminSession(email: string): string {
  const payload = Buffer.from(JSON.stringify({
    email,
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS,
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyAdminSession(token: string): boolean {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return false;

  try {
    if (!safeEqual(sign(payload), signature)) return false;
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: unknown;
      expiresAt?: unknown;
    };
    return typeof session.email === "string" &&
      typeof session.expiresAt === "number" &&
      session.expiresAt > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function verifyAdminPassword(password: string): boolean {
  const storedHash = process.env.ADMIN_PASSWORD_HASH ?? "";
  const [algorithm, salt, expectedHash, extra] = storedHash.split("$");
  if (
    algorithm !== "scrypt" ||
    !salt ||
    !expectedHash ||
    extra ||
    !/^[a-f0-9]{128}$/i.test(expectedHash)
  ) {
    throw new Error("ADMIN_PASSWORD_HASH must use the scrypt$salt$hex format.");
  }

  const actualHash = scryptSync(password, salt, 64).toString("hex");
  return safeEqual(actualHash, expectedHash.toLowerCase());
}

export function setAdminSessionCookie(response: Response, token: string): void {
  response.setHeader(
    "Set-Cookie",
    cookieOptions(SESSION_DURATION_SECONDS).replace(`${SESSION_COOKIE}=`, `${SESSION_COOKIE}=${token}`),
  );
}

export function clearAdminSessionCookie(response: Response): void {
  response.setHeader("Set-Cookie", cookieOptions(0));
}

export const requireAdmin: RequestHandler = (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token || !verifyAdminSession(token)) {
    response.status(401).json({ error: "Admin authentication required." });
    return;
  }
  next();
};
