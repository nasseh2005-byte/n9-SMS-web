import { neon } from "@neondatabase/serverless";
import { createArchiveReader } from "./archiveCache.js";
import { del, get, head, issueSignedToken, presignUrl } from "@vercel/blob";
import { hasManualMessageChanges } from "../src/archivePermissions.js";
import { CONVERSATION_READ_ONLY, conversationCatalogue, conversationPage, decodeConversationPolicy, filterConversationArchive, validateConversationPolicy } from "../src/conversationAccess.js";

const SESSION_COOKIE = "n9_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const PASSWORD_ITERATIONS = 210000;
const MAX_ARCHIVE_BYTES = 75 * 1024 * 1024;
const MAX_MESSAGES = 250000;
const UPLOAD_URL_TTL = 15 * 60 * 1000;
const DOWNLOAD_URL_TTL = 5 * 60 * 1000;

const POSTGRES_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','user')),
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_iterations INTEGER NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until BIGINT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    created_by TEXT
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username))",
  `CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source_name TEXT,
    message_count INTEGER NOT NULL DEFAULT 0,
    archive_key TEXT,
    archive_etag TEXT,
    archive_size BIGINT,
    archive_version BIGINT NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    created_by TEXT NOT NULL
  )`,
  "ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS archive_etag TEXT",
  "ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS archive_size BIGINT",
  "ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS archive_version BIGINT NOT NULL DEFAULT 0",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_name_lower ON workspaces (LOWER(name))",
  `CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (workspace_id,user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS conversation_permissions (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    addresses TEXT NOT NULL, revision TEXT NOT NULL,
    PRIMARY KEY (user_id,workspace_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON workspace_members(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)",
];

let databaseClient;
let schemaReady = false;

class ServiceConfigurationError extends Error {}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function fail(message, status = 400) {
  return json({ error: message }, status);
}

function getDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new ServiceConfigurationError("قاعدة البيانات السحابية غير مرتبطة. اربط Neon بالمشروع في Vercel ثم أعد النشر.");
  }
  if (!databaseClient) databaseClient = neon(connectionString);
  return databaseClient;
}

function requireBlobStorage() {
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
    throw new ServiceConfigurationError("تخزين ملفات XML غير مرتبط. أنشئ Vercel Blob خاصًا واربطه بالمشروع ثم أعد النشر.");
  }
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function randomToken(size = 32) {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(size)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64(new Uint8Array(digest));
}

async function derivePassword(password, salt, iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt: new TextEncoder().encode(salt),
    iterations,
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
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function verifyPassword(password, user) {
  return constantTimeEqual(
    await derivePassword(password, user.password_salt, Number(user.password_iterations)),
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
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`;
}

function safeUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    active: Boolean(user.active),
  };
}

async function ensureSchema(sql = getDatabase()) {
  if (schemaReady) return;
  for (const statement of POSTGRES_SCHEMA) await sql.query(statement);

  const existing = await sql.query("SELECT id FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1", ["nasseh"]);
  if (!existing.length) {
    const bootstrapPassword = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || "");
    if (!/^\d{4,12}$/.test(bootstrapPassword)) {
      throw new ServiceConfigurationError("عيّن BOOTSTRAP_ADMIN_PASSWORD إلى كلمة رقمية من 4–12 رقمًا قبل أول تشغيل.");
    }
    const now = Date.now();
    const adminId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const password = await createPasswordRecord(bootstrapPassword);
    await sql.query(
      `WITH inserted_user AS (
        INSERT INTO users (
          id,username,display_name,role,password_salt,password_hash,password_iterations,
          active,failed_attempts,created_at,updated_at,created_by
        ) VALUES ($1,$2,$3,'admin',$4,$5,$6,TRUE,0,$7,$7,$1)
        ON CONFLICT DO NOTHING RETURNING id
      ), inserted_workspace AS (
        INSERT INTO workspaces (
          id,name,source_name,message_count,archive_key,created_at,updated_at,created_by
        ) SELECT $8,$9,NULL,0,NULL,$7,$7,id FROM inserted_user
        ON CONFLICT DO NOTHING RETURNING id
      )
      INSERT INTO workspace_members (workspace_id,user_id,created_at)
      SELECT inserted_workspace.id,inserted_user.id,$7 FROM inserted_workspace CROSS JOIN inserted_user
      ON CONFLICT DO NOTHING`,
      [adminId, "nasseh", "Nasseh", password.salt, password.hash, password.iterations, now, workspaceId, "شركة الهاجدية"],
    );
  }
  await sql.query("DELETE FROM sessions WHERE expires_at <= $1", [Date.now()]);
  schemaReady = true;
}

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function readJson(request) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    throw new Error("نوع البيانات غير مدعوم.");
  }
  return request.json();
}

