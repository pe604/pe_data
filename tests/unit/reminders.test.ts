import { describe, expect, it } from "vitest";
import { assignmentText, fmtWhatsapp, headAlertText, newlyAdded, normaliseWhatsapp, reminderDue, reminderText } from "@/lib/domain/reminders";

describe("reminderDue (SPEC §15.7)", () => {
  it("waits 7 days from the last activity", () => {
    expect(reminderDue("2026-10-01", null, "2026-10-07")).toEqual({ due: false, idleDays: 6 });
    expect(reminderDue("2026-10-01", null, "2026-10-08")).toEqual({ due: true, idleDays: 7 });
  });

  it("then repeats every 3 days while nothing changes", () => {
    expect(reminderDue("2026-10-01", "2026-10-08", "2026-10-08").due).toBe(false); // already sent today
    expect(reminderDue("2026-10-01", "2026-10-08", "2026-10-10").due).toBe(false);
    expect(reminderDue("2026-10-01", "2026-10-08", "2026-10-11")).toEqual({ due: true, idleDays: 10 });
    expect(reminderDue("2026-10-01", "2026-10-11", "2026-10-14").due).toBe(true);
  });

  it("activity after a reminder resets to the 7-day rule", () => {
    expect(reminderDue("2026-10-09", "2026-10-08", "2026-10-12").due).toBe(false);
    expect(reminderDue("2026-10-09", "2026-10-08", "2026-10-16").due).toBe(true);
  });

  it("a send that went out on the activity day still counts as after it", () => {
    expect(reminderDue("2026-10-08", "2026-10-08", "2026-10-11").due).toBe(false); // only 3 idle days
    expect(reminderDue("2026-10-08", "2026-10-08", "2026-10-15").due).toBe(true);
  });
});

describe("WhatsApp numbers", () => {
  it("normalises to digits with country code", () => {
    expect(normaliseWhatsapp("98765 43210")).toBe("919876543210");
    expect(normaliseWhatsapp("+91 98765-43210")).toBe("919876543210");
    expect(normaliseWhatsapp("09876543210")).toBe("919876543210");
    expect(normaliseWhatsapp("+44 7700 900123")).toBe("447700900123");
    expect(normaliseWhatsapp("12345")).toBeNull();
    expect(normaliseWhatsapp("")).toBeNull();
  });

  it("formats for display", () => {
    expect(fmtWhatsapp("919876543210")).toBe("+91 98765 43210");
    expect(fmtWhatsapp("447700900123")).toBe("+447700900123");
    expect(fmtWhatsapp(null)).toBe("");
  });
});

describe("reminderText", () => {
  it("lists deals most idle first with stage", () => {
    const t = reminderText("Keyur Shah", [
      { company: "Zooto", stage: "CALL_PENDING", idleDays: 8 },
      { company: "ITUS", stage: "SCUTTLEBUTT", idleDays: 21 },
    ]);
    expect(t).toContain("Hi Keyur, 2 of your pipeline deals");
    expect(t.indexOf("ITUS")).toBeLessThan(t.indexOf("Zooto"));
    expect(t).toContain("• *ITUS*: 21 days (Scuttlebutt)");
  });

  it("uses the singular for one deal", () => {
    expect(reminderText("Riya", [{ company: "A", stage: "NOT_ASSIGNED", idleDays: 7 }])).toContain("one of your pipeline deals has");
  });
});

describe("Research assignment messages (SPEC §15.8)", () => {
  it("names the company, sector and PE team, and mentions the deck", () => {
    expect(assignmentText({ name: "Riya Shah", company: "Zooto", sector: "Consumer", pe: ["Keyur", "Arjun"], deck: true })).toBe(
      "Hi Riya, you've been assigned *Zooto* (Consumer) on the deal pipeline. Keyur and Arjun from the PE team are working on it with you. The deck is attached below.",
    );
  });

  it("handles one PE, no PE, three PEs and no deck", () => {
    expect(assignmentText({ name: "Riya", company: "A", sector: null, pe: ["Keyur"], deck: false })).toBe(
      "Hi Riya, you've been assigned *A* on the deal pipeline. Keyur from the PE team is working on it with you. There's no deck on the dashboard yet.",
    );
    expect(assignmentText({ name: "Riya", company: "A", sector: null, pe: [], deck: true })).toContain("No one from the PE team is assigned yet.");
    expect(assignmentText({ name: "Riya", company: "A", sector: null, pe: ["A", "B", "C"], deck: true })).toContain("A, B and C from the PE team are");
  });

  it("only newly added names get a message", () => {
    expect(newlyAdded(["Riya"], ["riya ", "Meet"])).toEqual(["Meet"]);
    expect(newlyAdded(["Riya", "Meet"], ["Meet"])).toEqual([]);
    expect(newlyAdded([], ["Riya"])).toEqual(["Riya"]);
  });
});
describe("team head alerts (SPEC §15.9)", () => {
  it("tells the head which member was assigned, with PE and deck", () => {
    expect(headAlertText({ head: "Rohit Shah", team: "SCUTTLEBUTT", members: ["Diya"], company: "Zooto", sector: "Consumer", pe: ["Keyur", "Arjun"], deck: true })).toBe(
      "Hi Rohit, Diya from the Scuttlebutt team has been assigned *Zooto* (Consumer) on the deal pipeline. PE: Keyur, Arjun. The deck is attached below.",
    );
  });

  it("handles several members, no PE and no deck", () => {
    expect(headAlertText({ head: "Rohit", team: "SCUTTLEBUTT", members: ["Diya", "Hardik"], company: "A", sector: null, pe: [], deck: false })).toBe(
      "Hi Rohit, Diya and Hardik from the Scuttlebutt team have been assigned *A* on the deal pipeline. No PE assigned yet.",
    );
  });
});