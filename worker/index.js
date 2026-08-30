const SESSION_COOKIE = "n9_session";
const SESSION_TTL = 60 * 60 * 24 * 7;
const PASSWORD_ITERATIONS = 210000;
const MAX_ARCHIVE_BYTES = 75 * 1024 * 1024;
const MAX_MESSAGES = 250000;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    display_name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('admin','user')),
    password_salt TEXT NOT NULL, password_hash TEXT NOT NULL,
    password_iterations INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until INTEGER,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, created_by TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, source_name TEXT,
    message_count INTEGER NOT NULL DEFAULT 0, archive_key TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, created_by TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id,user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON workspace_members(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)",
];

let schemaReady = false;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function fail(message, status = 400) { return json({ error: message }, status); }

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function randomToken(size = 32) {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(size)))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64(new Uint8Array(digest));
}

async function derivePassword(password, salt, iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations,
  }, key, 256);
  return bytesToBase64(new Uint8Array(bits));
}

async function createPasswordRecord(password) {
  const salt = randomToken(18);
  return { salt, hash: await derivePassword(password, salt), iterations: PASSWORD_ITERATIONS };
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

async function verifyPassword(password, user) {
  return constantTimeEqual(
    await derivePassword(password, user.password_salt, user.password_iterations),
    user.password_hash,
  );
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.get("cookie") || "").split(";").map((part) => part.trim())
    .filter(Boolean).map((part) => {
      const index = part.indexOf("=");
      return index < 0 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
    }));
}

function sessionCookie(token) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL}`;
}

function safeUser(user) {
  return {
    id: user.id, username: user.username, displayName: user.display_name,
    role: user.role, active: Boolean(user.active),
  };
}

async function ensureSchema(env) {
  if (schemaReady) return;
  if (!env.DB || !env.FILES) throw new Error("خدمات الحفظ الآمن غير متاحة.");
  await env.DB.batch(SCHEMA.map((statement) => env.DB.prepare(statement)));
  const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").bind("nasseh").first();
  if (!existing) {
    const now = Date.now();
    const adminId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const password = await createPasswordRecord(String(env.BOOTSTRAP_ADMIN_PASSWORD || "2005"));
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO users (
        id,username,display_name,role,password_salt,password_hash,password_iterations,
        active,failed_attempts,created_at,updated_at,created_by
      ) VALUES (?,?,?,'admin',?,?,?,1,0,?,?,?)`)
        .bind(adminId, "nasseh", "Nasseh", password.salt, password.hash, password.iterations, now, now, adminId),
      env.DB.prepare(`INSERT INTO workspaces (
        id,name,source_name,message_count,archive_key,created_at,updated_at,created_by
      ) VALUES (?,?,NULL,0,NULL,?,?,?)`).bind(workspaceId, "شركة الهاجدية", now, now, adminId),
      env.DB.prepare("INSERT INTO workspace_members (workspace_id,user_id,created_at) VALUES (?,?,?)")
        .bind(workspaceId, adminId, now),
    ]);
  }
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(Date.now()).run();
  schemaReady = true;
}

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function readJson(request) {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new Error("نوع البيانات غير مدعوم.");
  return request.json();
}

async function sessionUser(request, env) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  return env.DB.prepare(`SELECT users.* FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.active = 1`)
    .bind(await sha256(token), Date.now()).first();
}

async function canAccess(env, user, workspaceId) {
  if (user.role === "admin") return true;
  return Boolean(await env.DB.prepare(
    "SELECT 1 AS allowed FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
  ).bind(workspaceId, user.id).first());
}

async function workspaceIdsAreValid(env, workspaceIds) {
  for (const workspaceId of workspaceIds) {
    if (!(await env.DB.prepare("SELECT id FROM workspaces WHERE id=?").bind(workspaceId).first())) return false;
  }
  return true;
}

async function listWorkspaces(env, user) {
  const statement = user.role === "admin"
    ? env.DB.prepare(`SELECT id,name,source_name,message_count,created_at,updated_at
        FROM workspaces ORDER BY updated_at DESC,name ASC`)
    : env.DB.prepare(`SELECT workspaces.id,workspaces.name,workspaces.source_name,
        workspaces.message_count,workspaces.created_at,workspaces.updated_at
        FROM workspaces JOIN workspace_members ON workspace_members.workspace_id=workspaces.id
        WHERE workspace_members.user_id=? ORDER BY workspaces.updated_at DESC,workspaces.name ASC`).bind(user.id);
  const result = await statement.all();
  return (result.results || []).map((row) => ({
    id: row.id, name: row.name, sourceName: row.source_name || "لا يوجد ملف بعد",
    messageCount: Number(row.message_count || 0), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  }));
}

