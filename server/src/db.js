import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

let db = null;

export function getDb() {
  if (db) return db;

  const dbDir = path.dirname(config.dbPath);
  if (dbDir && dbDir !== ".") fs.mkdirSync(dbDir, { recursive: true });

  db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function migrate() {
  const database = getDb();
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS budgets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      month TEXT NOT NULL, -- YYYY-MM
      total_limit_cents INTEGER NOT NULL,
      warning_threshold_pct INTEGER NOT NULL DEFAULT 80,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, month),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, name),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS category_limits (
      id TEXT PRIMARY KEY,
      budget_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      limit_cents INTEGER NOT NULL,
      UNIQUE(budget_id, category_id),
      FOREIGN KEY(budget_id) REFERENCES budgets(id) ON DELETE CASCADE,
      FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      budget_month TEXT NOT NULL, -- YYYY-MM (denormalized for fast queries)
      category_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      description TEXT,
      expense_date TEXT NOT NULL, -- YYYY-MM-DD
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      month TEXT NOT NULL,
      type TEXT NOT NULL, -- budget_warning|budget_exceeded|category_warning|category_exceeded
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      read_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
}


