const BASE = "/note/api";

export async function api(path, options = {}) {
  const response = await fetch(BASE + path, { credentials: "same-origin", cache: "no-store", ...options });
  if (response.status === 401) window.top.location.assign("/it/");
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  const type = response.headers.get("content-type") || "";
  return type.includes("application/json") ? response.json() : response;
}

export async function loadItIdentity() {
  const response = await fetch("/it/api/auth/me", { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}
