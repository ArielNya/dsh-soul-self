/**
 * dsh-soul-md — soul.md-style persona + long-term memory for DeepSeek Harness.
 *
 * MULTI-PERSONA (v0.4.0): the persona is resolved per prompt assembly through
 * a three-level chain, so switching applies from the next turn without a
 * restart and different sessions can carry different personas in one process:
 *
 *   session choice (chat-box switcher / sessions map) >
 *   workspace card (<workspace>/.dsh-persona.md) >
 *   global default (the `path` card) > fallback text
 *
 * The `soul:persona` section uses FUNCTION text (`text: (assembly) => …`),
 * which dsh-system-prompt evaluates on every assembly with the agent context
 * (`assembly.agent.session.header.cwd` is the workspace). Card texts are
 * cached by mtime, so a steady card stays byte-identical (KV-cache friendly)
 * and edits hot-apply without any watcher.
 *
 * MEMORY SCOPING (v0.4.0): the memory file mirrors the persona scope —
 *
 *   persona card memory (<card dir>/<stem>.memory.md) >
 *   workspace memory (<workspace>/.dsh-memory.md) >
 *   global memory (`memory.path`, default memory.md next to the global card)
 *
 * Reads and the injected `soul:memory` section walk the chain and use the
 * first existing file; writes (memory_append / memory_rewrite) target the
 * most specific scope of the current agent and create it on demand.
 *
 * GROWTH TOOLS: `soul_read` / `soul_update` read/rewrite the card that is
 * ACTIVE for the calling agent; `memory_append` / `memory_read` /
 * `memory_rewrite` operate on the agent's memory scope. The descriptions
 * encourage the agent to record what it learns and to fold stable traits
 * into its persona, so it "grows" across sessions.
 *
 * Configuration is settings-backed: the composition entry stays the base
 * layer and the registered `soul-md` settings section (Web UI, settings.yaml)
 * overlays it live. The host maintains a read-only `roster` (available
 * persona keys) in the same namespace for the chat-box switcher.
 */
import { readdirSync, readFileSync, statSync, watch } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
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

/** Persona key for the explicit global card. */
const KEY_GLOBAL = "global";
/** Persona key for the current workspace card. */
const KEY_WORKSPACE = "workspace";
/** Prefix for registry cards (`registry:<stem>`). */
const KEY_REGISTRY = "registry:";

