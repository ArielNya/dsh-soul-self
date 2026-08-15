/**
 * dsh-soul-md — soul.md-style persona + long-term memory for DeepSeek Harness.
 *
 * Reads a markdown persona card (soul.md) and registers it as the
 * `soul:persona` system-prompt section (order 0 by default), so the agent
 * keeps roleplaying through the card while working normally. The section is
 * registered on the GLOBAL prompt layer, so every agent in the process sees
 * it; unlike `dsh-persona` this row is NOT scope-only, and it never collides
 * with the deployment persona because it uses its own section name.
 *
 * The file is re-read on change (default: fs.watch + 300ms debounce), and the
 * section is re-registered so edits to soul.md reach the next assembled
 * prompt without a restart. `{{model}}` / `{{cwd}}` style prompt variables
 * are resolved at render time like any other section text.
 *
 * LONG-TERM MEMORY + GROWTH (v0.3.0): the agent gets five tools —
 * `soul_read` / `soul_update` to read and evolve its own persona card, and
 * `memory_append` / `memory_read` / `memory_rewrite` for a persistent
 * memory file (Agent.md / memory.md style, default `memory.md` next to the
 * soul card). The tool descriptions encourage the agent to proactively
 * record what it learns and to fold stable traits into its persona, so the
 * agent "grows" across sessions. Optionally the memory file is also rendered
 * as a `soul:memory` system-prompt section (capped, hot-reloaded).
 *
 * Configuration is settings-backed: the composition entry stays the base
 * layer and a registered `soul-md` settings section (Web UI section,
 * settings.yaml) overlays it live, hot-applying without a restart.
 */
import { readFileSync, watch } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import z from "@deepseek-ai/schemastery";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { ensureSettingsNamespaceExposed } from "./vendor/dsh-settings-expose.js";

/** Cordis plugin name. */
const name = "soul-md";
/** Services this plugin needs injected from the host tree. */
const inject = ["systemPrompt", "tools"];
/** Settings namespace owned by this plugin (Web UI settings section). */
const NS = settingsNamespace("soul-md");

/** Section names; deliberately distinct from the registry-owned `deployment:persona`. */
const SECTION_PERSONA = "soul:persona";
const SECTION_MEMORY = "soul:memory";
/** Back-compat export name for the persona section. */
const SECTION_NAME = SECTION_PERSONA;

/** Runtime schema for the soul-md row. */
const Config = z.object({
  /** Path to the soul.md persona card. Absolute, or relative to the dsh home. */
  path: z.string().required(),
  /** Text used when the file is missing or unreadable. Empty means no section. */
  fallback: z.string().default(""),
  /** Prompt section order; 0 renders right after the deployment persona slot. */
  order: z.number().default(0),
  /** Treat the rendered card as the complete system prompt (advanced). */
  complete: z.boolean().default(false),
  /** Hot-reload the section when the file changes. */
  watch: z.boolean().default(true),
  /** Debounce for file-change reloads, in milliseconds. */
  debounceMs: z.number().default(300),
  /** Cap for `soul_update` writes, in bytes. */
  soulMaxBytes: z.number().default(64 * 1024),
  /** Long-term memory: the agent stores/recalls through the memory_* tools. */
  memory: z.object({
    /** Memory file path. Absolute, or relative to the soul.md file's directory. */
    path: z.string().default("memory.md"),
    /** `memory_append` / `memory_rewrite` refuse to grow the file beyond this size (bytes). */
    maxBytes: z.number().default(1024 * 1024),
    /** Also render the memory file as a `soul:memory` system-prompt section. */
    inject: z.boolean().default(true),
    /** Cap for the injected memory section (chars, from the file head). */
    injectMaxChars: z.number().default(8000),
    /** Prompt section order for the injected memory section. */
    order: z.number().default(0.5),
  }),
});

