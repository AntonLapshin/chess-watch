// Role + settings persistence via @zos/storage localStorage.
// Web harness: the vite alias maps @zos/storage to a localStorage shim.
import { localStorage } from "@zos/storage";

const ROLE_KEY = "chess-watch:role";
const HAPTICS_KEY = "chess-watch:haptics";

export function loadRole() {
  try {
    const v = localStorage.getItem(ROLE_KEY);
    return v === "p1" || v === "p2" ? v : null;
  } catch (_) {
    return null;
  }
}

export function saveRole(role) {
  try {
    localStorage.setItem(ROLE_KEY, role);
  } catch (_) {}
}

export function clearRole() {
  try {
    localStorage.removeItem(ROLE_KEY);
  } catch (_) {}
}

export function loadHapticsEnabled() {
  try {
    return localStorage.getItem(HAPTICS_KEY) !== "off";
  } catch (_) {
    return true;
  }
}

export function saveHapticsEnabled(enabled) {
  try {
    localStorage.setItem(HAPTICS_KEY, enabled ? "on" : "off");
  } catch (_) {}
}