async function login(request, env) {
  if (!sameOrigin(request)) return fail("تعذر التحقق من مصدر الطلب.", 403);
  const body = await readJson(request);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!/^[A-Za-z0-9_.-]{3,30}$/.test(username) || !/^\d{4,12}$/.test(password)) return fail("بيانات الدخول غير صحيحة.", 401);
  const user = await env.DB.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE").bind(username).first();
  if (!user || !user.active) return fail("بيانات الدخول غير صحيحة.", 401);
  const now = Date.now();
  if (user.locked_until && Number(user.locked_until) > now) return fail("تم إيقاف المحاولات مؤقتًا. جرّب بعد 15 دقيقة.", 429);
  if (!(await verifyPassword(password, user))) {
    const attempts = Number(user.failed_attempts || 0) + 1;
    const lock = attempts >= 5 ? now + 15 * 60 * 1000 : null;
    await env.DB.prepare("UPDATE users SET failed_attempts=?,locked_until=?,updated_at=? WHERE id=?")
      .bind(lock ? 0 : attempts, lock, now, user.id).run();
    return fail(lock ? "تم إيقاف المحاولات مؤقتًا. جرّب بعد 15 دقيقة." : "بيانات الدخول غير صحيحة.", lock ? 429 : 401);
  }
  await env.DB.prepare("UPDATE users SET failed_attempts=0,locked_until=NULL,updated_at=? WHERE id=?").bind(now, user.id).run();
  const token = randomToken(36);
  await env.DB.prepare("INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)")
    .bind(await sha256(token), user.id, now, now + SESSION_TTL * 1000).run();
  return json({ user: safeUser(user), workspaces: await listWorkspaces(env, user) }, 200, { "set-cookie": sessionCookie(token) });
}

