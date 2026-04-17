import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { eq, and, gt, lt } from "drizzle-orm";
import { db } from "../db/client.js";
import { users, sessions } from "../db/schema.js";
import { appConfig } from "../config.js";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function hasUsers(): boolean {
  const row = db.select().from(users).limit(1).get();
  return !!row;
}

export async function createUser(username: string, password: string) {
  const hash = await hashPassword(password);
  return db.insert(users).values({ username, passwordHash: hash }).returning().get();
}

export async function authenticateUser(
  username: string,
  password: string
): Promise<string | null> {
  const user = db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .get();
  if (!user) return null;

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return null;

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(
    Date.now() + appConfig.sessionMaxAgeDays * 24 * 60 * 60 * 1000
  );
  db.insert(sessions).values({ token, userId: user.id, expiresAt }).run();

  return token;
}

export function validateSession(token: string) {
  const session = db
    .select()
    .from(sessions)
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .get();
  if (!session) return null;

  // Refresh expiry on activity
  const newExpiry = new Date(
    Date.now() + appConfig.sessionMaxAgeDays * 24 * 60 * 60 * 1000
  );
  db.update(sessions)
    .set({ expiresAt: newExpiry })
    .where(eq(sessions.id, session.id))
    .run();

  return session;
}

export function destroySession(token: string) {
  db.delete(sessions).where(eq(sessions.token, token)).run();
}

export function cleanExpiredSessions() {
  db.delete(sessions).where(lt(sessions.expiresAt, new Date())).run();
}
