import { describe, expect, it } from "vitest";
import {
  cleanDisplayName,
  deckExtension,
  deckFileName,
  matchTeamName,
  messageText,
  parseVia,
  phoneFromJid,
} from "@/lib/domain/whatsapp";

const TEAM = ["Keyur", "Arjun", "Arvind Sir", "Priya", "Raghav"];

describe("parseVia (SPEC §14)", () => {
  it("handles the user's example: from/Via arvind sir", () => {
    expect(parseVia("from/Via arvind sir", TEAM)).toBe("Arvind Sir");
  });
  it("matches team members by first name and fixes case", () => {
    expect(parseVia("Deck via arvind", TEAM)).toBe("Arvind Sir");
    expect(parseVia("FreshBus IM, from KEYUR", TEAM)).toBe("Keyur");
    expect(parseVia("via: Priya", TEAM)).toBe("Priya");
    expect(parseVia("referred by arjun", TEAM)).toBe("Arjun");
    expect(parseVia("thru keyurr", TEAM)).toBe("Keyur");
  });
  it("keeps outside names in Title Case", () => {
    expect(parseVia("from rahul mehta at avendus", TEAM)).toBe("Rahul Mehta");
    expect(parseVia("via Sanjay Gupta, banker", TEAM)).toBe("Sanjay Gupta");
  });
  it("ignores non-person phrases", () => {
    expect(parseVia("via email", TEAM)).toBeNull();
    expect(parseVia("from the founder", TEAM)).toBeNull();
    expect(parseVia("FreshBus deck", TEAM)).toBeNull();
    expect(parseVia("", TEAM)).toBeNull();
  });
});

describe("matchTeamName", () => {
  it("exact, first name, and near misses", () => {
    expect(matchTeamName("raghav", TEAM)).toBe("Raghav");
    expect(matchTeamName("Arvind", TEAM)).toBe("Arvind Sir");
    expect(matchTeamName("Raghav K", TEAM)).toBe("Raghav");
    expect(matchTeamName("Raghv", TEAM)).toBe("Raghav");
    expect(matchTeamName("Zed", TEAM)).toBeNull();
  });
});

describe("helpers", () => {
  it("cleanDisplayName strips emojis", () => {
    expect(cleanDisplayName("raghav k 🙂🔥")).toBe("Raghav K");
    expect(cleanDisplayName("🙂")).toBe("Unknown sender");
    expect(cleanDisplayName(null)).toBe("Unknown sender");
  });
  it("phoneFromJid", () => {
    expect(phoneFromJid("919812345678@s.whatsapp.net")).toBe("919812345678");
    expect(phoneFromJid("919812345678:12@s.whatsapp.net")).toBe("919812345678");
    expect(phoneFromJid("123456789@lid")).toBeNull();
  });
  it("deckExtension and deckFileName", () => {
    expect(deckExtension("IM.PDF", null)).toBe("pdf");
    expect(deckExtension("x", "application/vnd.openxmlformats-officedocument.presentationml.presentation")).toBe("pptx");
    expect(deckExtension("model.xlsx", "application/vnd.ms-excel")).toBeNull();
    expect(deckFileName("FreshBus IM", "pdf")).toBe("FreshBus IM.pdf");
    expect(deckFileName("a/b.pdf", "pdf")).toBe("a_b.pdf");
  });
  it("messageText reads text and captions", () => {
    expect(messageText({ conversation: "hi" })).toBe("hi");
    expect(messageText({ extendedTextMessage: { text: "via keyur" } })).toBe("via keyur");
    expect(messageText({ documentMessage: { caption: "from arjun" } })).toBe("from arjun");
    expect(messageText({ documentWithCaptionMessage: { message: { documentMessage: { caption: "c" } } } })).toBe("c");
  });
});