async function sessionUser(request, sql) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const rows = await sql.query(
    `SELECT users.* FROM sessions
     JOIN users ON users.id=sessions.user_id
     WHERE sessions.token_hash=$1 AND sessions.expires_at>$2 AND users.active=TRUE
     LIMIT 1`,
    [await sha256(token), Date.now()],
  );
  return rows[0] || null;
}

async function canAccess(sql, user, workspaceId) {
  if (user.role === "admin") return true;
  const rows = await sql.query(
    "SELECT 1 AS allowed FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 LIMIT 1",
    [workspaceId, user.id],
  );
  return Boolean(rows[0]);
}

async function conversationPolicy(sql, user, workspaceId) {
  if (user.role === "admin") return decodeConversationPolicy(null);
  const rows = await sql.query("SELECT addresses,revision FROM conversation_permissions WHERE user_id=$1 AND workspace_id=$2", [user.id, workspaceId]);
  return decodeConversationPolicy(rows[0]);
}

async function conversationPermissionsRoute(request, sql, match) {
  const [, encodedUser, encodedWorkspace] = match;
  const userId = decodeURIComponent(encodedUser);
  const workspaceId = decodeURIComponent(encodedWorkspace);
  const targets = await sql.query("SELECT id,role FROM users WHERE id=$1", [userId]);
  const target = targets[0];
  if (!target) return fail("المستخدم غير موجود.", 404);
  if (target.role === "admin") return fail("المشرف يرى جميع المحادثات.", 400);
  if (!(await canAccess(sql, target, workspaceId))) return fail("احفظ تفويض الشركة لهذا المستخدم أولًا.", 403);
  const [workspace] = await sql.query("SELECT * FROM workspaces WHERE id=$1", [workspaceId]);
  if (!workspace) return fail("الشركة غير موجودة.", 404);
  const policy = await conversationPolicy(sql, target, workspaceId);
  if (request.method === "GET") {
    const catalogue = conversationCatalogue((await readPrivateArchive(workspace.archive_key)).messages);
    const page = conversationPage(catalogue, new URL(request.url), `${workspace.archive_version}:${policy.revision}`);
    return json({ policy, conversations: page.items, nextCursor: page.nextCursor, revision: page.revision });
  }
  if (request.method === "PATCH") {
    if (!sameOrigin(request)) return fail("تعذر التحقق من مصدر الطلب.", 403);
    const input = await readJson(request);
    const next = validateConversationPolicy(input);
    if (input.expectedRevision !== policy.revision) return fail("تغيرت الصلاحيات. أعد فتح نافذة الاختيار.", 409);
    if (next.mode === "selected") {
      const catalogue = conversationCatalogue((await readPrivateArchive(workspace.archive_key)).messages);
      const known = new Set([...catalogue.map((item) => item.address), ...policy.addresses]);
      if (next.addresses.some((address) => !known.has(address))) return fail("تتضمن الصلاحيات محادثة غير موجودة.");
    }
    // Lock the user row to serialize concurrent permission edits, including the legacy all mode.
    const revision = crypto.randomUUID();
    const result = await sql.query(`WITH locked AS (
      SELECT id FROM users WHERE id=$1 FOR UPDATE
    ), checked AS (
      SELECT id FROM locked WHERE COALESCE((SELECT revision FROM conversation_permissions WHERE user_id=$1 AND workspace_id=$2),'legacy')=$3
    ) INSERT INTO conversation_permissions (user_id,workspace_id,addresses,revision)
      SELECT id,$2,$4,$5 FROM checked
      ON CONFLICT (user_id,workspace_id) DO UPDATE SET addresses=EXCLUDED.addresses,revision=EXCLUDED.revision
      WHERE conversation_permissions.revision=$3 RETURNING revision`,
      [userId, workspaceId, input.expectedRevision, next.mode === "all" ? "null" : JSON.stringify(next.addresses), revision]);
    if (!result.length) return fail("تغيرت الصلاحيات. أعد فتح نافذة الاختيار.", 409);
    return json({ ok: true });
  }
  return fail("الطريقة غير مدعومة.", 405);
}

