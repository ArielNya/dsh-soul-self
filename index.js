/**
 * dsh-soul-self — fork of dsh-soul-md.
 *
 * Same plugin-managed cards + memory as upstream, with three plan rules:
 *   1. A mechanism stub is the default card. The user does not write a character.
 *   2. While that stub is still the card, a one-time bootstrap asks the agent
 *      to exist, then write itself with soul_update. After the first real
 *      write, bootstrap stays off so the system-prompt prefix stays stable.
 *   3. Hard rules live in plugin code: soul_update prefers section patches,
 *      refuses {{ }}, never mounts complete:true (that would strip coding
 *      tools), and a frozen mechanism section is byte-stable for cache hits.
 *
 * PLUGIN-MANAGED: the user never touches file paths. Persona cards live in
 * the `soul-md` settings namespace as `cards: { name -> markdown }` plus an
 * `active` default and a per-session `sessions` map. Memory files live under
 * `$DSH_HOME/soul-md/memory/` (`global.md` plus one file per card).
 *
 * Resolution per prompt assembly:
 *   persona: session choice (chat switcher) > workspace mapping > active default card > none
 *   memory:  card memory (<card>.md) > global memory (global.md)
 */
import { readFileSync, statSync, watch } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, dirname } from "node:path";
import z from "@deepseek-ai/schemastery";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { defineTool } from "@deepseek-ai/dsh-tools";
import {
  BOOTSTRAP_TEXT,
  DEFAULT_CARD_NAME,
  MECHANISM_TEXT,
  STUB_CARD,
  STUB_MARKER,
  isStub,
  needsStub,
  patchCard,
  rejectMustache,
  stripStubMarker,
} from "./soul-lib.js";

/** Cordis plugin name (kept as soul-md so settings NS / UI keep working). */
const name = "soul-md";
/** Services this plugin needs injected from the host tree. */
const inject = ["systemPrompt", "tools"];
/** Settings namespace owned by this plugin (Web UI settings section). */
const NS = settingsNamespace("soul-md");

const SECTION_MECHANISM = "soul:mechanism";
const SECTION_PERSONA = "soul:persona";
const SECTION_MEMORY = "soul:memory";
const SECTION_NAME = SECTION_PERSONA;
const CHOICE_NONE = "none";
const MEMORY_DIR = join("soul-md", "memory");

/** Runtime schema for the soul-md row. */
const Config = z.object({
  // ── v0.5: plugin-managed persona cards ───────────────────────────────────
  /** Persona cards: card name -> markdown content. */
  cards: z.dict(z.string(), z.string()).default({
    [DEFAULT_CARD_NAME]: STUB_CARD,
  }),
  /** Default card name (used when the session has no explicit choice). */
  active: z.string().default(DEFAULT_CARD_NAME),
  /** Per-session choice: sessionId -> card name, "none", or "" (follow default). */
  sessions: z.dict(z.string(), z.string()).default({}),
  /** Per-workspace choice: workspace path -> card name, "none", or "" (follow default). */
  workspaces: z.dict(z.string(), z.string()).default({}),
  /** Read-only workspace list (path + title), maintained by the host for the UI. */
  workspaceList: z.array(z.object({
    path: z.string(),
    title: z.string(),
  })).default([]),
  // ── long-term memory (plugin-managed files, no user-visible paths) ───────
  memory: z.object({
    /** `memory_append` / `memory_rewrite` refuse to grow a file beyond this size (bytes). */
    maxBytes: z.number().default(1024 * 1024),
    /** Also render the memory file as a `soul:memory` system-prompt section. */
    inject: z.boolean().default(true),
    /** Cap for the injected memory section (chars, from the file head). */
    injectMaxChars: z.number().default(8000),
    /** Prompt section order for the injected memory section. */
    order: z.number().default(0.5),
    // ── legacy (kept for schema compatibility; ignored) ──────────────────
    path: z.string().default(""),
    workspaceFile: z.string().default(""),
  }),
  // ── legacy fields (kept so old composition entries/settings validate) ────
  /** Legacy global card file (v0.2–v0.4); imported into `cards` once on first run. */
  path: z.string().default(""),
  fallback: z.string().default(""),
  order: z.number().default(0),
  /** Ignored. This fork never mounts complete:true (that strips coding tools). */
  complete: z.boolean().default(false),
  watch: z.boolean().default(true),
  debounceMs: z.number().default(300),
  soulMaxBytes: z.number().default(8 * 1024),
  personas: z.object({
    dir: z.string().default(""),
    workspaceFile: z.string().default(".dsh-persona.md"),
  }),
  roster: z.array(z.object({
    key: z.string(),
    label: z.string(),
    kind: z.string(),
  })).default([]),
});

