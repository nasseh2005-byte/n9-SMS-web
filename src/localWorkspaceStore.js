import { loadCurrentArchive, loadWorkspaceArchive, saveWorkspaceArchive } from "./localStore.js";
import { hasManualMessageChanges } from "./archivePermissions.js";

const DATABASE_NAME = "n9-sms-access-local";
const DATABASE_VERSION = 1;
const STORE_NAME = "state";
const STATE_KEY = "current";
const ADMIN_ID = "local-admin-nasseh";
const DEFAULT_WORKSPACE_ID = "local-company-hajdiya";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("تعذر فتح التخزين المحلي."));
  });
}

function transact(mode, action) {
  return openDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = action(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("تعذر حفظ بيانات الإدارة."));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => database.close();
  }));
}

async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function initialState() {
  const now = Date.now();
  const salt = crypto.randomUUID();
  return {
    sessionUserId: null,
    users: [{
      id: ADMIN_ID,
      username: "nasseh",
      displayName: "Nasseh",
      role: "admin",
      active: true,
      workspaceIds: [DEFAULT_WORKSPACE_ID],
      salt,
      pinHash: await hashPin("2005", salt),
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: now,
    }],
    workspaces: [{
      id: DEFAULT_WORKSPACE_ID,
      name: "شركة الهاجدية",
      sourceName: "بيانات تجريبية",
      messageCount: 0,
      createdAt: now,
      updatedAt: now,
    }],
  };
}

async function readState() {
  let state = await transact("readonly", (store) => store.get(STATE_KEY));
  if (!state) {
    state = await initialState();
    await writeState(state);
  }
  return state;
}

function writeState(state) {
  return transact("readwrite", (store) => store.put(state, STATE_KEY));
}

function safeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    active: user.active,
  };
}

function visibleWorkspaces(state, user) {
  const allowed = new Set(user.workspaceIds || []);
  return state.workspaces.filter((workspace) => user.role === "admin" || allowed.has(workspace.id));
}

export async function initializeLocalWorkspaceStore(sampleMessages) {
  const state = await readState();
  const defaultWorkspace = state.workspaces.find((workspace) => workspace.id === DEFAULT_WORKSPACE_ID);
  if (defaultWorkspace) {
    let archive = await loadWorkspaceArchive(DEFAULT_WORKSPACE_ID);
    if (!archive) {
      archive = await loadCurrentArchive().catch(() => null);
      await saveWorkspaceArchive(
        DEFAULT_WORKSPACE_ID,
        archive?.messages?.length ? archive.messages : sampleMessages,
        archive?.sourceName || "بيانات تجريبية",
      );
    }
    defaultWorkspace.sourceName = archive?.sourceName || "بيانات تجريبية";
    defaultWorkspace.messageCount = archive?.messages?.length || sampleMessages.length;
    defaultWorkspace.updatedAt = archive?.savedAt || defaultWorkspace.updatedAt;
    await writeState(state);
  }
  const user = state.users.find((item) => item.id === state.sessionUserId && item.active);
  return { user: safeUser(user), workspaces: user ? visibleWorkspaces(state, user) : [] };
}

export async function localLogin(username, pin) {
  const state = await readState();
  const user = state.users.find((item) => item.username.toLowerCase() === username.trim().toLowerCase());
  const now = Date.now();
  if (!user || !user.active) throw new Error("بيانات الدخول غير صحيحة.");
  if (user.lockedUntil && user.lockedUntil > now) throw new Error("تم إيقاف المحاولات مؤقتًا. جرّب بعد 15 دقيقة.");
  if ((await hashPin(pin, user.salt)) !== user.pinHash) {
    user.failedAttempts = (user.failedAttempts || 0) + 1;
    if (user.failedAttempts >= 5) {
      user.failedAttempts = 0;
      user.lockedUntil = now + 15 * 60 * 1000;
    }
    await writeState(state);
    throw new Error(user.lockedUntil ? "تم إيقاف المحاولات مؤقتًا. جرّب بعد 15 دقيقة." : "بيانات الدخول غير صحيحة.");
  }
  user.failedAttempts = 0;
  user.lockedUntil = null;
  state.sessionUserId = user.id;
  await writeState(state);
  return { user: safeUser(user), workspaces: visibleWorkspaces(state, user) };
}

export async function localLogout() {
  const state = await readState();
  state.sessionUserId = null;
  await writeState(state);
}

