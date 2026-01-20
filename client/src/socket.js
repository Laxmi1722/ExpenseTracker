import { io } from "socket.io-client";
import { authApi } from "./api.js";

let socket;

export function getSocket() {
  return socket;
}

export function connectSocket() {
  const token = authApi.getToken();
  if (!token) return null;
  if (socket) return socket;

  socket = io("http://localhost:4000", {
    auth: { token },
  });

  socket.on("connect_error", (err) => {
    console.error("socket error", err);
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}


