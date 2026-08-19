export async function revisionRequest(path, options = {}) {
  const response = await fetch(path, {
    cache: "no-store",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const error = new Error(payload?.error || `HTTP ${response.status}`);
    error.code = payload?.code || "HTTP_ERROR";
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function revisionPost(path, payload = {}) {
  return revisionRequest(path, { method: "POST", body: JSON.stringify(payload) });
}

export function revisionDelete(path) {
  return revisionRequest(path, { method: "DELETE" });
}
