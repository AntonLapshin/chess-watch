// @zos/storage shim: localStorage-backed. A ?player=p1|p2 URL param wins
// over stored state so each browser tab can play a different side.
function urlPlayer() {
  try {
    const m = /[?&]player=(p1|p2)/.exec(window.location.search);
    return m ? m[1] : null;
  } catch (_) {
    return null;
  }
}

export const localStorage = {
  getItem(key) {
    if (key === "chess-watch:role") {
      return urlPlayer() || window.localStorage.getItem(key);
    }
    return window.localStorage.getItem(key);
  },
  setItem(key, value) {
    window.localStorage.setItem(key, value);
  },
  removeItem(key) {
    window.localStorage.removeItem(key);
  },
};
