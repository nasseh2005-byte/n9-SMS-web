import {
  initializeLocalWorkspaceStore,
  localCreateUser,
  localCreateWorkspace,
  localGetArchive,
  localListUsers,
  localListWorkspaces,
  localLogin,
  localLogout,
  localSaveArchive,
  localUpdateUser,
} from "./localWorkspaceStore.js";

const storageMode = import.meta.env.VITE_N9_STORAGE_MODE || "server";
const localMode = import.meta.env.DEV || storageMode === "local";
const vercelMode = !import.meta.env.DEV && storageMode === "vercel";
const MAX_ARCHIVE_BYTES = 75 * 1024 * 1024;

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: options.body ? { "content-type": "application/json", ...(options.headers || {}) } : options.headers,
  });
  let data = {};
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    const error = new Error(data.error || "تعذر إكمال الطلب.");
    error.status = response.status;
    throw error;
  }
  return data;
}

export const isLocalPreview = localMode;

export async function initializeWorkspaceSession(sampleMessages) {
  if (localMode) return initializeLocalWorkspaceStore(sampleMessages);
  try {
    return await request("/api/auth/me");
  } catch (error) {
    if (error.status === 401) return { user: null, workspaces: [] };
    throw error;
  }
}

export function login(username, password) {
  return localMode
    ? localLogin(username, password)
    : request("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
}

export async function logout() {
  if (localMode) return localLogout();
  return request("/api/auth/logout", { method: "POST", body: "{}" });
}

export async function listWorkspaces() {
  if (localMode) return localListWorkspaces();
  return (await request("/api/workspaces")).workspaces;
}

export async function createWorkspace(name) {
  if (localMode) return localCreateWorkspace(name);
  return (await request("/api/workspaces", { method: "POST", body: JSON.stringify({ name }) })).workspace;
}

export function getWorkspaceArchive(workspaceId) {
  if (localMode) return localGetArchive(workspaceId);
  if (!vercelMode) return request(`/api/workspaces/${encodeURIComponent(workspaceId)}/archive`);
  return request(`/api/workspaces/${encodeURIComponent(workspaceId)}/archive`).then(async (descriptor) => {
    if (!descriptor.archiveUrl) return descriptor;
    const response = await fetch(descriptor.archiveUrl, { cache: "no-store" });
    if (!response.ok) throw new Error("تعذر تنزيل أرشيف الشركة من التخزين السحابي.");
    const archive = await response.json();
    if (!Array.isArray(archive?.messages)) throw new Error("الأرشيف السحابي غير صالح.");
    return archive;
  });
}

export async function saveWorkspaceArchive(workspaceId, messages, sourceName) {
  if (localMode) return localSaveArchive(workspaceId, messages, sourceName);
  if (!vercelMode) {
    return request(`/api/workspaces/${encodeURIComponent(workspaceId)}/archive`, {
      method: "PUT",
      body: JSON.stringify({ messages, sourceName }),
    });
  }

  const archiveText = JSON.stringify({ sourceName, messages, savedAt: Date.now(), version: 2 });
  const size = new TextEncoder().encode(archiveText).byteLength;
  if (size > MAX_ARCHIVE_BYTES) throw new Error("حجم الأرشيف أكبر من الحد الآمن للحفظ السحابي.");
  const target = await request(`/api/workspaces/${encodeURIComponent(workspaceId)}/archive/upload-url`, {
    method: "POST",
    body: JSON.stringify({ size }),
  });
  const upload = await fetch(target.uploadUrl, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: archiveText,
  });
  if (!upload.ok) throw new Error("تعذر رفع أرشيف الرسائل إلى التخزين السحابي. لم تتغير النسخة المحفوظة.");
  return request(`/api/workspaces/${encodeURIComponent(workspaceId)}/archive/complete`, {
    method: "POST",
    body: JSON.stringify({ archiveKey: target.archiveKey, expectedVersion: target.expectedVersion }),
  });
}

export async function listUsers() {
  if (localMode) return localListUsers();
  return (await request("/api/users")).users;
}

export function createUser(input) {
  return localMode
    ? localCreateUser(input)
    : request("/api/users", { method: "POST", body: JSON.stringify(input) }).then((data) => data.user);
}

export function updateUser(userId, input) {
  return localMode
    ? localUpdateUser(userId, input)
    : request(`/api/users/${encodeURIComponent(userId)}`, { method: "PATCH", body: JSON.stringify(input) });
}
