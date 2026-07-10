const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const DB_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH)
  : path.join(ROOT, "data");
const DB_PATH = path.join(DB_DIR, "app.db");
const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_PASSWORD = "fandomyzi20112011";

require("fs").mkdirSync(DB_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS admin_users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    token TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS visitor_sessions (
    token TEXT PRIMARY KEY,
    phone TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sms_codes (
    phone TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    owner_phone TEXT NOT NULL,
    name TEXT NOT NULL,
    text TEXT NOT NULL,
    rating INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    visitor_phone TEXT NOT NULL UNIQUE,
    visitor_name TEXT NOT NULL,
    status TEXT NOT NULL,
    last_sender TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );
`);

function nowIso() {
  return new Date().toISOString();
}

function uuid() {
  return crypto.randomUUID();
}

function parseCookies(header = "") {
  return header.split(";").reduce((acc, part) => {
    const index = part.indexOf("=");
    if (index === -1) return acc;
    const key = part.slice(0, index).trim();
    const value = decodeURIComponent(part.slice(index + 1).trim());
    acc[key] = value;
    return acc;
  }, {});
}

function setCookie(res, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "SameSite=Lax"];
  if (options.maxAge != null) parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly !== false) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearCookie(res, name) {
  res.setHeader("Set-Cookie", `${name}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash: derived };
}

function verifyPassword(password, salt, storedHash) {
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(storedHash, "hex");
  return expected.length === derived.length && crypto.timingSafeEqual(derived, expected);
}

function basicAuthHeader(accountSid, authToken) {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
}

async function callTwilioVerify(endpoint, params) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

  if (!accountSid || !authToken || !serviceSid) {
    return {
      ok: false,
      status: 500,
      body: {
        error:
          "Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID.",
      },
    };
  }

  const response = await fetch(
    `https://verify.twilio.com/v2/Services/${serviceSid}/${endpoint}`,
    {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(accountSid, authToken),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params),
    }
  );

  const payload = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    body: payload,
  };
}

function hasTwilioVerifyConfig() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_VERIFY_SERVICE_SID
  );
}

function generateSmsCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function readJson(req, res, callback) {
  return readBody(req)
    .then(callback)
    .catch((error) => sendJson(res, 500, { error: error.message || "Server error" }));
}

function getVisitorSession(req) {
  const token = parseCookies(req.headers.cookie || "").visitor_session;
  if (!token) return null;

  const row = db
    .prepare(
      "SELECT token, phone, name, expires_at FROM visitor_sessions WHERE token = ?"
    )
    .get(token);

  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare("DELETE FROM visitor_sessions WHERE token = ?").run(token);
    return null;
  }

  return row;
}

function getAdminSession(req) {
  const token = parseCookies(req.headers.cookie || "").admin_session;
  if (!token) return null;

  const row = db
    .prepare(
      `
      SELECT s.token, u.id AS admin_id, u.username, s.expires_at
      FROM admin_sessions s
      JOIN admin_users u ON u.id = s.admin_id
      WHERE s.token = ?
    `
    )
    .get(token);

  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare("DELETE FROM admin_sessions WHERE token = ?").run(token);
    return null;
  }

  return row;
}

function requireVisitor(req, res) {
  const visitor = getVisitorSession(req);
  if (!visitor) {
    sendJson(res, 401, { error: "Сначала подтвердите номер телефона." });
    return null;
  }
  return visitor;
}

function requireAdmin(req, res) {
  const admin = getAdminSession(req);
  if (!admin) {
    sendJson(res, 401, { error: "Требуется вход в кабинет." });
    return null;
  }
  return admin;
}

function ensureAdminExists() {
  const count = db.prepare("SELECT COUNT(*) AS count FROM admin_users").get().count;
  return count > 0;
}

function ensureDefaultAdminAccount() {
  const existing = db
    .prepare("SELECT id FROM admin_users WHERE username = ?")
    .get(DEFAULT_ADMIN_USERNAME);
  const { salt, hash } = hashPassword(DEFAULT_ADMIN_PASSWORD);

  if (existing) {
    db.prepare(
      `
      UPDATE admin_users
      SET password_hash = ?, salt = ?
      WHERE username = ?
    `
    ).run(hash, salt, DEFAULT_ADMIN_USERNAME);
    return;
  }

  db.prepare(
    `
    INSERT INTO admin_users (id, username, password_hash, salt, created_at)
    VALUES (?, ?, ?, ?, ?)
  `
  ).run(uuid(), DEFAULT_ADMIN_USERNAME, hash, salt, nowIso());
}

