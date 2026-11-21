// Minimal @zeppos/zml/base-page shim: returns the page config unchanged
// plus a request() that calls the HTTP adapter directly (no BLE).
import { handleRequest } from "../adapters/httpAdapter.js";

export function BasePage(config) {
  return {
    ...config,
    async request(req) {
      return handleRequest(req);
    },
  };
}
