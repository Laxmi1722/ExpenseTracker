import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { authApi, dataApi } from "./api.js";
import { connectSocket, disconnectSocket, getSocket } from "./socket.js";

function formatMoney(cents) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents || 0);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

function getCurrentMonth() {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}`;
}

function App() {
  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [user, setUser] = useState(null);
  const [month, setMonth] = useState(getCurrentMonth());

  const [summary, setSummary] = useState(null);
  const [categories, setCategories] = useState([]);
  const [budget, setBudget] = useState(null);
  const [categoryLimits, setCategoryLimits] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Forms
  const [newCategoryName, setNewCategoryName] = useState("");
  const [budgetTotal, setBudgetTotal] = useState("");
  const [warningPct, setWarningPct] = useState(80);
  const [newLimitCat, setNewLimitCat] = useState("");
  const [newLimitAmount, setNewLimitAmount] = useState("");
  const [expenseForm, setExpenseForm] = useState({
    categoryId: "",
    amount: "",
    description: "",
    expenseDate: new Date().toISOString().slice(0, 10),
  });

  const hasToken = !!authApi.getToken();

  useEffect(() => {
    if (!hasToken) return;
    const sock = connectSocket();
    if (!sock) return;

    const onExpense = (payload) => {
      if (payload.month === month) {
        refreshAll();
      }
    };
    const onNotification = () => {
      refreshNotifications();
    };

    sock.on("expense:created", onExpense);
    sock.on("notification:created", onNotification);

    return () => {
      sock.off("expense:created", onExpense);
      sock.off("notification:created", onNotification);
      // keep socket for whole session; disconnect on logout
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasToken, month]);

  useEffect(() => {
    if (!hasToken) return;
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasToken, month]);

  async function refreshAll() {
    setLoading(true);
    setError("");
    try {
      const [sum, cats, bud, exps, notes] = await Promise.all([
        dataApi.getSummary(month),
        dataApi.getCategories(),
        dataApi
          .getBudget(month)
          .catch(() => null),
        dataApi.getExpenses(month),
        dataApi.getNotifications(month),
      ]);
      setSummary(sum);
      setCategories(cats.categories);
      if (bud) {
        setBudget(bud.budget);
        setCategoryLimits(bud.categoryLimits);
        setBudgetTotal((bud.budget.total_limit_cents / 100).toString());
        setWarningPct(bud.budget.warning_threshold_pct);
      } else {
        setBudget(null);
        setCategoryLimits([]);
        setBudgetTotal("");
        setWarningPct(80);
      }
      setExpenses(exps.expenses);
      setNotifications(notes.notifications);
      if (!expenseForm.categoryId && cats.categories.length) {
        setExpenseForm((prev) => ({
          ...prev,
          categoryId: cats.categories[0].id,
        }));
      }
    } catch (e) {
      console.error(e);
      setError(e.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  async function refreshNotifications() {
    try {
      const notes = await dataApi.getNotifications(month);
      setNotifications(notes.notifications);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      const fn = authMode === "login" ? authApi.login : authApi.register;
      const data = await fn(email, password);
      setUser(data.user);
      setEmail("");
      setPassword("");
      connectSocket();
      refreshAll();
    } catch (e) {
      console.error(e);
      setError(e.message || "Authentication failed");
    }
  }

  function handleLogout() {
    authApi.logout();
    setUser(null);
    setSummary(null);
    setBudget(null);
    setCategoryLimits([]);
    setExpenses([]);
    setNotifications([]);
    disconnectSocket();
  }

  async function handleAddCategory(e) {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    try {
      const res = await dataApi.createCategory(newCategoryName.trim());
      setCategories((prev) => [...prev, res.category].sort((a, b) => a.name.localeCompare(b.name)));
      setNewCategoryName("");
      if (!expenseForm.categoryId) {
        setExpenseForm((prev) => ({ ...prev, categoryId: res.category.id }));
      }
    } catch (err) {
      console.error(err);
      setError(err.message || "Could not create category");
    }
  }

  async function handleSaveBudget(e) {
    e.preventDefault();
    if (!budgetTotal || Number.isNaN(Number(budgetTotal))) return;
    try {
      const payload = {
        totalLimit: Number(budgetTotal),
        warningThresholdPct: Number(warningPct) || 80,
        categoryLimits: categoryLimits.map((cl) => ({
          categoryId: cl.category_id,
          limit: cl.limit_cents / 100,
        })),
      };
      await dataApi.saveBudget(month, payload);
      await refreshAll();
    } catch (err) {
      console.error(err);
      setError(err.message || "Could not save budget");
    }
  }

  function handleAddCategoryLimit(e) {
    e.preventDefault();
    if (!newLimitCat || !newLimitAmount) return;
    const limitCents = Math.round(Number(newLimitAmount) * 100);
    if (Number.isNaN(limitCents)) return;
    const cat = categories.find((c) => c.id === newLimitCat);
    if (!cat) return;
    const existing = categoryLimits.find((cl) => cl.category_id === newLimitCat);
    let next;
    if (existing) {
      next = categoryLimits.map((cl) =>
        cl.category_id === newLimitCat ? { ...cl, limit_cents: limitCents } : cl
      );
    } else {
      next = [
        ...categoryLimits,
        {
          id: `local_${Date.now()}`,
          category_id: newLimitCat,
          category_name: cat.name,
          limit_cents: limitCents,
        },
      ];
    }
    setCategoryLimits(next);
    setNewLimitCat("");
    setNewLimitAmount("");
  }

  async function handleCreateExpense(e) {
    e.preventDefault();
    const { categoryId, amount, description, expenseDate } = expenseForm;
    if (!categoryId || !amount || !expenseDate) return;
    try {
      await dataApi.createExpense({
        categoryId,
        amount: Number(amount),
        description: description || undefined,
        expenseDate,
      });
      setExpenseForm((prev) => ({ ...prev, amount: "", description: "" }));
      await refreshAll();
    } catch (err) {
      console.error(err);
      setError(err.message || "Could not create expense");
    }
  }

  async function markNotificationRead(id) {
    try {
      await dataApi.markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
      );
    } catch (e) {
      console.error(e);
    }
  }

  const kpiState = useMemo(() => {
    if (!summary || !summary.budget) return { status: "no-budget" };
    const spend = summary.totalSpendCents || 0;
    const limit = summary.budget.total_limit_cents;
    const pct = limit ? Math.round((spend / limit) * 100) : 0;
    let badge = "ok";
    if (pct >= summary.budget.warning_threshold_pct && pct < 100) badge = "warn";
    if (pct >= 100) badge = "over";
    return { status: badge, pct, spend, limit };
  }, [summary]);

  if (!hasToken || !user) {
    return (
      <div className="app-shell">
        <header className="app-header">
          <div>
            <div className="app-title">FlowTrack</div>
            <div className="app-subtitle">Plan your month, log expenses, stay ahead of overspend.</div>
          </div>
        </header>

        <main>
          <section className="auth-card">
            <div className="auth-tabs">
              <button
                type="button"
                className={`auth-tab ${authMode === "login" ? "active" : ""}`}
                onClick={() => setAuthMode("login")}
              >
                Sign in
              </button>
              <button
                type="button"
                className={`auth-tab ${authMode === "register" ? "active" : ""}`}
                onClick={() => setAuthMode("register")}
              >
                Create account
              </button>
            </div>

            <form onSubmit={handleAuthSubmit}>
              <div className="field-grid">
                <div>
                  <label className="field-label">Email</label>
                  <input
                    className="field-input"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label">Password</label>
                  <div style={{ position: "relative" }}>
                    <input
                      className="field-input"
                      type={showPassword ? "text" : "password"}
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      style={{ paddingRight: "2rem" }}
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      onClick={() => setShowPassword((v) => !v)}
                      style={{
                        position: "absolute",
                        right: "0.4rem",
                        top: "50%",
                        transform: "translateY(-50%)",
                        border: "none",
                        background: "transparent",
                        color: "#9ca3af",
                        padding: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M2 12C3.8 7.8 7.5 5 12 5C16.5 5 20.2 7.8 22 12C20.2 16.2 16.5 19 12 19C7.5 19 3.8 16.2 2 12Z"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        {showPassword ? (
                          <line
                            x1="5"
                            y1="5"
                            x2="19"
                            y2="19"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                          />
                        ) : null}
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              {error && <div className="error-text">{error}</div>}

              <button className="primary-btn" type="submit">
                {authMode === "login" ? "Sign in" : "Create account"}
              </button>
            </form>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <div className="app-title">FlowTrack</div>
          <div className="app-subtitle">Your monthly money nerve center.</div>
        </div>
        <div className="top-row-right">
          <span className="pill">
            {user.email}
          </span>
          <button className="danger-btn" type="button" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      <main>
        <section className="dashboard-card" style={{ marginBottom: "1rem" }}>
          <div className="top-row">
            <div>
              <div className="section-title">This month</div>
              <div className="muted">Choose the month you want to focus on.</div>
            </div>
            <div className="spacer" />
            <input
              className="month-input"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>

          {summary && (
            <div className="kpi-row">
              <div className="kpi-card">
                <div className="kpi-label">Planned budget</div>
                <div className="kpi-value">
                  {summary.budget ? formatMoney(summary.budget.total_limit_cents) : "No budget yet"}
                </div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Spent so far</div>
                <div className="kpi-value">{formatMoney(summary.totalSpendCents)}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Remaining</div>
                <div className="kpi-value">
                  {summary.remainingCents == null ? "-" : formatMoney(summary.remainingCents)}
                </div>
                {kpiState.status !== "no-budget" && (
                  <div className={`kpi-pill ${kpiState.status}`}>
                    <span>{kpiState.pct}% of budget</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {summary && (
            <div style={{ marginTop: "1.1rem" }}>
              <div className="section-title">Where your money goes</div>
              {summary.byCategory?.length ? (
                <div className="category-bars">
                  {summary.byCategory.map((row) => {
                    const budgetLimit =
                      categoryLimits.find((cl) => cl.category_id === row.category_id)?.limit_cents ||
                      0;
                    const pct = budgetLimit
                      ? Math.min(130, Math.round((row.spend_cents / budgetLimit) * 100))
                      : 0;
                    let barClass = "";
                    if (budgetLimit) {
                      if (pct >= 100) barClass = "over";
                      else if (pct >= (summary.budget?.warning_threshold_pct || 80)) barClass = "warn";
                    }
                    return (
                      <div key={row.category_id} className="category-bar-row">
                        <div className="category-bar-label">{row.category_name}</div>
                        <div className="category-bar-track">
                          <div
                            className={`category-bar-fill ${barClass}`}
                            style={{ width: `${pct || 1}%` }}
                          />
                        </div>
                        <div className="category-bar-amount">{formatMoney(row.spend_cents)}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="muted">No expenses yet for this month.</div>
              )}
            </div>
          )}
        </section>

        <div className="row">
          <div className="col">
            <section className="dashboard-card">
              <div className="section-title">Budget & limits</div>
              <div className="muted">
                Set your monthly budget and optional caps per category.
              </div>

              <form onSubmit={handleSaveBudget} style={{ marginTop: "0.6rem" }}>
                <div className="field-grid">
                  <div>
                    <label className="field-label">Monthly budget (total)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="field-input"
                      value={budgetTotal}
                      onChange={(e) => setBudgetTotal(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="field-label">Alert threshold (%)</label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      className="field-input"
                      value={warningPct}
                      onChange={(e) => setWarningPct(e.target.value)}
                    />
                  </div>
                </div>

                <div style={{ marginTop: "0.75rem" }}>
                  <div className="field-label">Per-category limits (optional)</div>
                  <form className="inline-form" onSubmit={handleAddCategoryLimit}>
                    <select
                      className="field-select"
                      value={newLimitCat}
                      onChange={(e) => setNewLimitCat(e.target.value)}
                    >
                      <option value="">Choose category</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Limit"
                      className="field-input"
                      value={newLimitAmount}
                      onChange={(e) => setNewLimitAmount(e.target.value)}
                    />
                    <button className="primary-btn" type="submit">
                      Add
                    </button>
                  </form>

                  {categoryLimits.length > 0 && (
                    <ul className="notifications-list">
                      {categoryLimits.map((cl) => (
                        <li key={cl.id} className="notification-item">
                          <div>
                            <div className="notification-message">
                              {cl.category_name} — {formatMoney(cl.limit_cents)}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <button className="primary-btn" type="submit" disabled={loading}>
                  Save budget
                </button>
              </form>
            </section>
          </div>

          <div className="col">
            <section className="dashboard-card">
              <div className="section-title">Categories</div>
              <div className="muted">Group your expenses into buckets that make sense.</div>
              <form className="inline-form" onSubmit={handleAddCategory}>
                <input
                  className="field-input"
                  placeholder="e.g. Groceries"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                />
                <button className="primary-btn" type="submit">
                  Add
                </button>
              </form>

              <div style={{ marginTop: "0.5rem" }}>
                {categories.length ? (
                  <div className="muted">
                    {categories.map((c) => (
                      <span key={c.id} style={{ marginRight: "0.3rem" }} className="tag">
                        {c.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="muted">No categories yet.</div>
                )}
              </div>
            </section>

            <section className="dashboard-card" style={{ marginTop: "1rem" }}>
              <div className="section-title">Alerts</div>
              <div className="muted">
                We’ll warn you as you approach or exceed your limits.
              </div>
              {notifications.length ? (
                <div className="notifications-list">
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      className={`notification-item ${!n.read_at ? "unread" : ""}`}
                    >
      <div>
                        <div className="notification-type">{n.type.replace("_", " ")}</div>
                        <div className="notification-message">{n.message}</div>
                      </div>
                      {!n.read_at && (
                        <button
                          className="secondary-btn"
                          type="button"
                          onClick={() => markNotificationRead(n.id)}
                        >
                          Mark read
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="muted" style={{ marginTop: "0.5rem" }}>
                  No alerts yet. Stay on track to keep it that way.
                </div>
              )}
            </section>
          </div>
      </div>

        <section className="dashboard-card" style={{ marginTop: "1rem" }}>
          <div className="section-title">Log an expense</div>
          <form className="inline-form" onSubmit={handleCreateExpense}>
            <select
              className="field-select"
              value={expenseForm.categoryId}
              onChange={(e) =>
                setExpenseForm((prev) => ({ ...prev, categoryId: e.target.value }))
              }
              required
            >
              <option value="">Choose category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              className="field-input"
              type="number"
              min="0"
              step="0.01"
              placeholder="Amount"
              value={expenseForm.amount}
              onChange={(e) =>
                setExpenseForm((prev) => ({ ...prev, amount: e.target.value }))
              }
              required
            />
            <input
              className="field-input"
              type="date"
              value={expenseForm.expenseDate}
              onChange={(e) =>
                setExpenseForm((prev) => ({ ...prev, expenseDate: e.target.value }))
              }
              required
            />
            <input
              className="field-input"
              placeholder="Optional note"
              value={expenseForm.description}
              onChange={(e) =>
                setExpenseForm((prev) => ({ ...prev, description: e.target.value }))
              }
            />
            <button className="primary-btn" type="submit">
              Add
        </button>
          </form>

          <div style={{ marginTop: "0.8rem" }}>
            <div className="section-title">Recent expenses</div>
            {expenses.length ? (
              <table className="expenses-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Category</th>
                    <th>Amount</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e) => (
                    <tr key={e.id}>
                      <td>{e.expense_date}</td>
                      <td>{e.category_name}</td>
                      <td>{formatMoney(e.amount_cents)}</td>
                      <td>{e.description || <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="muted">Nothing logged yet for this month.</div>
            )}
          </div>
        </section>

        {error && <div className="error-text">{error}</div>}
        {loading && <div className="muted" style={{ marginTop: "0.4rem" }}>Loading…</div>}
      </main>
      </div>
  );
}

export default App;
