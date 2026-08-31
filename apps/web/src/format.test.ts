import { describe, expect, it } from "vitest";
import { formatPayload } from "./App";

describe("payload formatting", () => {
  it("pretty-prints objects and JSON-shaped strings", () => {
    expect(formatPayload({ lead: { email: "ana@example.test", score: 82 } })).toBe(`{
  "lead": {
    "email": "ana@example.test",
    "score": 82
  }
}`);
    expect(formatPayload('{"source":"website","tags":["demo","priority"]}')).toBe(`{
  "source": "website",
  "tags": [
    "demo",
    "priority"
  ]
}`);
  });

  it("leaves ordinary and malformed text unchanged", () => {
    expect(formatPayload("validated lead")).toBe("validated lead");
    expect(formatPayload('{"broken"')).toBe('{"broken"');
  });
});
