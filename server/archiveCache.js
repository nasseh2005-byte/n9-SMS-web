// Cache only immutable archive objects, never memberships or user-filtered responses.
// One entry bounds retained memory; different companies/versions cannot share keys.
export function createArchiveReader(load, { ttlMs = 60000, now = Date.now } = {}) {
  let entry;
  return function read(key) {
    if (!key) return Promise.resolve({ messages: [] });
    if (entry?.key === key && now() < entry.expiresAt) return entry.promise;
    const next = { key, expiresAt: now() + ttlMs };
    next.promise = Promise.resolve().then(() => load(key)).catch((error) => {
      if (entry === next) entry = undefined;
      throw error;
    });
    entry = next;
    return next.promise;
  };
}