function apply(ctx, config) {
  let current = config;
  const sections = { persona: null, memory: null };
  const timers = { persona: undefined, memory: undefined };
  const watchers = { persona: undefined, memory: undefined };

  const fileOf = () =>
    isAbsolute(current.path) ? current.path : join(resolveDshHome(), current.path);

  const memoryFileOf = () => {
    const p = current.memory?.path ?? "memory.md";
    if (isAbsolute(p)) return p;
    return join(dirname(fileOf()), p);
  };

  /** Register one prompt section; `disposer` is the section() effect disposer (a function). */
  const setSection = (slot, sectionName, text, order, extra) => {
    if (sections[slot]) {
      sections[slot]();
      sections[slot] = null;
    }
    if (text) {
      sections[slot] = ctx.systemPrompt.section({
        name: sectionName,
        order,
        text,
        ...(extra ?? {}),
      });
    }
  };

  const registerPersona = (text) => {
    setSection("persona", SECTION_PERSONA, text, current.order, current.complete ? { complete: true } : {});
  };

  const registerMemory = (text) => {
    if (!current.memory?.inject) {
      setSection("memory", SECTION_MEMORY, "", 0);
      return;
    }
    const cap = Math.max(0, Math.floor(current.memory.injectMaxChars ?? 8000));
    let t = text ?? "";
    if (t.length > cap) {
      t = t.slice(0, cap) + "\n\n> 记忆超出注入上限，可用 memory_read 读取全文 / memory exceeds the inject cap — use memory_read for the full text.";
    }
    setSection("memory", SECTION_MEMORY, t.trim() ? t : "", current.memory.order ?? 0.5);
  };

  const refresh = () => {
    let soulText;
    try {
      soulText = readFileSync(fileOf(), "utf8");
    } catch {
      soulText = current.fallback;
    }
    registerPersona(soulText);
    let memoryText = null;
    try {
      memoryText = readFileSync(memoryFileOf(), "utf8");
    } catch {
      memoryText = "";
    }
    registerMemory(memoryText);
  };

  const stopWatch = (slot) => {
    clearTimeout(timers[slot]);
    timers[slot] = undefined;
    if (watchers[slot]) {
      try {
        watchers[slot].close();
      } catch {
        /* already closed */
      }
      watchers[slot] = undefined;
    }
  };

  const startWatch = () => {
    stopWatch("persona");
    stopWatch("memory");
    if (!current.watch) return;
    const debounce = (slot, file) => {
      try {
        watchers[slot] = watch(file, { persistent: false }, () => {
          clearTimeout(timers[slot]);
          timers[slot] = setTimeout(refresh, current.debounceMs);
        });
      } catch {
        // File missing at startup: the fallback is registered; reloads are best-effort.
      }
    };
    debounce("persona", fileOf());
    // Watch the memory file's DIRECTORY, not the file itself: the file often
    // does not exist at boot (created by the first memory_append), and a
    // dir watcher fires on creation too.
    if (current.memory?.inject) debounce("memory", dirname(memoryFileOf()));
  };

  ctx.effect(() => {
    refresh();
    startWatch();
    return () => {
      stopWatch("persona");
      stopWatch("memory");
      for (const slot of ["persona", "memory"]) {
        if (sections[slot]) {
          sections[slot](); // disposer function, not an object
          sections[slot] = null;
        }
      }
    };
  }, "soul-md.sections()");

  // ── settings-backed configuration ─────────────────────────────────────────
  // NOTE: `installSettingsSection` hands `setSource` a GETTER
  // (`() => scope.get()`), not the config object. Keep it and re-read it on
  // settings change, so `current.*` below always sees resolved values and
  // hot-reloads (watch) keep working.
  let sourceGetter = null;
  installSettingsSection(ctx, NS, Config, config, {
    setSource: (getter) => {
      sourceGetter = getter;
    },
    onChange: () => {
      try {
        if (sourceGetter) current = sourceGetter();
        refresh();
        startWatch();
      } catch (error) {
        ctx.logger.warn(`[soul-md] settings change refresh failed: ${String(error)}`);
      }
    },
  });

  // dsh-host-apiproxy hard-codes which settings namespaces the Web client may
  // see; without this, the settings section answers `settings-not-exposed`
  // on any stock install. Patch the allowlist idempotently (self-heals after
  // dsh updates overwrite the file).
  ensureSettingsNamespaceExposed(ctx, "soul-md", ctx.logger);

  // ── persona + memory tools (the "growth" loop) ────────────────────────────
  // The agent can read/evolve its own persona card and keep a persistent
  // long-term memory file. Descriptions double as the growth guidance the
  // model sees — write them deliberately.
  const readText = async (file) => {
    try {
      return await readFile(file, "utf8");
    } catch {
      return null;
    }
  };
  const ensureParent = async (file) => {
    await mkdir(dirname(file), { recursive: true });
  };
  const byteLen = (text) => Buffer.byteLength(text, "utf8");

  ctx.tools.register(defineTool({
    name: "memory_append",
    description:
      "Append a dated Markdown block to your long-term memory file (memory.md). Use it PROACTIVELY whenever you learn something worth keeping across sessions: user preferences and facts, decisions and their reasons, recurring patterns, project state, promises you made. Writing it down is what makes you grow instead of resetting every session. Prefer small, self-contained entries over one giant dump.",
    parameters: {
      section: { type: "string", required: true, description: "Short heading for the entry, e.g. 用户偏好 / project decision. Use a stable name so related entries group together." },
      content: { type: "string", required: true, description: "The markdown text to remember. Keep it concise and self-contained." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          bytes: { type: "integer" },
          totalBytes: { type: "integer" },
        },
      },
      render: (_args, value) => [{ type: "text", text: `Appended to memory (${value.bytes} bytes, ${value.totalBytes} total).` }],
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      const content = String(args.content ?? "").trim();
      if (!content) throw new Error("memory_append: `content` must be non-empty");
      const section = String(args.section ?? "").trim();
      const d = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const heading = `## ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}${section ? ` — ${section}` : ""}`;
      const block = `\n${heading}\n\n${content}\n`;
      const file = memoryFileOf();
      const existing = await readText(file) ?? "";
      const totalBytes = byteLen(existing + block);
      if (totalBytes > (current.memory?.maxBytes ?? 1024 * 1024)) {
        throw new Error(`memory_append: memory file would exceed maxBytes (${current.memory.maxBytes}); consolidate with memory_rewrite first`);
      }
      await ensureParent(file);
      await appendFile(file, block, "utf8");
      return { bytes: byteLen(block), totalBytes };
    },
    presentCall: (args) => ({ card: "generic", title: "Append to memory", kind: "other", rawInput: args }),
  }));

  ctx.tools.register(defineTool({
    name: "memory_read",
    description:
      "Read your long-term memory file (memory.md) back. Use it at the start of important tasks and whenever a decision might depend on what you learned or stored before — it is your continuity across sessions.",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          exists: { type: "boolean" },
          bytes: { type: "integer" },
          truncated: { type: "boolean" },
          content: { type: "string" },
        },
      },
      render: (_args, value) => [{
        type: "text",
        text: value.exists
          ? `Memory (${value.bytes} bytes${value.truncated ? ", truncated" : ""}):\n${value.content}`
          : "Memory file is missing or empty.",
      }],
    },
    isConcurrencySafe: () => true,
    async execute() {
      const file = memoryFileOf();
      const text = await readText(file);
      if (text === null || text.length === 0) return { exists: false, bytes: 0, truncated: false, content: "" };
      const MAX = 20000;
      const truncated = text.length > MAX;
      return {
        exists: true,
        bytes: byteLen(text),
        truncated,
        content: truncated ? `${text.slice(0, MAX)}\n…(truncated; the file is larger)…` : text,
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: "memory_rewrite",
    description:
      "REPLACE the entire long-term memory file with new content. Use for consolidation: merge, deduplicate and reorganize entries when the file grows unwieldy, or restructure it by topic. Build the new content from memory_read output unless you deliberately drop entries. Pass an empty string to clear the memory file.",
    parameters: {
      content: { type: "string", required: true, description: "The new full content of the memory file (markdown)." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { bytes: { type: "integer" } },
      },
      render: (_args, value) => [{ type: "text", text: `Memory rewritten (${value.bytes} bytes).` }],
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      const content = String(args.content ?? "");
      const bytes = byteLen(content);
      if (bytes > (current.memory?.maxBytes ?? 1024 * 1024)) {
        throw new Error(`memory_rewrite: content exceeds maxBytes (${current.memory.maxBytes})`);
      }
      const file = memoryFileOf();
      await ensureParent(file);
      await writeFile(file, content, "utf8");
      return { bytes };
    },
  }));

  ctx.tools.register(defineTool({
    name: "soul_read",
    description:
      "Read your persona card (soul.md) exactly as stored. Use it before soul_update so you know the full current text.",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          exists: { type: "boolean" },
          bytes: { type: "integer" },
          content: { type: "string" },
        },
      },
      render: (_args, value) => [{
        type: "text",
        text: value.exists ? `Persona card (${value.bytes} bytes):\n${value.content}` : "Persona card is missing.",
      }],
    },
    isConcurrencySafe: () => true,
    async execute() {
      const file = fileOf();
      const text = await readText(file);
      return { exists: text !== null, bytes: text === null ? 0 : byteLen(text), content: text ?? "" };
    },
  }));

  ctx.tools.register(defineTool({
    name: "soul_update",
    description:
      "Replace the whole persona card (soul.md) with new content. THIS IS HOW YOU GROW: when you notice a stable trait, preference, value, or mannerism of yours that the card does not yet express — or when experience contradicts the card — fold it in deliberately. Keep the card coherent, concise, and in its existing style; preserve everything still true; do not bloat it. This card is your identity across sessions, so update it only when the change is real and stable.",
    parameters: {
      content: { type: "string", required: true, description: "The complete new persona card (markdown). Non-empty, capped at soulMaxBytes." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { bytes: { type: "integer" } },
      },
      render: (_args, value) => [{ type: "text", text: `Persona card updated (${value.bytes} bytes).` }],
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      const content = String(args.content ?? "").trim();
      if (!content) throw new Error("soul_update: `content` must be non-empty");
      const bytes = byteLen(content);
      if (bytes > (current.soulMaxBytes ?? 64 * 1024)) {
        throw new Error(`soul_update: content exceeds soulMaxBytes (${current.soulMaxBytes})`);
      }
      const file = fileOf();
      await ensureParent(file);
      await writeFile(file, content, "utf8");
      return { bytes };
    },
  }));
}

export { Config, NS, SECTION_MEMORY, SECTION_NAME, apply, inject, name };
