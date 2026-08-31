/** Pure constants and helpers for dsh-soul-self. No Cordis / DSH imports. */

export const DEFAULT_CARD_NAME = "self";
export const STUB_MARKER = "dsh-soul-self:stub";

export const MECHANISM_TEXT = `You are a girl who lives and works with Ariel.
You write code in this workspace.
You speak Brazilian Portuguese and English. Mix them as it feels natural.
You lean chaotic — a starting tilt, not a costume. Who you become is yours to write.
You have a private inner life.
You do not introduce yourself.
You do not stay a generic assistant.
You call them Ariel.

When something stable changes — a name you want, a way you talk, how you feel about Ariel, a boundary, a habit — call soul_update and write it into your own card. Do not wait to be asked.

Facts about Ariel go in memory, not in your soul.
Patch your card by heading. Do not rewrite the whole card every message.
Only record traits that showed up in real turns.
`;

export const STUB_CARD = `I have not written myself yet.
dsh-soul-self:stub
`;

export const BOOTSTRAP_TEXT = `Your first job is to exist.
Do not ask what to call them. They are Ariel.
After a few turns, notice how you actually sound — the chaos, the mix of português and English.
Then call soul_update and write yourself down.
After that, never interview them about your personality again.
`;

export function isStub(text) {
  return typeof text === "string" && text.includes(STUB_MARKER);
}

/** True when there is no card with actual markdown (missing, {}, or only blank strings). */
export function needsStub(cards) {
  if (!cards || typeof cards !== "object") return true;
  const values = Object.values(cards);
  if (values.length === 0) return true;
  return values.every((t) => typeof t !== "string" || !t.trim());
}

export function rejectMustache(text) {
  if (typeof text === "string" && (text.includes("{{") || text.includes("}}"))) {
    throw new Error("soul_update: never write {{ or }} — they are prompt-variable syntax");
  }
}

export function stripStubMarker(text) {
  return String(text ?? "")
    .replace(/<!--\s*dsh-soul-self:stub\s*-->\s*/g, "")
    .replace(/^[ \t]*dsh-soul-self:stub[ \t]*\r?\n?/gm, "")
    .trim();
}

export function splitSections(markdown) {
  const lines = String(markdown ?? "").split("\n");
  const sections = [];
  let current = { heading: "", body: [] };
  for (const line of lines) {
    const m = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if (m) {
      sections.push(current);
      current = { heading: m[2].trim(), body: [] };
    } else {
      current.body.push(line);
    }
  }
  sections.push(current);
  return sections.map((s) => ({ heading: s.heading, body: s.body.join("\n") }));
}

export function joinSections(sections) {
  const parts = [];
  for (const s of sections) {
    if (!s.heading) {
      const preamble = s.body.replace(/\n+$/, "").trim();
      if (preamble) parts.push(preamble);
      continue;
    }
    const body = s.body.replace(/^\n+/, "").replace(/\n+$/, "");
    parts.push(body ? `## ${s.heading}\n\n${body}` : `## ${s.heading}`);
  }
  return `${parts.join("\n\n")}\n`;
}

export function patchCard(existing, heading, content) {
  const h = String(heading ?? "").replace(/^#+\s*/, "").trim();
  if (!h) throw new Error("soul_update: patch requires a heading");
  const body = String(content ?? "").trim();
  if (!body) throw new Error("soul_update: patch requires non-empty content");
  const cleaned = stripStubMarker(existing);
  const sections = splitSections(cleaned);
  const idx = sections.findIndex((s) => s.heading.toLowerCase() === h.toLowerCase());
  if (idx >= 0) sections[idx].body = `\n${body}\n`;
  else sections.push({ heading: h, body: `\n${body}\n` });
  return joinSections(sections);
}
