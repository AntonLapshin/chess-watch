import { describe, it, expect } from "vitest";
import { fakeInitialState } from "./protocol.js";

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
