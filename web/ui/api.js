// Profile API client. The player's token lives in this browser only.
const TOKEN_KEY = "ssb64-web:token";

export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const setToken = (t) => { try { localStorage.setItem(TOKEN_KEY, t); } catch {} };

async function request(path, { method = "GET", body, type } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = type || "application/json";
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : type ? body : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export async function createProfile(gamertag, avatarPreset) {
  const { token, player } = await request("/api/players", { method: "POST", body: { gamertag, avatarPreset } });
  setToken(token);
  return player;
}

export async function loadMe() {
  if (!getToken()) return null;
  try {
    return await request("/api/me");
  } catch {
    return null;
  }
}

export const updateMe = (changes) => request("/api/me", { method: "PATCH", body: changes });
export const uploadAvatar = (blob) => request("/api/me/avatar", { method: "PUT", body: blob, type: blob.type });

// Center-crops an image file to a 256px square JPEG.
export async function squareAvatar(file) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = new OffscreenCanvas(256, 256);
  canvas.getContext("2d").drawImage(
    bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256
  );
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
}
