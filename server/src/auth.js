import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { config } from "./config.js";
import { getDb } from "./db.js";
import { id, nowIso } from "./ids.js";

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export function signToken(user) {
  return jwt.sign(user, config.jwtSecret, { expiresIn: "30d" });
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

export function createUser(email, password) {
  const db = getDb();
  const passwordHash = bcrypt.hashSync(password, 10);
  const userId = id("usr");
  const createdAt = nowIso();
  db.prepare(
    `INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)`
  ).run(userId, email.toLowerCase(), passwordHash, createdAt);
  return { userId, email: email.toLowerCase() };
}

export function verifyLogin(email, password) {
  const db = getDb();
  const row = db
    .prepare(`SELECT id, email, password_hash FROM users WHERE email = ?`)
    .get(email.toLowerCase());
  if (!row) return null;
  if (!bcrypt.compareSync(password, row.password_hash)) return null;
  return { userId: row.id, email: row.email };
}


