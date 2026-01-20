import { describe, expect, it } from "vitest";
import { mapApertisFinishReason } from "./map-finish-reason";

describe("mapApertisFinishReason", () => {
  it('maps "stop" to "stop"', () => {
    expect(mapApertisFinishReason("stop")).toBe("stop");
  });

  it('maps "length" to "length"', () => {
    expect(mapApertisFinishReason("length")).toBe("length");
  });

  it('maps "tool_calls" to "tool-calls"', () => {
    expect(mapApertisFinishReason("tool_calls")).toBe("tool-calls");
  });

  it('maps "content_filter" to "content-filter"', () => {
    expect(mapApertisFinishReason("content_filter")).toBe("content-filter");
  });

  it('maps null to "unknown"', () => {
    expect(mapApertisFinishReason(null)).toBe("unknown");
  });

  it('maps undefined to "unknown"', () => {
    expect(mapApertisFinishReason(undefined)).toBe("unknown");
  });

  it('maps unknown string to "unknown"', () => {
    expect(mapApertisFinishReason("something_else")).toBe("unknown");
  });
});