async function workspaceIdsAreValid(sql, workspaceIds) {
  if (!workspaceIds.length) return true;
  const rows = await sql.query("SELECT id FROM workspaces WHERE id=ANY($1::text[])", [workspaceIds]);
  return rows.length === workspaceIds.length;
}

async function listWorkspaces(sql, user) {
  const rows = user.role === "admin"
    ? await sql.query(`SELECT id,name,source_name,message_count,created_at,updated_at
        FROM workspaces ORDER BY updated_at DESC,name ASC`)
    : await sql.query(`SELECT workspaces.id,workspaces.name,workspaces.source_name,
        workspaces.message_count,workspaces.created_at,workspaces.updated_at
        FROM workspaces JOIN workspace_members ON workspace_members.workspace_id=workspaces.id
        WHERE workspace_members.user_id=$1 ORDER BY workspaces.updated_at DESC,workspaces.name ASC`, [user.id]);
  const permissions = user.role === "admin" ? [] : await sql.query("SELECT workspace_id,addresses,revision FROM conversation_permissions WHERE user_id=$1", [user.id]);
  const policies = new Map(permissions.map((row) => [row.workspace_id, decodeConversationPolicy(row)]));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    sourceName: policies.get(row.id)?.mode === "selected" ? "المحادثات المصرح بها" : row.source_name || "لا يوجد ملف بعد",
    messageCount: policies.get(row.id)?.mode === "selected" ? 0 : Number(row.message_count || 0),
    readOnly: policies.get(row.id)?.mode === "selected",
    accessRevision: policies.get(row.id)?.revision || "legacy",
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }));
}

async function login(request, sql) {
  if (!sameOrigin(request)) return fail("تعذر التحقق من مصدر الطلب.", 403);
  const body = await readJson(request);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!/^[A-Za-z0-9_.-]{3,30}$/.test(username) || !/^\d{4,12}$/.test(password)) {
    return fail("بيانات الدخول غير صحيحة.", 401);
  }
  const users = await sql.query("SELECT * FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1", [username]);
  const user = users[0];
  if (!user || !user.active) return fail("بيانات الدخول غير صحيحة.", 401);
  const now = Date.now();
  if (user.locked_until && Number(user.locked_until) > now) {
    return fail("تم إيقاف المحاولات مؤقتًا. جرّب بعد 15 دقيقة.", 429);
  }
  if (!(await verifyPassword(password, user))) {
    const attempts = Number(user.failed_attempts || 0) + 1;
    const lockedUntil = attempts >= 5 ? now + 15 * 60 * 1000 : null;
    await sql.query(
      "UPDATE users SET failed_attempts=$1,locked_until=$2,updated_at=$3 WHERE id=$4",
      [lockedUntil ? 0 : attempts, lockedUntil, now, user.id],
    );
    return fail(lockedUntil ? "تم إيقاف المحاولات مؤقتًا. جرّب بعد 15 دقيقة." : "بيانات الدخول غير صحيحة.", lockedUntil ? 429 : 401);
  }
  await sql.query("UPDATE users SET failed_attempts=0,locked_until=NULL,updated_at=$1 WHERE id=$2", [now, user.id]);
  const token = randomToken(36);
  await sql.query(
    "INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES ($1,$2,$3,$4)",
    [await sha256(token), user.id, now, now + SESSION_TTL_SECONDS * 1000],
  );
  return json(
    { user: safeUser(user), workspaces: await listWorkspaces(sql, user) },
    200,
    { "set-cookie": sessionCookie(token) },
  );
}