async function usersRoute(request, env, user, path) {
  if (user.role !== "admin") return fail("هذه الصلاحية متاحة للمدير فقط.", 403);
  if (request.method === "GET" && path === "/api/users") {
    const result = await env.DB.prepare(`SELECT users.id,users.username,users.display_name,users.role,users.active,
      GROUP_CONCAT(workspace_members.workspace_id) AS workspace_ids
      FROM users LEFT JOIN workspace_members ON workspace_members.user_id=users.id
      GROUP BY users.id ORDER BY users.created_at ASC`).all();
    return json({ users: (result.results || []).map((row) => ({
      id: row.id, username: row.username, displayName: row.display_name, role: row.role,
      active: Boolean(row.active), workspaceIds: row.workspace_ids ? String(row.workspace_ids).split(",") : [],
    })) });
  }
  if (request.method === "POST" && path === "/api/users") {
    if (!sameOrigin(request)) return fail("تعذر التحقق من مصدر الطلب.", 403);
    const body = await readJson(request);
    const username = String(body.username || "").trim();
    const displayName = String(body.displayName || username).trim();
    const pin = String(body.password || "");
    const role = body.role === "admin" ? "admin" : "user";
    const workspaceIds = [...new Set(Array.isArray(body.workspaceIds) ? body.workspaceIds.map(String) : [])];
    if (!/^[A-Za-z0-9_.-]{3,30}$/.test(username)) return fail("اسم المستخدم يجب أن يكون 3–30 حرفًا إنجليزيًا أو رقمًا.");
    if (!/^\d{4,12}$/.test(pin)) return fail("كلمة المرور يجب أن تكون من 4 إلى 12 رقمًا.");
    if (!displayName || displayName.length > 80) return fail("الاسم المعروض غير صالح.");
    if (!(await workspaceIdsAreValid(env, workspaceIds))) return fail("تتضمن الصلاحيات شركة غير موجودة.");
    if (await env.DB.prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE").bind(username).first()) return fail("اسم المستخدم مستخدم بالفعل.", 409);
    const id = crypto.randomUUID();
    const now = Date.now();
    const password = await createPasswordRecord(pin);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO users (
        id,username,display_name,role,password_salt,password_hash,password_iterations,
        active,failed_attempts,created_at,updated_at,created_by
      ) VALUES (?,?,?,?,?,?,?,1,0,?,?,?)`)
        .bind(id, username, displayName, role, password.salt, password.hash, password.iterations, now, now, user.id),
      ...workspaceIds.map((workspaceId) => env.DB.prepare(
        "INSERT OR IGNORE INTO workspace_members (workspace_id,user_id,created_at) VALUES (?,?,?)",
      ).bind(workspaceId, id, now)),
    ]);
    return json({ user: { id, username, displayName, role, active: true, workspaceIds } }, 201);
  }
  const match = path.match(/^\/api\/users\/([^/]+)$/);
  if (request.method === "PATCH" && match) {
    if (!sameOrigin(request)) return fail("تعذر التحقق من مصدر الطلب.", 403);
    const targetId = decodeURIComponent(match[1]);
    const body = await readJson(request);
    const target = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(targetId).first();
    if (!target) return fail("المستخدم غير موجود.", 404);
    if (targetId === user.id && body.active === false) return fail("لا يمكنك إيقاف حسابك الحالي.");
    const active = body.active === undefined ? Number(target.active) : body.active ? 1 : 0;
    const role = body.role === undefined ? target.role : body.role === "admin" ? "admin" : "user";
    const displayName = body.displayName === undefined ? target.display_name : String(body.displayName).trim();
    const workspaceIds = body.workspaceIds === undefined ? null : [...new Set(Array.isArray(body.workspaceIds) ? body.workspaceIds.map(String) : [])];
    if (workspaceIds && !(await workspaceIdsAreValid(env, workspaceIds))) return fail("تتضمن الصلاحيات شركة غير موجودة.");
    const statements = [env.DB.prepare("UPDATE users SET display_name=?,role=?,active=?,updated_at=? WHERE id=?")
      .bind(displayName, role, active, Date.now(), targetId)];
    if (body.password) {
      if (!/^\d{4,12}$/.test(String(body.password))) return fail("كلمة المرور يجب أن تكون من 4 إلى 12 رقمًا.");
      const password = await createPasswordRecord(String(body.password));
      statements.push(env.DB.prepare("UPDATE users SET password_salt=?,password_hash=?,password_iterations=?,updated_at=? WHERE id=?")
        .bind(password.salt, password.hash, password.iterations, Date.now(), targetId));
      statements.push(env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(targetId));
    }
    if (workspaceIds) {
      statements.push(env.DB.prepare("DELETE FROM workspace_members WHERE user_id=?").bind(targetId));
      statements.push(...workspaceIds.map((workspaceId) => env.DB.prepare(
        "INSERT OR IGNORE INTO workspace_members (workspace_id,user_id,created_at) VALUES (?,?,?)",
      ).bind(workspaceId, targetId, Date.now())));
    }
    await env.DB.batch(statements);
    return json({ ok: true });
  }
  return fail("المسار غير موجود.", 404);
}

async function workspacesRoute(request, env, user, path) {
  if (request.method === "GET" && path === "/api/workspaces") return json({ workspaces: await listWorkspaces(env, user) });
  if (request.method === "POST" && path === "/api/workspaces") {
    if (user.role !== "admin") return fail("إنشاء الشركات متاح للمدير فقط.", 403);
    if (!sameOrigin(request)) return fail("تعذر التحقق من مصدر الطلب.", 403);
    const name = String((await readJson(request)).name || "").trim();
    if (name.length < 2 || name.length > 80) return fail("اسم الشركة يجب أن يكون بين حرفين و80 حرفًا.");
    if (await env.DB.prepare("SELECT id FROM workspaces WHERE name=? COLLATE NOCASE").bind(name).first()) return fail("توجد شركة بهذا الاسم بالفعل.", 409);
    const id = crypto.randomUUID();
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO workspaces (
        id,name,source_name,message_count,archive_key,created_at,updated_at,created_by
      ) VALUES (?,?,NULL,0,NULL,?,?,?)`).bind(id, name, now, now, user.id),
      env.DB.prepare("INSERT INTO workspace_members (workspace_id,user_id,created_at) VALUES (?,?,?)").bind(id, user.id, now),
    ]);
    return json({ workspace: { id, name, sourceName: "لا يوجد ملف بعد", messageCount: 0, createdAt: now, updatedAt: now } }, 201);
  }
  const match = path.match(/^\/api\/workspaces\/([^/]+)\/archive$/);
  if (!match) return fail("المسار غير موجود.", 404);
  const workspaceId = decodeURIComponent(match[1]);
  if (!(await canAccess(env, user, workspaceId))) return fail("لا تملك صلاحية هذه الشركة.", 403);
  const workspace = await env.DB.prepare("SELECT * FROM workspaces WHERE id=?").bind(workspaceId).first();
  if (!workspace) return fail("الشركة غير موجودة.", 404);
  if (request.method === "GET") {
    if (!workspace.archive_key) return json({ sourceName: "لا يوجد ملف بعد", messages: [] });
    const object = await env.FILES.get(workspace.archive_key);
    if (!object) return fail("تعذر العثور على أرشيف هذه الشركة.", 404);
    return new Response(object.body, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  }
  if (request.method === "PUT") {
    if (!sameOrigin(request)) return fail("تعذر التحقق من مصدر الطلب.", 403);
    if (Number(request.headers.get("content-length") || 0) > MAX_ARCHIVE_BYTES) return fail("حجم الأرشيف أكبر من الحد الآمن للحفظ.", 413);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_ARCHIVE_BYTES) return fail("حجم الأرشيف أكبر من الحد الآمن للحفظ.", 413);
    let body;
    try { body = JSON.parse(raw); } catch { return fail("بيانات الأرشيف غير صالحة."); }
    if (!Array.isArray(body.messages) || body.messages.length > MAX_MESSAGES) return fail("عدد الرسائل غير صالح أو أكبر من الحد المسموح.");
    const sourceName = String(body.sourceName || "أرشيف XML").slice(0, 180);
    const key = `workspaces/${workspaceId}/archives/${crypto.randomUUID()}.json`;
    await env.FILES.put(key, JSON.stringify({ sourceName, messages: body.messages, savedAt: Date.now(), version: 1 }), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
    });
    const oldKey = workspace.archive_key;
    await env.DB.prepare("UPDATE workspaces SET source_name=?,message_count=?,archive_key=?,updated_at=? WHERE id=?")
      .bind(sourceName, body.messages.length, key, Date.now(), workspaceId).run();
    if (oldKey && oldKey !== key) await env.FILES.delete(oldKey).catch(() => {});
    return json({ ok: true, messageCount: body.messages.length, sourceName });
  }
  return fail("الطريقة غير مدعومة.", 405);
}

