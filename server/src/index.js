import "dotenv/config";
import http from "node:http";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { config } from "./config.js";
import { migrate } from "./db.js";
import { buildRouter } from "./routes.js";
import { verifyToken } from "./auth.js";

migrate();

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin: config.clientOrigin,
    credentials: false,
  })
);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: config.clientOrigin,
    methods: ["GET", "POST", "PUT"],
  },
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("missing_token"));
  try {
    const user = verifyToken(token);
    socket.user = user;
    next();
  } catch {
    next(new Error("invalid_token"));
  }
});

io.on("connection", (socket) => {
  // user-scoped room
  socket.join(socket.user.userId);
});

app.use("/api", buildRouter({ io }));

server.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on http://localhost:${config.port}`);
});


