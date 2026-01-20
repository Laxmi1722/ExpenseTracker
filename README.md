# Expense Tracking Platform (Budget + Real‑time Expenses + Alerts)

This repo contains:

- `server/`: Node.js + Express + SQLite + Socket.IO (real-time) + JWT auth
- `client/`: React (Vite) dashboard with charts, budgets, categories, alerts

## Quick start (dev)

Prereqs:

- Node.js **20.x** recommended 
- npm 9+


1) Install deps (root + server + client)


npm install


2) Start the API (Terminal 1)

cd server
npm install
npm start


3) Start the frontend (Terminal 2)


cd client
npm install
npm run dev


### Option B: One command (Windows)

From the repo root:



The server has defaults, but you can override:

- `PORT` (default `4000`)
- `CLIENT_ORIGIN` (default `http://localhost:5173`)
- `JWT_SECRET` (default `dev_only_change_me`)
- `DB_PATH` (default `./data/app.sqlite`)

## URLs

- Client: `http://localhost:5173`
- API: `http://localhost:4000`

Snapshots of Project:-
<img width="1385" height="747" alt="image" src="https://github.com/user-attachments/assets/a64c30bb-5b2c-4e79-871f-4afcb8a69992" />

<img width="1478" height="892" alt="image" src="https://github.com/user-attachments/assets/e02ca436-c688-4960-b654-d8c54fa08140" />
<img width="1432" height="320" alt="image" src="https://github.com/user-attachments/assets/ae4c75a9-fbce-4e36-b677-d8530c0c071c" />