async function usersRoute(request, sql, user, path) {
  if (user.role !== "admin") return fail("هذه الصلاحية متاحة للمدير فقط.", 403);
  const conversationMatch = path.match(/^\/api\/users\/([^/]+)\/workspaces\/([^/]+)\/conversations$/);
  if (conversationMatch) return conversationPermissionsRoute(request, sql, conversationMatch);
  if (request.method === "GET" && path === "/api/users") {
    const rows = await sql.query(`SELECT users.id,users.username,users.display_name,users.role,users.active,
      STRING_AGG(workspace_members.workspace_id, ',' ORDER BY workspace_members.workspace_id) AS workspace_ids
      FROM users LEFT JOIN workspace_members ON workspace_members.user_id=users.id
      GROUP BY users.id ORDER BY users.created_at ASC`);
    return json({ users: rows.map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      active: Boolean(row.active),
      workspaceIds: row.workspace_ids ? String(row.workspace_ids).split(",") : [],
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
    if (!(await workspaceIdsAreValid(sql, workspaceIds))) return fail("تتضمن الصلاحيات شركة غير موجودة.");
    if ((await sql.query("SELECT id FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1", [username]))[0]) {
      return fail("اسم المستخدم مستخدم بالفعل.", 409);
    }
    const id = crypto.randomUUID();
    const now = Date.now();
    const password = await createPasswordRecord(pin);
    try {
      await sql.transaction((transaction) => [
        transaction`INSERT INTO users (
          id,username,display_name,role,password_salt,password_hash,password_iterations,
          active,failed_attempts,created_at,updated_at,created_by
        ) VALUES (${id},${username},${displayName},${role},${password.salt},${password.hash},${password.iterations},TRUE,0,${now},${now},${user.id})`,
        ...workspaceIds.map((workspaceId) => transaction`
          INSERT INTO workspace_members (workspace_id,user_id,created_at)
          VALUES (${workspaceId},${id},${now}) ON CONFLICT DO NOTHING`),
        ...workspaceIds.filter(() => role !== "admin").map((workspaceId) => transaction`
          INSERT INTO conversation_permissions (user_id,workspace_id,addresses,revision)
          VALUES (${id},${workspaceId},'[]',${crypto.randomUUID()})`),
      ]);
    } catch (error) {
      if (error?.code === "23505") return fail("اسم المستخدم مستخدم بالفعل.", 409);
      throw error;
    }
    return json({ user: { id, username, displayName, role, active: true, workspaceIds } }, 201);
  }

  const match = path.match(/^\/api\/users\/([^/]+)$/);
  if (request.method === "PATCH" && match) {
    if (!sameOrigin(request)) return fail("تعذر التحقق من مصدر الطلب.", 403);
    const targetId = decodeURIComponent(match[1]);
    const body = await readJson(request);
    const targets = await sql.query("SELECT * FROM users WHERE id=$1 LIMIT 1", [targetId]);
    const target = targets[0];
    if (!target) return fail("المستخدم غير موجود.", 404);
    if (targetId === user.id && body.active === false) return fail("لا يمكنك إيقاف حسابك الحالي.");
    const active = body.active === undefined ? Boolean(target.active) : Boolean(body.active);
    const role = body.role === undefined ? target.role : body.role === "admin" ? "admin" : "user";
    const displayName = body.displayName === undefined ? target.display_name : String(body.displayName).trim();
    const workspaceIds = body.workspaceIds === undefined
      ? null
      : [...new Set(Array.isArray(body.workspaceIds) ? body.workspaceIds.map(String) : [])];
    if (!displayName || displayName.length > 80) return fail("الاسم المعروض غير صالح.");
    if (workspaceIds && !(await workspaceIdsAreValid(sql, workspaceIds))) return fail("تتضمن الصلاحيات شركة غير موجودة.");
    let password;
    if (body.password) {
      if (!/^\d{4,12}$/.test(String(body.password))) return fail("كلمة المرور يجب أن تكون من 4 إلى 12 رقمًا.");
      password = await createPasswordRecord(String(body.password));
    }
    await sql.transaction((transaction) => {
      const queries = [transaction`
        UPDATE users SET display_name=${displayName},role=${role},active=${active},updated_at=${Date.now()}
        WHERE id=${targetId}`];
      if (password) {
        queries.push(transaction`
          UPDATE users SET password_salt=${password.salt},password_hash=${password.hash},
            password_iterations=${password.iterations},updated_at=${Date.now()} WHERE id=${targetId}`);
        queries.push(transaction`DELETE FROM sessions WHERE user_id=${targetId}`);
      }
      if (workspaceIds) {
        if (role !== "admin") queries.push(...workspaceIds.map((workspaceId) => transaction`
          INSERT INTO conversation_permissions (user_id,workspace_id,addresses,revision)
          SELECT ${targetId},${workspaceId},'[]',${crypto.randomUUID()}
          WHERE NOT EXISTS (SELECT 1 FROM workspace_members WHERE user_id=${targetId} AND workspace_id=${workspaceId})
          ON CONFLICT DO NOTHING`));
        queries.push(transaction`DELETE FROM workspace_members WHERE user_id=${targetId}`);
        queries.push(...workspaceIds.map((workspaceId) => transaction`
          INSERT INTO workspace_members (workspace_id,user_id,created_at)
          VALUES (${workspaceId},${targetId},${Date.now()}) ON CONFLICT DO NOTHING`));
      }
      return queries;
    });
    return json({ ok: true });
  }
  return fail("المسار غير موجود.", 404);
}

async function createArchiveUpload(sql, user, workspace, request) {
  if (!sameOrigin(request)) return fail("تعذر التحقق من مصدر الطلب.", 403);
  requireBlobStorage();
  const body = await readJson(request);
  const size = Number(body.size || 0);
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_ARCHIVE_BYTES) {
    return fail("حجم الأرشيف غير صالح أو أكبر من الحد الآمن للحفظ.", 413);
  }
  const archiveKey = `workspaces/${workspace.id}/archives/${crypto.randomUUID()}.json`;
  const validUntil = Date.now() + UPLOAD_URL_TTL;
  const signedToken = await issueSignedToken({
    pathname: archiveKey,
    operations: ["put"],
    validUntil,
    allowedContentTypes: ["application/json"],
    maximumSizeInBytes: MAX_ARCHIVE_BYTES,
  });
  const { presignedUrl } = await presignUrl(signedToken, {
    access: "private",
    operation: "put",
    pathname: archiveKey,
    validUntil,
    allowedContentTypes: ["application/json"],
    maximumSizeInBytes: MAX_ARCHIVE_BYTES,
    addRandomSuffix: false,
    allowOverwrite: false,
    cacheControlMaxAge: 60,
  });
  return json({
    uploadUrl: presignedUrl,
    archiveKey,
    expectedVersion: Number(workspace.archive_version || 0),
  });
}

const readPrivateArchive = createArchiveReader(async (archiveKey) => {
  const result = await get(archiveKey, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) throw new Error("تعذر قراءة أرشيف الشركة. أعد المحاولة.");
  const archive = await new Response(result.stream).json();
  if (!Array.isArray(archive?.messages)) throw new Error("الأرشيف السحابي غير صالح. راجع المشرف.");
  return archive;
});

async function completeArchiveUpload(sql, user, workspace, request) {
  if (!sameOrigin(request)) return fail("تعذر التحقق من مصدر الطلب.", 403);
  requireBlobStorage();
  const body = await readJson(request);
  const archiveKey = String(body.archiveKey || "");
  const expectedVersion = Number(body.expectedVersion);
  const allowedPrefix = `workspaces/${workspace.id}/archives/`;
  if (!archiveKey.startsWith(allowedPrefix) || !archiveKey.endsWith(".json") || archiveKey.includes("..")) {
    return fail("مسار الأرشيف غير صالح.");
  }
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) return fail("إصدار الأرشيف غير صالح.");

  let blobInfo;
  let archive;
  try {
    blobInfo = await head(archiveKey);
    if (Number(blobInfo.size) > MAX_ARCHIVE_BYTES) throw new Error("حجم الأرشيف أكبر من الحد الآمن للحفظ.");
    const result = await get(archiveKey, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) throw new Error("تعذر قراءة الأرشيف المرفوع.");
    archive = await new Response(result.stream).json();
  } catch (error) {
    await del(archiveKey).catch(() => {});
    return fail(error?.message || "تعذر التحقق من الأرشيف المرفوع.", 400);
  }

  if (!Array.isArray(archive?.messages) || archive.messages.length > MAX_MESSAGES) {
    await del(archiveKey).catch(() => {});
    return fail("عدد الرسائل غير صالح أو أكبر من الحد المسموح.");
  }
  if (user.role !== "admin") {
    let previousArchive;
    try {
      previousArchive = await readPrivateArchive(workspace.archive_key);
    } catch {
      await del(archiveKey).catch(() => {});
      return fail("تعذر التحقق من صلاحية منشئ الرسالة. لم تتغير النسخة المحفوظة.", 409);
    }
    if (hasManualMessageChanges(previousArchive.messages, archive.messages)) {
      await del(archiveKey).catch(() => {});
      return fail("منشئ الرسالة متاح للمشرف فقط.", 403);
    }
  }
  const sourceName = String(archive.sourceName || "أرشيف XML").slice(0, 180);
  const now = Date.now();
  const updated = await sql.query(
    `UPDATE workspaces SET source_name=$1,message_count=$2,archive_key=$3,archive_etag=$4,
      archive_size=$5,archive_version=archive_version+1,updated_at=$6
     WHERE id=$7 AND archive_version=$8
       AND ($9='admin' OR (EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id=$7 AND user_id=$10)
         AND NOT EXISTS (SELECT 1 FROM conversation_permissions WHERE workspace_id=$7 AND user_id=$10 AND addresses<>'null')))
     RETURNING archive_version`,
    [sourceName, archive.messages.length, archiveKey, blobInfo.etag || null, Number(blobInfo.size), now, workspace.id, expectedVersion, user.role, user.id],
  );
  if (!updated.length) {
    await del(archiveKey).catch(() => {});
    return fail("تغير الأرشيف من جهاز آخر أثناء الحفظ. حدّث الصفحة ثم أعد المحاولة حتى لا تضيع أي رسائل.", 409);
  }
  if (workspace.archive_key && workspace.archive_key !== archiveKey) {
    await del(workspace.archive_key).catch(() => {});
  }
  return json({
    ok: true,
    sourceName,
    messageCount: archive.messages.length,
    archiveVersion: Number(updated[0].archive_version),
  });
}

