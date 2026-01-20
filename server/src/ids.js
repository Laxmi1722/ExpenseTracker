import crypto from "node:crypto";

export function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function nowIso() {
  return new Date().toISOString();
}


