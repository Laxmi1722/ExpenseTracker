import { getDb } from "./db.js";
import { id, nowIso } from "./ids.js";

export function evaluateAlertsForMonth(params) {
  const db = getDb();
  const budget = db
    .prepare(
      `SELECT id, total_limit_cents, warning_threshold_pct
       FROM budgets
       WHERE user_id = ? AND month = ?`
    )
    .get(params.userId, params.month);

  if (!budget) return [];

  const spendRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS spend_cents
       FROM expenses
       WHERE user_id = ? AND budget_month = ?`
    )
    .get(params.userId, params.month);

  const spendCents = spendRow?.spend_cents ?? 0;
  const warningAt = Math.floor(
    (budget.total_limit_cents * budget.warning_threshold_pct) / 100
  );

  const alerts = [];
  if (budget.total_limit_cents > 0 && spendCents >= budget.total_limit_cents) {
    alerts.push({
      type: "budget_exceeded",
      message: `Monthly budget exceeded: ${formatMoney(
        spendCents
      )} / ${formatMoney(budget.total_limit_cents)}`,
    });
  } else if (budget.total_limit_cents > 0 && spendCents >= warningAt) {
    alerts.push({
      type: "budget_warning",
      message: `Approaching monthly budget (${budget.warning_threshold_pct}%): ${formatMoney(
        spendCents
      )} / ${formatMoney(budget.total_limit_cents)}`,
    });
  }

  const categoryRows = db
    .prepare(
      `SELECT
         c.id AS category_id,
         c.name AS category_name,
         cl.limit_cents AS limit_cents,
         COALESCE(SUM(e.amount_cents), 0) AS spend_cents
       FROM category_limits cl
       JOIN categories c ON c.id = cl.category_id
       LEFT JOIN expenses e
         ON e.category_id = c.id
        AND e.user_id = ?
        AND e.budget_month = ?
       WHERE cl.budget_id = ?
       GROUP BY c.id, c.name, cl.limit_cents`
    )
    .all(params.userId, params.month, budget.id);

  for (const r of categoryRows) {
    if (r.limit_cents <= 0) continue;
    const warnAt = Math.floor(
      (r.limit_cents * budget.warning_threshold_pct) / 100
    );
    if (r.spend_cents >= r.limit_cents) {
      alerts.push({
        type: "category_exceeded",
        message: `Category exceeded (${r.category_name}): ${formatMoney(
          r.spend_cents
        )} / ${formatMoney(r.limit_cents)}`,
      });
    } else if (r.spend_cents >= warnAt) {
      alerts.push({
        type: "category_warning",
        message: `Approaching category limit (${r.category_name}): ${formatMoney(
          r.spend_cents
        )} / ${formatMoney(r.limit_cents)}`,
      });
    }
  }

  return alerts;
}

export function createNotifications(params) {
  if (!params.alerts.length) return [];
  const db = getDb();
  const createdAt = nowIso();
  const created = [];

  for (const a of params.alerts) {
    const existing = db
      .prepare(
        `SELECT 1 FROM notifications
         WHERE user_id = ? AND month = ? AND type = ? AND message = ?
           AND datetime(created_at) >= datetime(?, '-1 day')
         LIMIT 1`
      )
      .get(params.userId, params.month, a.type, a.message, createdAt);
    if (existing) continue;

    const notificationId = id("ntf");
    db.prepare(
      `INSERT INTO notifications (id, user_id, month, type, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      notificationId,
      params.userId,
      params.month,
      a.type,
      a.message,
      createdAt
    );
    created.push({ id: notificationId, ...a, month: params.month, createdAt });
  }

  return created;
}

export function formatMoney(cents) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}


