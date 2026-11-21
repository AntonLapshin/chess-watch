// Minimal @zeppos/zml/base-app shim for the web harness.
// The browser never loads app.js; BaseApp is only needed so app.js-style
// imports resolve if pulled in.
export function BaseApp(config) {
  return config;
}