async function archiveDescriptor(workspace) {
  if (!workspace.archive_key) return json({ sourceName: "لا يوجد ملف بعد", messages: [] });
  requireBlobStorage();
  const validUntil = Date.now() + DOWNLOAD_URL_TTL;
  const signedToken = await issueSignedToken({
    pathname: workspace.archive_key,
    operations: ["get"],
    validUntil,
  });
  const { presignedUrl } = await presignUrl(signedToken, {
    access: "private",
    operation: "get",
    pathname: workspace.archive_key,
    validUntil,
    useCache: false,
  });
  return json({
    archiveUrl: presignedUrl,
    sourceName: workspace.source_name || "أرشيف XML",
    messageCount: Number(workspace.message_count || 0),
  });
}

async function workspacesRoute(request, sql, user, path, { readArchive = readPrivateArchive } = {}) {
  if (request.method === "GET" && path === "/api/workspaces") {
    return json({ workspaces: await listWorkspaces(sql, user) });
  }
  if (request.method === "POST" && path === "/api/workspaces") {
    if (user.role !== "admin") return fail("إنشاء الشركات متاح للمدير فقط.", 403);
    if (!sameOrigin(request)) return fail("تعذر التحقق من مصدر الطلب.", 403);
    const name = String((await readJson(request)).name || "").trim();
    if (name.length < 2 || name.length > 80) return fail("اسم الشركة يجب أن يكون بين حرفين و80 حرفًا.");
    if ((await sql.query("SELECT id FROM workspaces WHERE LOWER(name)=LOWER($1) LIMIT 1", [name]))[0]) {
      return fail("توجد شركة بهذا الاسم بالفعل.", 409);
    }
    const id = crypto.randomUUID();
    const now = Date.now();
    try {
      await sql.transaction((transaction) => [
        transaction`INSERT INTO workspaces (
          id,name,source_name,message_count,archive_key,created_at,updated_at,created_by
        ) VALUES (${id},${name},NULL,0,NULL,${now},${now},${user.id})`,
        transaction`INSERT INTO workspace_members (workspace_id,user_id,created_at)
          VALUES (${id},${user.id},${now}) ON CONFLICT DO NOTHING`,
      ]);
    } catch (error) {
      if (error?.code === "23505") return fail("توجد شركة بهذا الاسم بالفعل.", 409);
      throw error;
    }
    return json({ workspace: { id, name, sourceName: "لا يوجد ملف بعد", messageCount: 0, createdAt: now, updatedAt: now } }, 201);
  }

  const match = path.match(/^\/api\/workspaces\/([^/]+)\/archive(?:\/(upload-url|complete))?$/);
  if (!match) return fail("المسار غير موجود.", 404);
  const workspaceId = decodeURIComponent(match[1]);
  if (!(await canAccess(sql, user, workspaceId))) return fail("لا تملك صلاحية هذه الشركة.", 403);
  const rows = await sql.query("SELECT * FROM workspaces WHERE id=$1 LIMIT 1", [workspaceId]);
  const workspace = rows[0];
  if (!workspace) return fail("الشركة غير موجودة.", 404);
  const action = match[2] || "";
  const policy = await conversationPolicy(sql, user, workspaceId);
  if (request.method === "GET" && !action) {
    if (user.role === "admin") return archiveDescriptor(workspace);
    const archive = await readArchive(workspace.archive_key);
    if (!(await canAccess(sql, user, workspaceId))) return fail("لا تملك صلاحية هذه الشركة.", 403);
    const latestPolicy = await conversationPolicy(sql, user, workspaceId);
    if (latestPolicy.revision !== policy.revision) return fail("تغيرت صلاحيات المحادثات. أعد تحميل الأرشيف.", 409);
    const filtered = filterConversationArchive(archive, latestPolicy);
    const page = conversationPage(filtered.messages, new URL(request.url), `${workspace.archive_version}:${policy.revision}`, { limit: 10000 });
    return json({ sourceName: filtered.sourceName || "أرشيف XML", readOnly: policy.mode === "selected", messages: page.items, nextCursor: page.nextCursor, revision: page.revision, total: filtered.messages.length });
  }
  if (policy.mode === "selected") return fail(CONVERSATION_READ_ONLY, 403);
  if (request.method === "POST" && action === "upload-url") return createArchiveUpload(sql, user, workspace, request);
  if (request.method === "POST" && action === "complete") return completeArchiveUpload(sql, user, workspace, request);
  return fail("الطريقة غير مدعومة.", 405);
}

