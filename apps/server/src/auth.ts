import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";

export type AuthenticatedRequest = Request & { auth: { userId: string; email?: string } };

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const jwks = supabaseUrl ? createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)) : undefined;
export async function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!jwks) {
    if (process.env.NODE_ENV !== "test") return res.status(503).json({ error: "Authentication is not configured" });
    (req as AuthenticatedRequest).auth = { userId: "test-user", email: "test@cartograph.invalid" }; return next();
  }
  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: `${supabaseUrl}/auth/v1`, audience: "authenticated" });
    if (!payload.sub) return res.status(401).json({ error: "Invalid session" });
    (req as AuthenticatedRequest).auth = { userId: payload.sub, email: typeof payload.email === "string" ? payload.email : undefined }; next();
  } catch { res.status(401).json({ error: "Invalid or expired session" }); }
}

export const userId = (req: Request) => (req as AuthenticatedRequest).auth.userId;