ensureDefaultAdminAccount();

async function serveFile(res, filename) {
  try {
    const filePath = path.join(ROOT, filename);
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": getContentType(filePath),
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

function getOverview() {
  const reviews = db.prepare("SELECT COUNT(*) AS count FROM reviews").get().count;
  const conversations = db.prepare("SELECT COUNT(*) AS count FROM conversations").get().count;
  const unread = db
    .prepare("SELECT COUNT(*) AS count FROM conversations WHERE status = 'new'")
    .get().count;
  const avgRating = db
    .prepare("SELECT AVG(rating) AS avgRating FROM reviews")
    .get().avgRating;

  return {
    reviews,
    conversations,
    unread,
    avgRating: avgRating ? Number(avgRating).toFixed(1) : "0.0",
  };
}

function listPublicReviews(limit = 8) {
  return db
    .prepare(
      `
      SELECT id, name, text, rating, created_at, updated_at
      FROM reviews
      ORDER BY datetime(created_at) DESC
      LIMIT ?
    `
    )
    .all(limit);
}

function listAdminReviews() {
  return db
    .prepare(
      `
      SELECT id, owner_phone, name, text, rating, created_at, updated_at
      FROM reviews
      ORDER BY datetime(created_at) DESC
    `
    )
    .all();
}

function listConversations() {
  return db
    .prepare(
      `
      SELECT c.id, c.visitor_phone, c.visitor_name, c.status, c.last_sender, c.created_at, c.updated_at,
        (
          SELECT text
          FROM messages m
          WHERE m.conversation_id = c.id
          ORDER BY datetime(m.created_at) DESC
          LIMIT 1
        ) AS last_message,
        (
          SELECT created_at
          FROM messages m
          WHERE m.conversation_id = c.id
          ORDER BY datetime(m.created_at) DESC
          LIMIT 1
        ) AS last_message_at
      FROM conversations c
      ORDER BY datetime(c.updated_at) DESC
    `
    )
    .all();
}

function listConversationMessages(conversationId) {
  return db
    .prepare(
      `
      SELECT id, conversation_id, sender, sender_name, text, created_at
      FROM messages
      WHERE conversation_id = ?
      ORDER BY datetime(created_at) ASC
    `
    )
    .all(conversationId);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/healthz") {
    return sendJson(res, 200, { ok: true });
  }

  // The administrator cabinet has been removed from the product.
  if (url.pathname.startsWith("/api/admin") || url.pathname.startsWith("/api/auth")) {
    return sendJson(res, 404, { error: "Not found" });
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    return serveFile(res, "index.html");
  }

  if (req.method === "GET" && (url.pathname === "/reviews" || url.pathname === "/reviews.html")) {
    return serveFile(res, "reviews.html");
  }

  if (req.method === "GET" && (url.pathname === "/requests" || url.pathname === "/requests.html")) {
    return serveFile(res, "requests.html");
  }

  if (req.method === "GET" && (url.pathname === "/portfolio" || url.pathname === "/portfolio.html")) {
    return serveFile(res, "portfolio.html");
  }

  if (req.method === "POST" && url.pathname === "/api/auth/send-code") {
    return readJson(req, res, async (body) => {
      const name = String(body.name || "").trim();
      const phone = String(body.phone || "").trim();

      if (name.length < 2) {
        return sendJson(res, 400, { error: "Имя должно содержать минимум 2 символа." });
      }

      if (!/^\+?\d{10,15}$/.test(phone)) {
        return sendJson(res, 400, { error: "Введите корректный номер телефона." });
      }

      if (hasTwilioVerifyConfig()) {
        const result = await callTwilioVerify("Verifications", {
          To: phone,
          Channel: "sms",
        });

        if (!result.ok) {
          return sendJson(res, result.status || 500, {
            error: result.body?.message || "Не удалось отправить SMS-код через Twilio Verify.",
          });
        }

        return sendJson(res, 200, {
          ok: true,
          message: `Код отправлен на ${phone}. Введите 4 цифры для подтверждения.`,
        });
      }

      const code = generateSmsCode();
      const createdAt = nowIso();
      const expiresAt = new Date(Date.now() + 1000 * 60 * 10).toISOString();
      db.prepare(
        `
        INSERT INTO sms_codes (phone, name, code, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(phone) DO UPDATE SET
          name = excluded.name,
          code = excluded.code,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at
      `
      ).run(phone, name, code, createdAt, expiresAt);

      return sendJson(res, 200, {
        ok: true,
        message: `Тестовый 4-значный код для ${phone}: ${code}`,
        devMode: true,
      });
    });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/verify-code") {
    return readJson(req, res, async (body) => {
      const name = String(body.name || "").trim();
      const phone = String(body.phone || "").trim();
      const code = String(body.code || "").trim();

      if (!/^\+?\d{10,15}$/.test(phone)) {
        return sendJson(res, 400, { error: "Введите корректный номер телефона." });
      }

      if (!/^\d{4}$/.test(code)) {
        return sendJson(res, 400, { error: "Код должен состоять из 4 цифр." });
      }

      if (hasTwilioVerifyConfig()) {
        const result = await callTwilioVerify("VerificationCheck", {
          To: phone,
          Code: code,
        });

        if (!result.ok) {
          return sendJson(res, result.status || 500, {
            error: result.body?.message || "Не удалось проверить SMS-код через Twilio Verify.",
          });
        }

        const approved = String(result.body?.status || "").toLowerCase() === "approved";
        if (!approved) {
          return sendJson(res, 400, { ok: false, approved: false, message: "Неверный код." });
        }
      } else {
        const stored = db.prepare("SELECT code, expires_at FROM sms_codes WHERE phone = ?").get(phone);
        if (!stored) {
          return sendJson(res, 400, { ok: false, approved: false, message: "Код не найден. Запросите его снова." });
        }
        if (new Date(stored.expires_at).getTime() <= Date.now()) {
          db.prepare("DELETE FROM sms_codes WHERE phone = ?").run(phone);
          return sendJson(res, 400, { ok: false, approved: false, message: "Код истек. Запросите новый." });
        }
        if (stored.code !== code) {
          return sendJson(res, 400, { ok: false, approved: false, message: "Неверный код." });
        }
        db.prepare("DELETE FROM sms_codes WHERE phone = ?").run(phone);
      }

      const token = uuid();
      const createdAt = nowIso();
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
      db.prepare(
        `
        INSERT INTO visitor_sessions (token, phone, name, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(token, phone, name, createdAt, expiresAt);

      db.prepare("DELETE FROM sms_codes WHERE phone = ?").run(phone);

      setCookie(res, "visitor_session", token, { maxAge: 60 * 60 * 24 * 30 });
      return sendJson(res, 200, {
        ok: true,
        approved: true,
        visitor: { name, phone },
        message: "Код подтвержден.",
      });
    });
  }

  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const visitor = getVisitorSession(req);
    return sendJson(res, 200, { user: visitor ? { name: visitor.name, phone: visitor.phone } : null });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const cookies = parseCookies(req.headers.cookie || "");
    if (cookies.visitor_session) {
      db.prepare("DELETE FROM visitor_sessions WHERE token = ?").run(cookies.visitor_session);
      clearCookie(res, "visitor_session");
    }
    if (cookies.admin_session) {
      db.prepare("DELETE FROM admin_sessions WHERE token = ?").run(cookies.admin_session);
      clearCookie(res, "admin_session");
    }
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/reviews") {
    return sendJson(res, 200, { reviews: listPublicReviews(Number(url.searchParams.get("limit") || 8)) });
  }

  if (req.method === "POST" && url.pathname === "/api/reviews") {
    return readJson(req, res, async (body) => {
      const text = String(body.text || "").trim();
      const name = String(body.name || "").trim();
      const phone = String(body.phone || "").trim();
      const rating = Number(body.rating || 0);

      let authorName = name;
      let authorPhone = phone;
      const visitor = getVisitorSession(req);
      if (visitor) {
        authorName = visitor.name;
        authorPhone = visitor.phone;
      }

      if (!authorName) {
        authorName = "Гость";
      }

      if (authorPhone && !/^\+?\d{10,15}$/.test(authorPhone)) {
        return sendJson(res, 400, { error: "Введите корректный номер телефона." });
      }

      if (!text) {
        return sendJson(res, 400, { error: "Текст отзыва не может быть пустым." });
      }

      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return sendJson(res, 400, { error: "Оценка должна быть от 1 до 5." });
      }

      const id = uuid();
      const createdAt = nowIso();
      db.prepare(
        `
        INSERT INTO reviews (id, owner_phone, name, text, rating, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL)
      `
      ).run(id, authorPhone || "", authorName, text, rating, createdAt);

      return sendJson(res, 200, {
        review: { id, owner_phone: authorPhone || "", name: authorName, text, rating, created_at: createdAt },
      });
    });
  }

  if (req.method === "POST" && url.pathname === "/api/messages") {
    return readJson(req, res, async (body) => {
      const text = String(body.text || "").trim();
      const name = String(body.name || "").trim();
      const phone = String(body.phone || "").trim();

      let visitorName = name;
      let visitorPhone = phone;
      const session = getVisitorSession(req);
      if (session) {
        visitorName = session.name;
        visitorPhone = session.phone;
      }

      if (!visitorName) {
        return sendJson(res, 400, { error: "Укажите имя." });
      }

      if (visitorPhone && !/^\+?\d{10,15}$/.test(visitorPhone)) {
        return sendJson(res, 400, { error: "Введите корректный номер телефона." });
      }

      if (!text) {
        return sendJson(res, 400, { error: "Сообщение не может быть пустым." });
      }

      const now = nowIso();
      const conversationKey = visitorPhone || `request:${uuid()}`;
      const conversation = db
        .prepare("SELECT id FROM conversations WHERE visitor_phone = ?")
        .get(conversationKey);

      const conversationId = conversation?.id || uuid();
      if (!conversation) {
        db.prepare(
          `
          INSERT INTO conversations (id, visitor_phone, visitor_name, status, last_sender, created_at, updated_at)
          VALUES (?, ?, ?, 'new', 'visitor', ?, ?)
        `
        ).run(conversationId, conversationKey, visitorName, now, now);
      } else {
        db.prepare(
          `
          UPDATE conversations
          SET visitor_name = ?, status = 'new', last_sender = 'visitor', updated_at = ?
          WHERE id = ?
        `
        ).run(visitorName, now, conversationId);
      }

      db.prepare(
        `
        INSERT INTO messages (id, conversation_id, sender, sender_name, text, created_at)
        VALUES (?, ?, 'visitor', ?, ?, ?)
      `
      ).run(uuid(), conversationId, visitorName, text, now);

      return sendJson(res, 200, { ok: true, conversationId });
    });
  }

  if (req.method === "GET" && url.pathname === "/api/admin/status") {
    return sendJson(res, 200, {
      needsSetup: !ensureAdminExists(),
      authenticated: Boolean(getAdminSession(req)),
    });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/setup") {
    if (ensureAdminExists()) {
      return sendJson(res, 409, { error: "Администратор уже создан." });
    }

    return readJson(req, res, async (body) => {
      const username = String(body.username || "").trim();
      const password = String(body.password || "").trim();

      if (username.length < 3) {
        return sendJson(res, 400, { error: "Логин должен быть не короче 3 символов." });
      }
      if (password.length < 8) {
        return sendJson(res, 400, { error: "Пароль должен быть не короче 8 символов." });
      }

      const { salt, hash } = hashPassword(password);
      const adminId = uuid();
      db.prepare(
        `
        INSERT INTO admin_users (id, username, password_hash, salt, created_at)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(adminId, username, hash, salt, nowIso());

      const token = uuid();
      const createdAt = nowIso();
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString();
      db.prepare(
        `
        INSERT INTO admin_sessions (token, admin_id, created_at, expires_at)
        VALUES (?, ?, ?, ?)
      `
      ).run(token, adminId, createdAt, expiresAt);

      setCookie(res, "admin_session", token, { maxAge: 60 * 60 * 12 });
      return sendJson(res, 200, { ok: true, admin: { username } });
    });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/login") {
    return readJson(req, res, async (body) => {
      const username = String(body.username || "").trim();
      const password = String(body.password || "").trim();
      const row = db
        .prepare("SELECT id, username, password_hash, salt FROM admin_users WHERE username = ?")
        .get(username);

      if (!row || !verifyPassword(password, row.salt, row.password_hash)) {
        return sendJson(res, 401, { error: "Неверный логин или пароль." });
      }

      const token = uuid();
      const createdAt = nowIso();
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString();
      db.prepare(
        `
        INSERT INTO admin_sessions (token, admin_id, created_at, expires_at)
        VALUES (?, ?, ?, ?)
      `
      ).run(token, row.id, createdAt, expiresAt);

      setCookie(res, "admin_session", token, { maxAge: 60 * 60 * 12 });
      return sendJson(res, 200, { ok: true, admin: { username } });
    });
  }

  if (req.method === "GET" && url.pathname === "/api/admin/me") {
    const admin = getAdminSession(req);
    return sendJson(res, 200, { admin: admin ? { username: admin.username } : null, needsSetup: !ensureAdminExists() });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/logout") {
    const admin = getAdminSession(req);
    if (admin) {
      db.prepare("DELETE FROM admin_sessions WHERE token = ?").run(admin.token);
      clearCookie(res, "admin_session");
    }
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/password") {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    return sendJson(res, 403, {
      error: "Пароль администратора зафиксирован и не может быть изменен из кабинета.",
    });
  }

  if (req.method === "GET" && url.pathname === "/api/admin/overview") {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    return sendJson(res, 200, getOverview());
  }

  if (req.method === "GET" && url.pathname === "/api/admin/reviews") {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    return sendJson(res, 200, { reviews: listAdminReviews() });
  }

  if (req.method === "PUT" && url.pathname.startsWith("/api/admin/reviews/")) {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const reviewId = decodeURIComponent(url.pathname.split("/").pop());
    return readJson(req, res, async (body) => {
      const text = String(body.text || "").trim();
      const rating = Number(body.rating || 0);
      if (!text) {
        return sendJson(res, 400, { error: "Текст отзыва не может быть пустым." });
      }
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return sendJson(res, 400, { error: "Оценка должна быть от 1 до 5." });
      }

      const exists = db.prepare("SELECT id FROM reviews WHERE id = ?").get(reviewId);
      if (!exists) {
        return sendJson(res, 404, { error: "Отзыв не найден." });
      }

      db.prepare(
        `
        UPDATE reviews
        SET text = ?, rating = ?, updated_at = ?
        WHERE id = ?
      `
      ).run(text, rating, nowIso(), reviewId);

      return sendJson(res, 200, { ok: true });
    });
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/reviews/")) {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const reviewId = decodeURIComponent(url.pathname.split("/").pop());
    db.prepare("DELETE FROM reviews WHERE id = ?").run(reviewId);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/admin/conversations") {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    return sendJson(res, 200, { conversations: listConversations() });
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/admin/conversations/") && url.pathname.endsWith("/messages")) {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const conversationId = decodeURIComponent(url.pathname.split("/")[4]);
    return sendJson(res, 200, { messages: listConversationMessages(conversationId) });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/admin/conversations/") && url.pathname.endsWith("/messages")) {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const conversationId = decodeURIComponent(url.pathname.split("/")[4]);

    return readJson(req, res, async (body) => {
      const text = String(body.text || "").trim();
      if (!text) {
        return sendJson(res, 400, { error: "Ответ не может быть пустым." });
      }

      const conversation = db.prepare("SELECT id FROM conversations WHERE id = ?").get(conversationId);
      if (!conversation) {
        return sendJson(res, 404, { error: "Диалог не найден." });
      }

      const adminName = admin.username;
      const now = nowIso();
      db.prepare(
        `
        INSERT INTO messages (id, conversation_id, sender, sender_name, text, created_at)
        VALUES (?, ?, 'admin', ?, ?, ?)
      `
      ).run(uuid(), conversationId, adminName, text, now);

      db.prepare(
        `
        UPDATE conversations
        SET status = 'answered', last_sender = 'admin', updated_at = ?
        WHERE id = ?
      `
      ).run(now, conversationId);

      return sendJson(res, 200, { ok: true });
    });
  }

  const staticCandidates = {
    "/styles.css": "styles.css",
    "/app.js": "app.js",
    "/site-shell.js": "site-shell.js",
    "/home-leads.js": "home-leads.js",
    "/reviews.js": "reviews.js",
    "/requests.js": "requests.js",
    "/storage.js": "storage.js",
    "/api.js": "api.js",
    "/site-api.js": "site-api.js",
    "/scene.js": "scene.js",
    "/assets/developer-studio-hero.png": "assets/developer-studio-hero.png",
  };

  if (staticCandidates[url.pathname]) {
    return serveFile(res, staticCandidates[url.pathname]);
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