async function handleApi(request, env) {
  try {
    const path = new URL(request.url).pathname;
    const knownPath = path === "/api/auth/login"
      || path === "/api/auth/logout"
      || path === "/api/auth/me"
      || path === "/api/users"
      || path.startsWith("/api/users/")
      || path === "/api/workspaces"
      || path.startsWith("/api/workspaces/");
    if (!knownPath) return fail("المسار غير موجود.", 404);
    await ensureSchema(env);
    if (request.method === "POST" && path === "/api/auth/login") return login(request, env);
    if (request.method === "POST" && path === "/api/auth/logout") {
      if (!sameOrigin(request)) return fail("تعذر التحقق من مصدر الطلب.", 403);
      const token = parseCookies(request)[SESSION_COOKIE];
      if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(token)).run();
      return json({ ok: true }, 200, {
        "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
      });
    }
    const user = await sessionUser(request, env);
    if (!user) return fail("يجب تسجيل الدخول أولًا.", 401);
    if (request.method === "GET" && path === "/api/auth/me") return json({ user: safeUser(user), workspaces: await listWorkspaces(env, user) });
    if (path === "/api/users" || path.startsWith("/api/users/")) return usersRoute(request, env, user, path);
    if (path === "/api/workspaces" || path.startsWith("/api/workspaces/")) return workspacesRoute(request, env, user, path);
    return fail("المسار غير موجود.", 404);
  } catch (error) {
    return fail(error?.message || "حدث خطأ غير متوقع في الخادم.", 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env);
    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");
    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) return response;
    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },
};

export { createPasswordRecord, derivePassword, handleApi, verifyPassword };
