"use strict";

const http = require("node:http");
const crypto = require("node:crypto");
const { WebSocketServer, WebSocket } = require("ws");

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT || 8080);
const PRESENCE_SECRET = process.env.PRESENCE_SECRET || "";
const PRESENCE_TTL_MS = Number(process.env.PRESENCE_TTL_MS || 45000);
const CLEANUP_INTERVAL_MS = Number(process.env.CLEANUP_INTERVAL_MS || 5000);
const MAX_CLOCK_SKEW_MS = Number(process.env.MAX_CLOCK_SKEW_MS || 300000);
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 16384);

const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
);

if (PRESENCE_SECRET.length < 32) {
  console.error("PRESENCE_SECRET mancante o troppo corto. Usa almeno 32 caratteri.");
  process.exit(1);
}

const users = new Map();

function sendJson(res, status, data) {
  const body = JSON.stringify(data);

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer"
  });

  res.end(body);
}

function snapshot() {
  return [...users.values()]
    .sort((a, b) => a.name.localeCompare(b.name, "it", { sensitivity: "base" }))
    .map(({ id, name, avatar }) => ({ id, name, avatar }));
}

function socketPayload() {
  return JSON.stringify({
    type: "presence",
    users: snapshot(),
    count: users.size,
    at: Date.now()
  });
}

function broadcast() {
  const payload = socketPayload();

  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function safeHexEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (!/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b)) return false;

  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");

  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function expectedSignature(timestamp, rawBody) {
  return crypto
    .createHmac("sha256", PRESENCE_SECRET)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
}

function validSignature(req, rawBody) {
  const timestamp = String(req.headers["x-sneh-timestamp"] || "");
  const signature = String(req.headers["x-sneh-signature"] || "");

  if (!/^\d{10,16}$/.test(timestamp)) return false;

  const numericTimestamp = Number(timestamp);
  if (!Number.isFinite(numericTimestamp)) return false;

  const timestampMs =
    timestamp.length <= 10 ? numericTimestamp * 1000 : numericTimestamp;

  if (Math.abs(Date.now() - timestampMs) > MAX_CLOCK_SKEW_MS) {
    return false;
  }

  return safeHexEqual(signature, expectedSignature(timestamp, rawBody));
}

function normalizeUser(value) {
  if (!value || typeof value !== "object") return null;

  const id = String(value.id ?? "").trim();
  const name = String(value.name ?? "").trim();
  const avatar = String(value.avatar ?? "").trim();

  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  if (name.length < 1 || name.length > 80) return null;
  if (avatar.length > 500) return null;

  return { id, name, avatar };
}

const server = http.createServer((req, res) => {
  let url;

  try {
    url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  } catch {
    return sendJson(res, 400, { ok: false, error: "URL non valido" });
  }

  if (req.method === "GET" && url.pathname === "/") {
    return sendJson(res, 200, {
      ok: true,
      service: "MLA & SNEH Presence",
      site: "https://mlasneh.it"
    });
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, {
      ok: true,
      service: "mlasneh-presence",
      online: users.size,
      uptime: Math.floor(process.uptime())
    });
  }

  if (req.method === "GET" && url.pathname === "/presence") {
    return sendJson(res, 200, {
      ok: true,
      users: snapshot(),
      count: users.size
    });
  }

  if (req.method === "POST" && url.pathname === "/presence") {
    let rawBody = "";
    let receivedBytes = 0;
    let tooLarge = false;

    req.setEncoding("utf8");

    req.on("data", (chunk) => {
      if (tooLarge) return;

      receivedBytes += Buffer.byteLength(chunk);

      if (receivedBytes > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }

      rawBody += chunk;
    });

    req.on("end", () => {
      if (tooLarge) {
        return sendJson(res, 413, {
          ok: false,
          error: "Payload troppo grande"
        });
      }

      if (!validSignature(req, rawBody)) {
        return sendJson(res, 401, {
          ok: false,
          error: "Firma HMAC non valida"
        });
      }

      let data;

      try {
        data = JSON.parse(rawBody);
      } catch {
        return sendJson(res, 400, {
          ok: false,
          error: "JSON non valido"
        });
      }

      const action = data.action === "offline" ? "offline" : "heartbeat";
      const user = normalizeUser(data.user ?? data);

      if (!user) {
        return sendJson(res, 422, {
          ok: false,
          error: "Dati presenza non validi"
        });
      }

      let changed = false;

      if (action === "offline") {
        changed = users.delete(user.id);
      } else {
        const previous = users.get(user.id);

        users.set(user.id, {
          ...user,
          lastSeen: Date.now()
        });

        changed =
          !previous ||
          previous.name !== user.name ||
          previous.avatar !== user.avatar;
      }

      if (changed) {
        broadcast();
      }

      return sendJson(res, 200, {
        ok: true,
        online: users.size
      });
    });

    return;
  }

  return sendJson(res, 404, {
    ok: false,
    error: "Endpoint non trovato"
  });
});

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 1024
});

server.on("upgrade", (req, socket, head) => {
  let url;

  try {
    url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  } catch {
    socket.destroy();
    return;
  }

  if (url.pathname !== "/presence") {
    socket.destroy();
    return;
  }

  if (allowedOrigins.size > 0 && !allowedOrigins.has(req.headers.origin)) {
    socket.write(
      "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
    );
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws) => {
  ws.send(socketPayload());

  // Il browser riceve la lista, ma non modifica lo stato.
  ws.on("message", () => {});
});

setInterval(() => {
  const now = Date.now();
  let changed = false;

  for (const [id, user] of users.entries()) {
    if (now - user.lastSeen > PRESENCE_TTL_MS) {
      users.delete(id);
      changed = true;
    }
  }

  if (changed) {
    broadcast();
  }
}, CLEANUP_INTERVAL_MS).unref();

function shutdown(signal) {
  console.log(`${signal}: chiusura MLA & SNEH Presence...`);

  for (const client of wss.clients) {
    try {
      client.close(1001, "Server restarting");
    } catch {}
  }

  server.close(() => process.exit(0));

  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

server.listen(PORT, HOST, () => {
  console.log(`MLA & SNEH Presence attivo su ${HOST}:${PORT}`);
  console.log(`TTL utenti online: ${PRESENCE_TTL_MS} ms`);

  if (allowedOrigins.size > 0) {
    console.log(`Origins autorizzate: ${[...allowedOrigins].join(", ")}`);
  }
});
