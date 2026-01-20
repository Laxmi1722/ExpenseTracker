const API_BASE = "http://localhost:4000/api";

function getToken() {
  return window.localStorage.getItem("token");
}

function setToken(token) {
  window.localStorage.setItem("token", token);
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export const authApi = {
  async register(email, password) {
    const data = await request("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setToken(data.token);
    return data;
  },
  async login(email, password) {
    const data = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setToken(data.token);
    return data;
  },
  logout() {
    window.localStorage.removeItem("token");
  },
  getToken,
};

export const dataApi = {
  getSummary(month) {
    return request(`/summary/${month}`);
  },
  getCategories() {
    return request("/categories");
  },
  createCategory(name) {
    return request("/categories", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  },
  getBudget(month) {
    return request(`/budget/${month}`);
  },
  saveBudget(month, payload) {
    return request(`/budget/${month}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },
  getExpenses(month) {
    return request(`/expenses?month=${encodeURIComponent(month)}`);
  },
  createExpense(payload) {
    return request("/expenses", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  getNotifications(month) {
    const qs = month ? `?month=${encodeURIComponent(month)}` : "";
    return request(`/notifications${qs}`);
  },
  markNotificationRead(id) {
    return request(`/notifications/${id}/read`, { method: "POST" });
  },
};


