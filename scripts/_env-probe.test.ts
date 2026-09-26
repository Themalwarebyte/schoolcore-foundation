import { describe, it, expect } from "bun:test";

describe("env probe", () => {
  it("reports env presence without values", () => {
    console.log("VITE_CONVEX_URL set:", Boolean(process.env.VITE_CONVEX_URL));
    console.log("SMOKE_CONVEX_URL set:", Boolean(process.env.SMOKE_CONVEX_URL));
    expect(true).toBe(true);
  });
});
