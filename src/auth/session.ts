// src/auth/session.ts
// PURPOSE: Password hashing, JWT issue/verify and Express middleware (SRS 5.5).
// orgId is read from the verified token only — never from request input.
// Locally the server issues its own tokens; in AWS swap verifyToken for Cognito's JWKS.

import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export type Role = "admin" | "reviewer" | "viewer";
export interface AuthClaims { sub: string; orgId: string; role: Role; email: string; name: string }

declare global {
  namespace Express {
    interface Request { auth?: AuthClaims }
  }
}

export const COOKIE = "ae_token";
const TOKEN_TTL_SECONDS = 8 * 60 * 60;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

export function issueToken(claims: AuthClaims) {
  return jwt.sign(claims, config.jwtSecret, { expiresIn: TOKEN_TTL_SECONDS });
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: TOKEN_TTL_SECONDS * 1000,
    path: "/",
  });
}

function readCookie(req: Request, name: string) {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

// Accepts the browser session cookie or `Authorization: Bearer <jwt>` for API / webhook clients
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  const token = bearer ?? readCookie(req, COOKIE);
  if (!token) return res.status(401).json({ error: "Not signed in" });
  try {
    req.auth = jwt.verify(token, config.jwtSecret) as AuthClaims;
    next();
  } catch {
    res.status(401).json({ error: "Session expired" });
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return res.status(403).json({ error: `Requires role: ${roles.join(" or ")}` });
    }
    next();
  };
}