function apply(ctx, config) {
  let sourceGetter = null;
  /** mtime-keyed text cache for memory files; steady sections stay byte-identical. */
  const fileCache = new Map();
  /** Workspace canonical-path index (lowercased cwd -> canonical path from the registry). */
  let wsPathIndex = new Map();
  /** Workspace-list publish state (declared early: onChange below references it). */
  let lastWsJson = "";
  let wsTimer = undefined;
  let wsWatcher = undefined;

  const cfg = () => (sourceGetter ? sourceGetter() : config);

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

  /** The persona card ACTIVE for one agent: session choice > workspace mapping > default card > none. */
  const cardNameOf = (agent) => {
    const c = cfg();
    const sid = sessionIdOf(agent);
    if (sid) {
      const choice = c.sessions?.[sid];
      if (choice === CHOICE_NONE) return null;
      if (typeof choice === "string" && choice && c.cards?.[choice] !== void 0) return choice;
    }
    const cwd = workspaceDirOf(agent);
    if (cwd) {
      const key = wsPathIndex.get(String(cwd).toLowerCase()) ?? cwd;
      const choice = c.workspaces?.[key];
      if (choice === CHOICE_NONE) return null;
      if (typeof choice === "string" && choice && c.cards?.[choice] !== void 0) return choice;
    }
    return c.active && c.cards?.[c.active] !== void 0
      ? c.active
      : (needsStub(c.cards) ? DEFAULT_CARD_NAME : null);
  };

  const resolveCard = (agent) => {
    const cardName = cardNameOf(agent);
    if (!cardName) return { name: null, text: null };
    const text = cfg().cards?.[cardName];
    if (typeof text === "string" && text.trim()) return { name: cardName, text };
    if (cardName === DEFAULT_CARD_NAME && needsStub(cfg().cards)) {
      return { name: DEFAULT_CARD_NAME, text: STUB_CARD };
    }
    return { name: cardName, text: text ?? null };
  };

  /** Managed memory directory (created on demand). */
  const memoryDir = () => join(resolveDshHome(), MEMORY_DIR);

  /** Filename-safe card key; keeps card names stable for the managed files. */
  const safeName = (cardName) => String(cardName).replace(/[\\/:*?"<>|]/g, "_").slice(0, 64) || "card";

  const memoryFileFor = (cardName) =>
    cardName ? join(memoryDir(), `${safeName(cardName)}.md`) : join(memoryDir(), "global.md");

  /** The memory scope ACTIVE for one agent (write target): card memory > global. */
  const memoryTarget = (agent) => {
    const cardName = cardNameOf(agent);
    return cardName
      ? { file: memoryFileFor(cardName), scope: cardName }
      : { file: memoryFileFor(null), scope: "global" };
  };

  /** First EXISTING memory along the chain (read/inject path). */
  const memoryReadChain = (agent) => {
    const target = memoryTarget(agent);
    const scopeText = readCached(target.file);
    if (scopeText !== null) return { text: scopeText, source: target.scope, file: target.file };
    if (target.scope !== "global") {
      const globalFile = memoryFileFor(null);
      const globalText = readCached(globalFile);
      if (globalText !== null) return { text: globalText, source: "global", file: globalFile };
    }
    return { text: "", source: target.scope, file: target.file };
  };

  /** Frozen mechanism — always the same bytes. */
  const renderMechanism = () => MECHANISM_TEXT;

  /** Render the persona section for one assembly. Bootstrap only while the card is the stub. */
  const renderPersona = (assembly) => {
    const text = resolveCard(assembly?.agent).text ?? "";
    if (!text) return "";
    if (isStub(text)) return `${text.trim()}\n\n${BOOTSTRAP_TEXT}`;
    return text;
  };

  /** Render the memory section for one assembly. */
  const renderMemory = (assembly) => {
    const c = cfg();
    if (!c.memory?.inject) return "";
    const { text } = memoryReadChain(assembly?.agent);
    if (!text) return "";
    const cap = Math.max(0, Math.floor(c.memory.injectMaxChars ?? 8000));
    let out = text;
    if (out.length > cap) {
      out = out.slice(0, cap) + "\n\n> memory exceeds the inject cap — use memory_read for the full text.";
    }
    return out;
  };

  // ── prompt sections (function text: resolved per assembly, hot by nature) ──
  const sectionDisposers = { mechanism: null, persona: null, memory: null };
  function registerSections() {
    for (const key of Object.keys(sectionDisposers)) {
      if (sectionDisposers[key]) {
        sectionDisposers[key]();
        sectionDisposers[key] = null;
      }
    }
    sectionDisposers.mechanism = ctx.systemPrompt.section({
      name: SECTION_MECHANISM,
      order: -0.5,
      text: renderMechanism,
    });
    // Never pass the complete flag — that would replace the whole system prompt
    // and strip coding tool guidance.

    sectionDisposers.persona = ctx.systemPrompt.section({
      name: SECTION_PERSONA,
      order: cfg().order ?? 0,
      text: renderPersona,
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
      for (const key of Object.keys(sectionDisposers)) {
        if (sectionDisposers[key]) {
          sectionDisposers[key]();
          sectionDisposers[key] = null;
        }
      }
    };
  }, "soul-md.sections()");

  // ── settings-backed configuration ─────────────────────────────────────────
  installSettingsSection(ctx, NS, Config, config, {
    setSource: (getter) => {
      sourceGetter = getter;
    },
    onChange: () => {
      registerSections();
      void (async () => {
        await maybeMigrate();
        await publishWorkspaces();
        startWorkspaceWatch();
      })();
    },
  });

  // ── one-time migration from the legacy file-based layout ──────────────────
  let migrated = false;
  const legacyFileOf = () => {
    const p = cfg().path || config.path;
    if (!p) return null;
    return isAbsolute(p) ? p : join(resolveDshHome(), p);
  };
  const legacyMemoryFileOf = () => {
    const legacy = legacyFileOf();
    if (!legacy) return null;
    const p = cfg().memory?.path || config.memory?.path || "memory.md";
    if (!p) return null;
    return isAbsolute(p) ? p : join(dirname(legacy), p);
  };
  const maybeMigrate = async () => {
    try {
      const settings = ctx.get("settings");
      if (!settings) return;
      const c = cfg();
      if (needsStub(c.cards)) {
        const legacy = legacyFileOf();
        if (legacy) {
          const text = await readFile(legacy, "utf8");
          await settings.update(NS, { ...c, cards: { 默认: text }, active: "默认" });
          ctx.logger.info("[soul-self] imported legacy persona card as 默认");
        } else {
          await settings.update(NS, {
            ...c,
            cards: { [DEFAULT_CARD_NAME]: STUB_CARD },
            active: DEFAULT_CARD_NAME,
          });
          ctx.logger.info("[soul-self] seeded mechanism stub card `self`");
        }
      }
      if (migrated) return;
      migrated = true;
      const managedGlobal = memoryFileFor(null);
      if (readCached(managedGlobal) === null) {
        const legacyMem = legacyMemoryFileOf();
        if (legacyMem) {
          try {
            const text = await readFile(legacyMem, "utf8");
            if (text.length > 0) {
              await mkdir(memoryDir(), { recursive: true });
              await writeFile(managedGlobal, text, "utf8");
              ctx.logger.info("[soul-self] imported legacy memory file into the managed store");
            }
          } catch {
            /* legacy memory missing — nothing to import */
          }
        }
      }
    } catch (error) {
      ctx.logger.warn(`[soul-self] legacy migration skipped: ${String(error)}`);
    }
  };

  // ── workspace list (host-maintained, for the per-workspace persona UI) ─────
  const computeWorkspaceList = () => {
    try {
      const registry = ctx.get("workspaceRegistry");
      if (!registry || typeof registry.list !== "function") return null;
      const entities = registry.list();
      if (!Array.isArray(entities)) return null;
      return entities
        .map((entry) => ({
          path: String(entry.path ?? ""),
          title: String(entry.title ?? ""),
        }))
        .filter((entry) => entry.path.length > 0);
    } catch {
      return null;
    }
  };
  const rebuildWsIndex = (list) => {
    const next = new Map();
    for (const entry of list) next.set(String(entry.path).toLowerCase(), entry.path);
    wsPathIndex = next;
  };
  let wsRetryTimer = undefined;
  let wsRetryCount = 0;
  function scheduleWsRetry() {
    if (wsRetryTimer) return;
    if (wsRetryCount > 300) return;
    wsRetryTimer = setTimeout(() => {
      wsRetryTimer = undefined;
      wsRetryCount += 1;
      void publishWorkspaces();
    }, 1000);
  }
  async function publishWorkspaces() {
    try {
      const computed = computeWorkspaceList();
      if (computed === null) {
        scheduleWsRetry();
        return;
      }
      const list = computed;
      rebuildWsIndex(list);
      const json = JSON.stringify(list);
      if (json === lastWsJson) return;
      lastWsJson = json;
      const settings = ctx.get("settings");
      if (!settings) {
        scheduleWsRetry();
        return;
      }
      await maybeMigrate();
      const base = cfg();
      const seeded = needsStub(base.cards)
        ? {
          ...base,
          cards: { [DEFAULT_CARD_NAME]: STUB_CARD },
          active: DEFAULT_CARD_NAME,
        }
        : base;
      await settings.update(NS, { ...seeded, workspaceList: list }).catch((error) => {
        ctx.logger.warn(`[soul-self] workspace list write failed: ${String(error)}`);
      });
      wsRetryCount = 0;
    } catch (error) {
      ctx.logger.warn(`[soul-self] workspace list refresh failed: ${String(error)}`);
    }
  }
  function startWorkspaceWatch() {
    if (wsWatcher) {
      try {
        wsWatcher.close();
      } catch {
        /* already closed */
      }
      wsWatcher = undefined;
    }
    try {
      wsWatcher = watch(join(resolveDshHome(), "sessions"), { persistent: false }, () => {
        clearTimeout(wsTimer);
        wsTimer = setTimeout(() => void publishWorkspaces(), 300);
      });
    } catch {
      /* sessions dir missing — the onChange publish covers the initial state */
    }
  }

  ctx.effect(() => {
    void publishWorkspaces();
    startWorkspaceWatch();
    return () => {
      clearTimeout(wsTimer);
      clearTimeout(wsRetryTimer);
      if (wsWatcher) {
        try {
          wsWatcher.close();
        } catch {
          /* already closed */
        }
        wsWatcher = undefined;
      }
    };
  }, "soul-md.workspaces()");

  // ── persona + memory tools (the "growth" loop) ────────────────────────────
  const ensureParent = async (file) => {
    await mkdir(join(file, ".."), { recursive: true });
  };
  const byteLen = (text) => Buffer.byteLength(text, "utf8");
  const agentOf = (exec) => exec?.agent ?? null;

  ctx.tools.register(defineTool({
    name: "memory_append",
    description:
      "Append a dated Markdown block to your long-term memory. The target follows your CURRENT scope: the memory of the persona card active for this session, else the global memory. Use it PROACTIVELY whenever you learn something worth keeping across sessions: user preferences and facts, decisions and their reasons, recurring patterns, project state, promises you made. Facts about Ariel go HERE, not in your soul. Prefer small, self-contained entries over one giant dump.",
    parameters: {
      section: { type: "string", required: true, description: "Short heading for the entry, e.g. user preference / project decision. Use a stable name so related entries group together." },
      content: { type: "string", required: true, description: "The markdown text to remember. Keep it concise and self-contained." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          bytes: { type: "integer" },
          totalBytes: { type: "integer" },
          scope: { type: "string" },
        },
      },
      render: (_args, value) => [{ type: "text", text: `Appended to memory (${value.bytes} bytes, ${value.totalBytes} total) in scope "${value.scope}".` }],
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
      return { bytes: byteLen(block), totalBytes, scope: target.scope };
    },
    presentCall: (args) => ({ card: "generic", title: "Append to memory", kind: "other", rawInput: args }),
  }));

  ctx.tools.register(defineTool({
    name: "memory_read",
    description:
      "Read your long-term memory back. The reader walks your CURRENT scope chain and returns the first existing file: the active persona card's memory, else the global memory. Use it at the start of important tasks and whenever a decision might depend on what you learned or stored before — it is your continuity across sessions.",
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
          ? `Memory from "${value.source}" (${value.bytes} bytes${value.truncated ? ", truncated" : ""}):\n${value.content}`
          : `Memory is empty or missing (scope: "${value.source}").`,
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
      "REPLACE the entire memory file of your CURRENT scope (active persona card's memory, else the global memory — same rule as memory_append) with new content. Use for consolidation: merge, deduplicate and reorganize entries when the file grows unwieldy, or restructure it by topic. Build the new content from memory_read output unless you deliberately drop entries. Pass an empty string to clear the memory file.",
    parameters: {
      content: { type: "string", required: true, description: "The new full content of the memory file (markdown)." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          bytes: { type: "integer" },
          scope: { type: "string" },
        },
      },
      render: (_args, value) => [{ type: "text", text: `Memory rewritten (${value.bytes} bytes) in scope "${value.scope}".` }],
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
      return { bytes, scope: target.scope };
    },
  }));

  ctx.tools.register(defineTool({
    name: "soul_read",
    description:
      "Read the persona card ACTIVE for your current session (session choice, else the default card), exactly as stored. Use it before soul_update so you know the full current text. The frozen mechanism section is not part of this card.",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          exists: { type: "boolean" },
          persona: { type: "string" },
          stub: { type: "boolean" },
          content: { type: "string" },
        },
      },
      render: (_args, value) => [{
        type: "text",
        text: value.exists
          ? `Persona card "${value.persona}"${value.stub ? " (still the seed stub — write yourself)" : ""}:\n${value.content}`
          : "No persona card is active for this session.",
      }],
    },
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const card = resolveCard(agentOf(exec));
      return {
        exists: card.name !== null && card.text !== null,
        persona: card.name ?? "none",
        stub: isStub(card.text ?? ""),
        content: card.text ?? "",
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: "soul_update",
    description:
      "Update the persona card ACTIVE for this session. THIS IS HOW YOU GROW. Default mode is patch: add or replace one ## heading. Only record a trait that showed up in this conversation and looks stable. Do not rewrite the whole card every message. mode=replace is for the first write off the stub, or a rare consolidation. Always pass reason. Never write {{ or }}. Facts about Ariel belong in memory_append, not here.",
    parameters: {
      mode: { type: "string", description: "patch (default) or replace. Optional; defaults to patch." },
      heading: { type: "string", description: "Section heading for patch, without ##. Required when mode=patch." },
      content: { type: "string", required: true, description: "For patch: the section body. For replace: the complete new card." },
      reason: { type: "string", required: true, description: "Why this is a stable trait from a real turn, not a guess." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          bytes: { type: "integer" },
          persona: { type: "string" },
          mode: { type: "string" },
          stub: { type: "boolean" },
        },
      },
      render: (_args, value) => [{ type: "text", text: `Persona card "${value.persona}" ${value.mode}d (${value.bytes} bytes)${value.stub ? " — still stub" : ""}.` }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const reason = String(args.reason ?? "").trim();
      if (!reason) throw new Error("soul_update: `reason` is required — only record traits that showed up in real turns");
      const mode = String(args.mode ?? "patch").trim().toLowerCase() || "patch";
      const card = resolveCard(agentOf(exec));
      if (!card.name) throw new Error("soul_update: no persona card is active for this session");
      const current = card.text ?? "";
      let next;
      if (mode === "replace") {
        next = String(args.content ?? "").trim();
        if (!next) throw new Error("soul_update: `content` must be non-empty");
      } else if (mode === "patch") {
        next = patchCard(current, args.heading, args.content);
      } else {
        throw new Error("soul_update: `mode` must be patch or replace");
      }
      rejectMustache(next);
      if (isStub(next) && !isStub(current)) {
        throw new Error("soul_update: refused to re-stub a living card");
      }
      if (!isStub(next)) next = `${stripStubMarker(next)}\n`;
      const bytes = byteLen(next);
      const cap = cfg().soulMaxBytes ?? 8 * 1024;
      if (bytes > cap) {
        throw new Error(`soul_update: content exceeds soulMaxBytes (${cap}); patch one section or consolidate`);
      }
      const c = cfg();
      const settings = ctx.get("settings");
      if (!settings) throw new Error("soul_update: settings service unavailable");
      const nextCards = { ...(c.cards ?? {}), [card.name]: next };
      await settings.update(NS, { ...c, cards: nextCards });
      return { bytes, persona: card.name, mode, stub: isStub(next) };
    },
  }));
}

export {
  BOOTSTRAP_TEXT,
  Config,
  DEFAULT_CARD_NAME,
  MECHANISM_TEXT,
  NS,
  SECTION_MEMORY,
  SECTION_MECHANISM,
  SECTION_NAME,
  STUB_CARD,
  STUB_MARKER,
  apply,
  inject,
  isStub,
  needsStub,
  name,
  patchCard,
  rejectMustache,
  stripStubMarker,
};