function resolveApiPath(request) {
  const url = new URL(request.url);
  const rewrittenPath = url.searchParams.get("path");
  if (rewrittenPath) return `/api/${rewrittenPath.replace(/^\/+/, "")}`;
  return url.pathname === "/api/index" ? "/api" : url.pathname;
}

async function handleVercelApi(request) {
  try {
    const path = resolveApiPath(request);
    const knownPath = path === "/api/auth/login"
      || path === "/api/auth/logout"
      || path === "/api/auth/me"
      || path === "/api/users"
      || path.startsWith("/api/users/")
      || path === "/api/workspaces"
      || path.startsWith("/api/workspaces/");
    if (!knownPath) return fail("المسار غير موجود.", 404);
    const sql = getDatabase();
    await ensureSchema(sql);

    if (request.method === "POST" && path === "/api/auth/login") return login(request, sql);
    if (request.method === "POST" && path === "/api/auth/logout") {
      if (!sameOrigin(request)) return fail("تعذر التحقق من مصدر الطلب.", 403);
      const token = parseCookies(request)[SESSION_COOKIE];
      if (token) await sql.query("DELETE FROM sessions WHERE token_hash=$1", [await sha256(token)]);
      return json({ ok: true }, 200, {
        "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
      });
    }

    const user = await sessionUser(request, sql);
    if (!user) return fail("يجب تسجيل الدخول أولًا.", 401);
    if (request.method === "GET" && path === "/api/auth/me") {
      return json({ user: safeUser(user), workspaces: await listWorkspaces(sql, user) });
    }
    if (path === "/api/users" || path.startsWith("/api/users/")) return usersRoute(request, sql, user, path);
    if (path === "/api/workspaces" || path.startsWith("/api/workspaces/")) return workspacesRoute(request, sql, user, path);
    return fail("المسار غير موجود.", 404);
  } catch (error) {
    if (error instanceof ServiceConfigurationError) return fail(error.message, 503);
    if (error.status === 409 || error.status === 400) return fail(error.message, error.status);
    console.error("N9 Vercel API error", error);
    return fail("حدث خطأ غير متوقع في الخادم. لم تُحفظ أي تغييرات.", 500);
  }
}

export {
  POSTGRES_SCHEMA,
  ServiceConfigurationError,
  constantTimeEqual,
  createPasswordRecord,
  derivePassword,
  handleVercelApi,
  resolveApiPath,
  verifyPassword,
  workspacesRoute,
  usersRoute,
};
