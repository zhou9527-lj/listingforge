import { describe, expect, it } from "vitest";
import { parseJson, readChatContent } from "../lib/generationPipeline";

describe("generation pipeline response parsing", () => {
  it("extracts assistant content from an OpenAI-compatible response", () => {
    expect(readChatContent({ choices: [{ message: { content: "ready" } }] })).toBe("ready");
  });

  it("parses JSON returned inside a markdown fence", () => {
    expect(parseJson<{ prompts: unknown[] }>("```json\n{\"prompts\":[]}\n```")).toEqual({ prompts: [] });
  });

  it("rejects a response with no usable assistant content", () => {
    expect(() => readChatContent({ choices: [] })).toThrow();
  });
});
