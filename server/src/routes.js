import express from "express";
import { z } from "zod";
import { createUser, loginSchema, registerSchema, signToken, verifyLogin } from "./auth.js";
import { createNotifications, evaluateAlertsForMonth } from "./alerts.js";
import { getDb } from "./db.js";
import { id, nowIso } from "./ids.js";
import { requireAuth } from "./middleware.js";

function monthFromDate(isoDate) {
  // isoDate: YYYY-MM-DD
  return isoDate.slice(0, 7);
}

function centsFromNumber(amount) {
  return Math.round(Number(amount) * 100);
}

export function buildRouter({ io }) {
  const router = express.Router();

  router.get("/health", (_req, res) => res.json({ ok: true }));

  // Auth
  router.post("/auth/register", (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    try {
      const user = createUser(parsed.data.email, parsed.data.password);
      const token = signToken(user);
      return res.json({ token, user });
    } catch (e) {
      // likely unique constraint
      return res.status(409).json({ error: "email_taken" });
    }
  });

  router.post("/auth/login", (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    const user = verifyLogin(parsed.data.email, parsed.data.password);
    if (!user) return res.status(401).json({ error: "invalid_credentials" });
    const token = signToken(user);
    return res.json({ token, user });
  });

  // Everything below requires auth
  router.use(requireAuth);

  // Categories
  router.get("/categories", (req, res) => {
    const db = getDb();
    const rows = db
      .prepare(`SELECT id, name, created_at FROM categories WHERE user_id = ? ORDER BY name ASC`)
      .all(req.user.userId);
    res.json({ categories: rows });
  });

  router.post("/categories", (req, res) => {
    const schema = z.object({ name: z.string().min(1).max(50) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

    const db = getDb();
    const categoryId = id("cat");
    const createdAt = nowIso();
    try {
      db.prepare(`INSERT INTO categories (id, user_id, name, created_at) VALUES (?, ?, ?, ?)`).run(
        categoryId,
        req.user.userId,
        parsed.data.name.trim(),
        createdAt
      );
    } catch {
      return res.status(409).json({ error: "category_exists" });
    }
    res.json({ category: { id: categoryId, name: parsed.data.name.trim(), created_at: createdAt } });
  });

  // Budget (per month)
  router.get("/budget/:month", (req, res) => {
    const month = req.params.month;
    const db = getDb();
    const budget = db
      .prepare(
        `SELECT id, month, total_limit_cents, warning_threshold_pct, created_at
         FROM budgets WHERE user_id = ? AND month = ?`
      )
      .get(req.user.userId, month);
    if (!budget) return res.status(404).json({ error: "not_found" });

    const limits = db
      .prepare(
        `SELECT cl.id, cl.category_id, c.name AS category_name, cl.limit_cents
         FROM category_limits cl
         JOIN categories c ON c.id = cl.category_id
         WHERE cl.budget_id = ?
         ORDER BY c.name ASC`
      )
      .all(budget.id);

    res.json({ budget, categoryLimits: limits });
  });

  router.put("/budget/:month", (req, res) => {
    const month = req.params.month;
    const schema = z.object({
      totalLimit: z.number().nonnegative(),
      warningThresholdPct: z.number().int().min(1).max(100).default(80),
      categoryLimits: z
        .array(z.object({ categoryId: z.string().min(1), limit: z.number().nonnegative() }))
        .default([]),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

    const db = getDb();
    const now = nowIso();

    let budget = db
      .prepare(`SELECT id FROM budgets WHERE user_id = ? AND month = ?`)
      .get(req.user.userId, month);

    if (!budget) {
      const budgetId = id("bud");
      db.prepare(
        `INSERT INTO budgets (id, user_id, month, total_limit_cents, warning_threshold_pct, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        budgetId,
        req.user.userId,
        month,
        centsFromNumber(parsed.data.totalLimit),
        parsed.data.warningThresholdPct,
        now
      );
      budget = { id: budgetId };
    } else {
      db.prepare(
        `UPDATE budgets SET total_limit_cents = ?, warning_threshold_pct = ? WHERE id = ?`
      ).run(centsFromNumber(parsed.data.totalLimit), parsed.data.warningThresholdPct, budget.id);
    }

    // upsert category limits
    const upsert = db.prepare(
      `INSERT INTO category_limits (id, budget_id, category_id, limit_cents)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(budget_id, category_id) DO UPDATE SET limit_cents = excluded.limit_cents`
    );

    for (const cl of parsed.data.categoryLimits) {
      upsert.run(id("clm"), budget.id, cl.categoryId, centsFromNumber(cl.limit));
    }

    res.json({ ok: true });
    io?.to(req.user.userId).emit("budget:updated", { month });
  });

  // Expenses
  router.get("/expenses", (req, res) => {
    const schema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });

    const db = getDb();
    const rows = db
      .prepare(
        `SELECT e.id, e.amount_cents, e.description, e.expense_date, e.created_at,
                e.category_id, c.name AS category_name
         FROM expenses e
         JOIN categories c ON c.id = e.category_id
         WHERE e.user_id = ? AND e.budget_month = ?
         ORDER BY e.expense_date DESC, e.created_at DESC`
      )
      .all(req.user.userId, parsed.data.month);
    res.json({ expenses: rows });
  });

  router.post("/expenses", (req, res) => {
    const schema = z.object({
      categoryId: z.string().min(1),
      amount: z.number().positive(),
      description: z.string().max(200).optional(),
      expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

    const db = getDb();
    const expenseId = id("exp");
    const createdAt = nowIso();
    const budgetMonth = monthFromDate(parsed.data.expenseDate);

    db.prepare(
      `INSERT INTO expenses
        (id, user_id, budget_month, category_id, amount_cents, description, expense_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      expenseId,
      req.user.userId,
      budgetMonth,
      parsed.data.categoryId,
      centsFromNumber(parsed.data.amount),
      parsed.data.description ?? null,
      parsed.data.expenseDate,
      createdAt
    );

    // Evaluate + persist notifications, then emit realtime events
    const alerts = evaluateAlertsForMonth({ userId: req.user.userId, month: budgetMonth });
    const created = createNotifications({ userId: req.user.userId, month: budgetMonth, alerts });

    res.json({ expenseId, month: budgetMonth, notifications: created });
    io?.to(req.user.userId).emit("expense:created", { id: expenseId, month: budgetMonth });
    for (const n of created) io?.to(req.user.userId).emit("notification:created", n);
  });

  // Summary
  router.get("/summary/:month", (req, res) => {
    const month = req.params.month;
    const db = getDb();

    const budget = db
      .prepare(
        `SELECT total_limit_cents, warning_threshold_pct
         FROM budgets WHERE user_id = ? AND month = ?`
      )
      .get(req.user.userId, month);

    const totalSpend = db
      .prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS spend_cents
         FROM expenses WHERE user_id = ? AND budget_month = ?`
      )
      .get(req.user.userId, month);

    const byCategory = db
      .prepare(
        `SELECT c.id AS category_id, c.name AS category_name, COALESCE(SUM(e.amount_cents), 0) AS spend_cents
         FROM categories c
         LEFT JOIN expenses e
           ON e.category_id = c.id
          AND e.user_id = ?
          AND e.budget_month = ?
         WHERE c.user_id = ?
         GROUP BY c.id, c.name
         ORDER BY spend_cents DESC, c.name ASC`
      )
      .all(req.user.userId, month, req.user.userId);

    res.json({
      month,
      budget: budget ?? null,
      totalSpendCents: totalSpend?.spend_cents ?? 0,
      remainingCents: budget ? budget.total_limit_cents - (totalSpend?.spend_cents ?? 0) : null,
      byCategory,
    });
  });

  // Notifications
  router.get("/notifications", (req, res) => {
    const schema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });

    const db = getDb();
    const rows = parsed.data.month
      ? db
          .prepare(
            `SELECT * FROM notifications WHERE user_id = ? AND month = ? ORDER BY created_at DESC LIMIT 100`
          )
          .all(req.user.userId, parsed.data.month)
      : db
          .prepare(`SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`)
          .all(req.user.userId);

    res.json({ notifications: rows });
  });

  router.post("/notifications/:id/read", (req, res) => {
    const db = getDb();
    const nId = req.params.id;
    const now = nowIso();
    db.prepare(`UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?`).run(
      now,
      nId,
      req.user.userId
    );
    res.json({ ok: true });
  });

  return router;
}


