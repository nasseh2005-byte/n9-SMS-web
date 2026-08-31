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

const localMode = import.meta.env.DEV || import.meta.env.VITE_N9_STORAGE_MODE === "local";

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
  return localMode ? localGetArchive(workspaceId) : request(`/api/workspaces/${encodeURIComponent(workspaceId)}/archive`);
}

export function saveWorkspaceArchive(workspaceId, messages, sourceName) {
  return localMode
    ? localSaveArchive(workspaceId, messages, sourceName)
    : request(`/api/workspaces/${encodeURIComponent(workspaceId)}/archive`, {
      method: "PUT",
      body: JSON.stringify({ messages, sourceName }),
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
