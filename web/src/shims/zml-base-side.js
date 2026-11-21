// Minimal @zeppos/zml/base-side shim for the web harness.
// The browser never loads app-side/index.js; this only keeps the side-service
// import path resolvable so the shared modules graph stays consistent.
export function BaseSideService(config) {
  return config;
}
