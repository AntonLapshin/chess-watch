import { describe, it, expect } from "vitest";
import { fakeInitialState, errorMessage } from "./protocol.js";

describe("fakeInitialState", () => {
  it("uses built-in defaults without names", () => {
    const s = fakeInitialState("p1");
    expect(s.you.name).toBe("Aurora");
    expect(s.opponent.name).toBe("Sam");
  });

  it("uses supplied .env names when given", () => {
    const names = { p1: "Dad", p2: "Emma" };
    const s1 = fakeInitialState("p1", names);
    expect(s1.you.name).toBe("Dad");
    expect(s1.opponent.name).toBe("Emma");
    const s2 = fakeInitialState("p2", names);
    expect(s2.you.name).toBe("Emma");
    expect(s2.opponent.name).toBe("Dad");
  });
});

describe("errorMessage", () => {
  it("maps server error codes", () => {
    expect(errorMessage("unauthorized")).toBe("Not authorized");
    expect(errorMessage("network")).toBe("No connection to server");
  });

  it("maps ZML BLE-transport codes (page never reached the side service)", () => {
    // Numeric codes straight from zml-side.js MessageBuilder.
    expect(errorMessage(1)).toBe("No link to phone — side service did not answer");
    expect(errorMessage(2)).toBe("Bluetooth disconnected");
    expect(errorMessage(4)).toBe("Request timed out");
    // ... and the same failures surfaced only as a message string.
    expect(errorMessage("unknown", "shake timeout")).toBe("No link to phone — side service did not answer");
    expect(errorMessage("unknown", "ble disconnect")).toBe("Bluetooth disconnected");
  });

  it("turns a bare HTTP status into a readable line", () => {
    expect(errorMessage("http_403")).toBe("Server answered 403");
    expect(errorMessage("http_401")).toBe("Server answered 401");
  });
});