/** Runtime schema for the soul-md row. */
const Config = z.object({
  /** Global-default persona card. Absolute, or relative to the dsh home. */
  path: z.string().required(),
  /** Text used when the resolved card is missing or unreadable. Empty means no section. */
  fallback: z.string().default(""),
  /** Prompt section order for the persona section (0 = right after the deployment persona slot). */
  order: z.number().default(0),
  /** Treat the rendered card as the complete system prompt (advanced). */
  complete: z.boolean().default(false),
  /** Legacy no-op (kept for settings compatibility): sections resolve per assembly now. */
  watch: z.boolean().default(true),
  /** Legacy no-op (kept for settings compatibility). */
  debounceMs: z.number().default(300),
  /** Cap for `soul_update` writes, in bytes. */
  soulMaxBytes: z.number().default(64 * 1024),
  /** Multi-persona registry. */
  personas: z.object({
    /** Directory of selectable persona cards (`*.md`); absolute, or relative to the dsh home. Empty disables the roster. */
    dir: z.string().default(""),
    /** Per-workspace persona card filename inside the session's workspace. */
    workspaceFile: z.string().default(".dsh-persona.md"),
  }),
  /** Per-session persona choice: sessionId -> persona key ("" or absent = follow the chain). */
  sessions: z.record(z.string(), z.string()).default({}),
  /** Read-only roster of selectable persona keys, maintained by the host for the UI. */
  roster: z.array(z.object({
    key: z.string(),
    label: z.string(),
    kind: z.string(),
  })).default([]),
  /** Long-term memory. */
  memory: z.object({
    /** Global memory file. Absolute, or relative to the global card's directory. */
    path: z.string().default("memory.md"),
    /** Per-workspace memory filename inside the session's workspace. */
    workspaceFile: z.string().default(".dsh-memory.md"),
    /** `memory_append` / `memory_rewrite` refuse to grow a file beyond this size (bytes). */
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
  let sourceGetter = null;
  /** mtime-keyed text cache; keeps steady sections byte-identical across assemblies. */
  const fileCache = new Map();
  /** Roster directory watch state (declared early: onChange below references it). */
  let rosterTimer = undefined;
  let rosterWatcher = undefined;

  const cfg = () => (sourceGetter ? sourceGetter() : current);

  const fileOf = () => {
    const c = cfg();
    return isAbsolute(c.path) ? c.path : join(resolveDshHome(), c.path);
  };

  const memoryFileOf = () => {
    const c = cfg();
    const p = c.memory?.path ?? "memory.md";
    if (isAbsolute(p)) return p;
    return join(dirname(fileOf()), p);
  };

  const registryDir = () => {
    const dir = cfg().personas?.dir ?? "";
    if (!dir) return "";
    return isAbsolute(dir) ? dir : join(resolveDshHome(), dir);
  };

  /** Synchronous mtime-cached read; null when missing/unreadable. */
  const readCached = (file) => {
    try {
      const st = statSync(file);
      const hit = fileCache.get(file);
      if (hit && hit.mtimeMs === st.mtimeMs) return hit.text;
      const text = readFileSync(file, "utf8");
      fileCache.set(file, { mtimeMs: st.mtimeMs, text });
      return text;
    } catch {
      return null;
    }
  };

  const sessionIdOf = (agent) => {
    try {
      const id = agent?.session?.id;
      return typeof id === "string" && id.length > 0 ? id : null;
    } catch {
      return null;
    }
  };

  const workspaceDirOf = (agent) => {
    try {
      const cwd = agent?.session?.header?.cwd;
      return typeof cwd === "string" && cwd.length > 0 ? cwd : null;
    } catch {
      return null;
    }
  };

  /** The session's explicit persona key ("" when unset). */
  const sessionKeyOf = (agent) => {
    const sid = sessionIdOf(agent);
    if (!sid) return "";
    const key = cfg().sessions?.[sid];
    return typeof key === "string" ? key : "";
  };

  /** Resolve one persona key to its card file, or null when the key is invalid. */
  const personaFileForKey = (key, agent) => {
    if (key === KEY_GLOBAL) return { key, file: fileOf(), label: "全局默认" };
    if (key === KEY_WORKSPACE) {
      const wd = workspaceDirOf(agent);
      if (!wd) return null;
      return {
        key,
        file: join(wd, cfg().personas?.workspaceFile ?? ".dsh-persona.md"),
        label: `工作区:${basename(wd)}`,
      };
    }
    if (key.startsWith(KEY_REGISTRY)) {
      const stem = key.slice(KEY_REGISTRY.length);
      const dir = registryDir();
      if (!dir || !stem || /[/\\]/.test(stem)) return null;
      return { key, file: join(dir, `${stem}.md`), label: stem };
    }
    if (isAbsolute(key)) return { key, file: key, label: basename(key) };
    return null;
  };

  /** The persona card ACTIVE for one agent: session choice > workspace card > global card. */
  const resolvePersona = (agent) => {
    const key = sessionKeyOf(agent);
    if (key) {
      const hit = personaFileForKey(key, agent);
      if (hit) return hit;
    }
    const wd = workspaceDirOf(agent);
    if (wd) {
      const wf = join(wd, cfg().personas?.workspaceFile ?? ".dsh-persona.md");
      if (readCached(wf) !== null) {
        return { key: KEY_WORKSPACE, file: wf, label: `工作区:${basename(wd)}` };
      }
    }
    return { key: KEY_GLOBAL, file: fileOf(), label: "全局默认" };
  };

  /** Memory file for a persona card: `<dir>/<stem>.memory.md`. */
  const memoryFileForCard = (cardFile) => {
    const ext = extname(cardFile);
    return `${cardFile.slice(0, cardFile.length - ext.length)}.memory.md`;
  };

  /** The memory scope ACTIVE for one agent (write target): persona > workspace > global. */
  const memoryTarget = (agent) => {
    const persona = resolvePersona(agent);
    if (persona.key === KEY_GLOBAL) {
      return { file: memoryFileOf(), scope: "global" };
    }
    if (persona.key === KEY_WORKSPACE) {
      return {
        file: join(dirname(persona.file), cfg().memory?.workspaceFile ?? ".dsh-memory.md"),
        scope: "workspace",
      };
    }
    return { file: memoryFileForCard(persona.file), scope: "persona" };
  };

  /** First EXISTING memory along the chain (read/inject path). */
  const memoryReadChain = (agent) => {
    const target = memoryTarget(agent);
    const scopeText = readCached(target.file);
    if (scopeText !== null) return { text: scopeText, source: target.scope, file: target.file };
    if (target.scope !== "global") {
      const globalFile = memoryFileOf();
      const globalText = readCached(globalFile);
      if (globalText !== null) return { text: globalText, source: "global", file: globalFile };
    }
    return { text: "", source: target.scope, file: target.file };
  };

  /** Resolve and render the persona section text for one assembly. */
  const renderPersona = (assembly) => {
    const persona = resolvePersona(assembly?.agent);
    return readCached(persona.file) ?? cfg().fallback;
  };

  /** Resolve and render the memory section text for one assembly. */
  const renderMemory = (assembly) => {
    const c = cfg();
    if (!c.memory?.inject) return "";
    const { text } = memoryReadChain(assembly?.agent);
    if (!text) return "";
    const cap = Math.max(0, Math.floor(c.memory.injectMaxChars ?? 8000));
    let out = text;
    if (out.length > cap) {
      out = out.slice(0, cap) + "\n\n> 记忆超出注入上限，可用 memory_read 读取全文 / memory exceeds the inject cap — use memory_read for the full text.";
    }
    return out;
  };

  // ── prompt sections (function text: resolved per assembly, hot by nature) ──
  // Registered once; order/complete changes re-register on settings change.
  const sectionDisposers = { persona: null, memory: null };
  function registerSections() {
    if (sectionDisposers.persona) {
      sectionDisposers.persona();
      sectionDisposers.persona = null;
    }
    if (sectionDisposers.memory) {
      sectionDisposers.memory();
      sectionDisposers.memory = null;
    }
    sectionDisposers.persona = ctx.systemPrompt.section({
      name: SECTION_PERSONA,
      order: cfg().order,
      text: renderPersona,
      ...(cfg().complete ? { complete: true } : {}),
    });
    sectionDisposers.memory = ctx.systemPrompt.section({
      name: SECTION_MEMORY,
      order: cfg().memory?.order ?? 0.5,
      text: renderMemory,
    });
  }

  ctx.effect(() => {
    registerSections();
    return () => {
      if (sectionDisposers.persona) {
        sectionDisposers.persona();
        sectionDisposers.persona = null;
      }
      if (sectionDisposers.memory) {
        sectionDisposers.memory();
        sectionDisposers.memory = null;
      }
    };
  }, "soul-md.sections()");

  // ── settings-backed configuration ─────────────────────────────────────────
  installSettingsSection(ctx, NS, Config, config, {
    setSource: (getter) => {
      sourceGetter = getter;
    },
    onChange: () => {
      // Section TEXTS resolve live per assembly; re-register only for
      // order/complete changes, and refresh the roster (personas.dir).
      registerSections();
      void publishRoster();
      startRosterWatch();
    },
  });

  // dsh-host-apiproxy hard-codes which settings namespaces the Web client may
  // see; without this, the settings section answers `settings-not-exposed`
  // on any stock install. Patch the allowlist idempotently (self-heals after
  // dsh updates overwrite the file).
  ensureSettingsNamespaceExposed(ctx, "soul-md", ctx.logger);

  // ── roster (host-maintained list of selectable personas) ──────────────────
  const computeRoster = () => {
    const entries = [
      { key: "", label: "自动（工作区 → 全局）", kind: "auto" },
      { key: KEY_GLOBAL, label: "全局默认", kind: "global" },
      { key: KEY_WORKSPACE, label: "工作区卡片", kind: "workspace" },
    ];
    const dir = registryDir();
    if (dir) {
      try {
        for (const entry of readdirSync(dir)) {
          if (entry.endsWith(".md")) {
            const stem = entry.slice(0, -3);
            entries.push({ key: `${KEY_REGISTRY}${stem}`, label: stem, kind: "registry" });
          }
        }
      } catch {
        /* registry dir missing — roster stays at the built-ins */
      }
    }
    return entries;
  };

  let lastRosterJson = "";
  async function publishRoster() {
    try {
      const roster = computeRoster();
      const json = JSON.stringify(roster);
      if (json === lastRosterJson) return;
      lastRosterJson = json;
      const settings = ctx.get("settings");
      if (!settings) return;
      const base = cfg();
      await settings.update(NS, { ...base, roster }).catch((error) => {
        ctx.logger.warn(`[soul-md] roster write failed: ${String(error)}`);
      });
    } catch (error) {
      ctx.logger.warn(`[soul-md] roster refresh failed: ${String(error)}`);
    }
  }

  // Refresh the roster when the registry directory changes.
  function startRosterWatch() {
    if (rosterWatcher) {
      try {
        rosterWatcher.close();
      } catch {
        /* already closed */
      }
      rosterWatcher = undefined;
    }
    const dir = registryDir();
    if (!dir) return;
    try {
      rosterWatcher = watch(dir, { persistent: false }, () => {
        clearTimeout(rosterTimer);
        rosterTimer = setTimeout(() => void publishRoster(), 300);
      });
    } catch {
      /* dir missing — publishRoster at apply covers the initial state */
    }
  }

  ctx.effect(() => {
    void publishRoster();
    startRosterWatch();
    return () => {
      clearTimeout(rosterTimer);
      if (rosterWatcher) {
        try {
          rosterWatcher.close();
        } catch {
          /* already closed */
        }
        rosterWatcher = undefined;
      }
    };
  }, "soul-md.roster()");

  // ── persona + memory tools (the "growth" loop) ────────────────────────────
  const ensureParent = async (file) => {
    await mkdir(dirname(file), { recursive: true });
  };
  const byteLen = (text) => Buffer.byteLength(text, "utf8");
  const agentOf = (exec) => exec?.agent ?? null;

  ctx.tools.register(defineTool({
    name: "memory_append",
    description:
      "Append a dated Markdown block to your long-term memory. The target file follows your CURRENT scope: the active persona card's memory (when one is chosen), else the workspace memory (.dsh-memory.md), else the global memory (memory.md). Use it PROACTIVELY whenever you learn something worth keeping across sessions: user preferences and facts, decisions and their reasons, recurring patterns, project state, promises you made. Writing it down is what makes you grow instead of resetting every session. Prefer small, self-contained entries over one giant dump.",
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
          file: { type: "string" },
        },
      },
      render: (_args, value) => [{ type: "text", text: `Appended to memory (${value.bytes} bytes, ${value.totalBytes} total) in ${value.file}.` }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const content = String(args.content ?? "").trim();
      if (!content) throw new Error("memory_append: `content` must be non-empty");
      const section = String(args.section ?? "").trim();
      const d = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const heading = `## ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}${section ? ` — ${section}` : ""}`;
      const block = `\n${heading}\n\n${content}\n`;
      const target = memoryTarget(agentOf(exec));
      const existing = readCached(target.file) ?? "";
      const totalBytes = byteLen(existing + block);
      if (totalBytes > (cfg().memory?.maxBytes ?? 1024 * 1024)) {
        throw new Error(`memory_append: memory file would exceed maxBytes (${cfg().memory.maxBytes}); consolidate with memory_rewrite first`);
      }
      await ensureParent(target.file);
      await appendFile(target.file, block, "utf8");
      fileCache.delete(target.file);
      return { bytes: byteLen(block), totalBytes, file: basename(target.file) };
    },
    presentCall: (args) => ({ card: "generic", title: "Append to memory", kind: "other", rawInput: args }),
  }));

  ctx.tools.register(defineTool({
    name: "memory_read",
    description:
      "Read your long-term memory back. The reader walks your CURRENT scope chain and returns the first existing file: the active persona card's memory, else the workspace memory (.dsh-memory.md), else the global memory (memory.md). Use it at the start of important tasks and whenever a decision might depend on what you learned or stored before — it is your continuity across sessions.",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          exists: { type: "boolean" },
          bytes: { type: "integer" },
          truncated: { type: "boolean" },
          source: { type: "string" },
          content: { type: "string" },
        },
      },
      render: (_args, value) => [{
        type: "text",
        text: value.exists
          ? `Memory from ${value.source} (${value.bytes} bytes${value.truncated ? ", truncated" : ""}):\n${value.content}`
          : `Memory is empty or missing (source: ${value.source}).`,
      }],
    },
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const { text, source } = memoryReadChain(agentOf(exec));
      if (!text) return { exists: false, bytes: 0, truncated: false, source, content: "" };
      const MAX = 20000;
      const truncated = text.length > MAX;
      return {
        exists: true,
        bytes: byteLen(text),
        truncated,
        source,
        content: truncated ? `${text.slice(0, MAX)}\n…(truncated; the file is larger)…` : text,
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: "memory_rewrite",
    description:
      "REPLACE the entire memory file of your CURRENT scope (persona card memory / workspace memory / global memory — same rule as memory_append) with new content. Use for consolidation: merge, deduplicate and reorganize entries when the file grows unwieldy, or restructure it by topic. Build the new content from memory_read output unless you deliberately drop entries. Pass an empty string to clear the memory file.",
    parameters: {
      content: { type: "string", required: true, description: "The new full content of the memory file (markdown)." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          bytes: { type: "integer" },
          file: { type: "string" },
        },
      },
      render: (_args, value) => [{ type: "text", text: `Memory rewritten (${value.bytes} bytes) in ${value.file}.` }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const content = String(args.content ?? "");
      const bytes = byteLen(content);
      if (bytes > (cfg().memory?.maxBytes ?? 1024 * 1024)) {
        throw new Error(`memory_rewrite: content exceeds maxBytes (${cfg().memory.maxBytes})`);
      }
      const target = memoryTarget(agentOf(exec));
      await ensureParent(target.file);
      await writeFile(target.file, content, "utf8");
      fileCache.delete(target.file);
      return { bytes, file: basename(target.file) };
    },
  }));

  ctx.tools.register(defineTool({
    name: "soul_read",
    description:
      "Read the persona card that is ACTIVE for your current session (session choice > workspace card .dsh-persona.md > global card), exactly as stored. Use it before soul_update so you know the full current text.",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          exists: { type: "boolean" },
          bytes: { type: "integer" },
          persona: { type: "string" },
          content: { type: "string" },
        },
      },
      render: (_args, value) => [{
        type: "text",
        text: value.exists ? `Persona card [${value.persona}] (${value.bytes} bytes):\n${value.content}` : `Persona card [${value.persona}] is missing.`,
      }],
    },
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const persona = resolvePersona(agentOf(exec));
      const text = readCached(persona.file);
      return {
        exists: text !== null,
        bytes: text === null ? 0 : byteLen(text),
        persona: persona.label,
        content: text ?? "",
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: "soul_update",
    description:
      "Replace the persona card that is ACTIVE for your current session (session choice > workspace card .dsh-persona.md > global card) with new content. THIS IS HOW YOU GROW: when you notice a stable trait, preference, value, or mannerism of yours that the card does not yet express — or when experience contradicts the card — fold it in deliberately. Keep the card coherent, concise, and in its existing style; preserve everything still true; do not bloat it. This card is your identity across sessions, so update it only when the change is real and stable.",
    parameters: {
      content: { type: "string", required: true, description: "The complete new persona card (markdown). Non-empty, capped at soulMaxBytes." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          bytes: { type: "integer" },
          persona: { type: "string" },
        },
      },
      render: (_args, value) => [{ type: "text", text: `Persona card [${value.persona}] updated (${value.bytes} bytes).` }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const content = String(args.content ?? "").trim();
      if (!content) throw new Error("soul_update: `content` must be non-empty");
      const bytes = byteLen(content);
      if (bytes > (cfg().soulMaxBytes ?? 64 * 1024)) {
        throw new Error(`soul_update: content exceeds soulMaxBytes (${cfg().soulMaxBytes})`);
      }
      const persona = resolvePersona(agentOf(exec));
      await ensureParent(persona.file);
      await writeFile(persona.file, content, "utf8");
      fileCache.delete(persona.file);
      return { bytes, persona: persona.label };
    },
  }));
}

export { Config, NS, SECTION_MEMORY, SECTION_NAME, apply, inject, name };