export async function localListWorkspaces() {
  const state = await readState();
  const user = state.users.find((item) => item.id === state.sessionUserId && item.active);
  if (!user) throw new Error("يجب تسجيل الدخول أولًا.");
  return visibleWorkspaces(state, user);
}

export async function localCreateWorkspace(name) {
  const state = await readState();
  const user = state.users.find((item) => item.id === state.sessionUserId && item.active);
  if (!user || user.role !== "admin") throw new Error("إنشاء الشركات متاح للمدير فقط.");
  if (state.workspaces.some((workspace) => workspace.name.toLowerCase() === name.toLowerCase())) throw new Error("توجد شركة بهذا الاسم بالفعل.");
  const now = Date.now();
  const workspace = {
    id: crypto.randomUUID(),
    name,
    sourceName: "لا يوجد ملف بعد",
    messageCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  state.workspaces.push(workspace);
  user.workspaceIds = [...new Set([...(user.workspaceIds || []), workspace.id])];
  await writeState(state);
  return workspace;
}

export async function localGetArchive(workspaceId) {
  const workspaces = await localListWorkspaces();
  if (!workspaces.some((workspace) => workspace.id === workspaceId)) throw new Error("لا تملك صلاحية هذه الشركة.");
  return (await loadWorkspaceArchive(workspaceId)) || { sourceName: "لا يوجد ملف بعد", messages: [] };
}

export async function localSaveArchive(workspaceId, messages, sourceName) {
  const state = await readState();
  const user = state.users.find((item) => item.id === state.sessionUserId && item.active);
  const workspace = state.workspaces.find((item) => item.id === workspaceId);
  if (!user || !workspace || (user.role !== "admin" && !(user.workspaceIds || []).includes(workspaceId))) throw new Error("لا تملك صلاحية هذه الشركة.");
  const previousArchive = await loadWorkspaceArchive(workspaceId);
  if (user.role !== "admin" && hasManualMessageChanges(previousArchive?.messages, messages)) {
    throw new Error("منشئ الرسالة متاح للمشرف فقط.");
  }
  await saveWorkspaceArchive(workspaceId, messages, sourceName);
  workspace.sourceName = sourceName;
  workspace.messageCount = messages.length;
  workspace.updatedAt = Date.now();
  await writeState(state);
  return workspace;
}

export async function localListUsers() {
  const state = await readState();
  const user = state.users.find((item) => item.id === state.sessionUserId && item.active);
  if (!user || user.role !== "admin") throw new Error("هذه الصلاحية متاحة للمدير فقط.");
  return state.users.map((item) => ({ ...safeUser(item), workspaceIds: item.workspaceIds || [] }));
}

export async function localCreateUser(input) {
  const state = await readState();
  const admin = state.users.find((item) => item.id === state.sessionUserId && item.active);
  if (!admin || admin.role !== "admin") throw new Error("هذه الصلاحية متاحة للمدير فقط.");
  const username = input.username.trim();
  if (state.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) throw new Error("اسم المستخدم مستخدم بالفعل.");
  const salt = crypto.randomUUID();
  const user = {
    id: crypto.randomUUID(),
    username,
    displayName: input.displayName.trim() || username,
    role: input.role === "admin" ? "admin" : "user",
    active: true,
    workspaceIds: [...new Set(input.workspaceIds || [])],
    salt,
    pinHash: await hashPin(input.password, salt),
    failedAttempts: 0,
    lockedUntil: null,
    createdAt: Date.now(),
  };
  state.users.push(user);
  await writeState(state);
  return { ...safeUser(user), workspaceIds: user.workspaceIds };
}

export async function localUpdateUser(userId, input) {
  const state = await readState();
  const admin = state.users.find((item) => item.id === state.sessionUserId && item.active);
  const user = state.users.find((item) => item.id === userId);
  if (!admin || admin.role !== "admin" || !user) throw new Error("تعذر تحديث المستخدم.");
  if (userId === admin.id && input.active === false) throw new Error("لا يمكنك إيقاف حسابك الحالي.");
  if (input.displayName !== undefined) user.displayName = input.displayName;
  if (input.role !== undefined) user.role = input.role === "admin" ? "admin" : "user";
  if (input.active !== undefined) user.active = Boolean(input.active);
  if (input.workspaceIds !== undefined) user.workspaceIds = [...new Set(input.workspaceIds)];
  if (input.password) {
    user.salt = crypto.randomUUID();
    user.pinHash = await hashPin(input.password, user.salt);
  }
  await writeState(state);
  return { ...safeUser(user), workspaceIds: user.workspaceIds || [] };
}
