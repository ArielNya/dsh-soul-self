/**
 * dsh-soul-md — soul.md-style persona injection for DeepSeek Harness.
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
 */
import { readFileSync, watch } from "node:fs";
import { isAbsolute, join } from "node:path";
import z from "@deepseek-ai/schemastery";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";

/** Cordis plugin name. */
const name = "soul-md";
/** The prompt registry this row contributes to. */
const inject = ["systemPrompt"];

/** Section name; deliberately distinct from the registry-owned `deployment:persona`. */
const SECTION_NAME = "soul:persona";

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
});

function apply(ctx, config) {
  const file = isAbsolute(config.path) ? config.path : join(resolveDshHome(), config.path);
  let active = null;

  const register = (text) => {
    if (active) {
      active.dispose();
      active = null;
    }
    if (text) {
      active = ctx.systemPrompt.section({
        name: SECTION_NAME,
        order: config.order,
        text,
        ...(config.complete ? { complete: true } : {}),
      });
    }
  };

  const refresh = () => {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      text = config.fallback;
    }
    register(text);
  };

  ctx.effect(() => {
    refresh();
    if (!config.watch) return undefined;
    let timer = undefined;
    let watcher = undefined;
    try {
      watcher = watch(file, { persistent: false }, () => {
        clearTimeout(timer);
        timer = setTimeout(refresh, config.debounceMs);
      });
    } catch {
      // File missing at startup: the fallback is registered; reloads are best-effort.
    }
    return () => {
      clearTimeout(timer);
      if (watcher) {
        try {
          watcher.close();
        } catch {
          /* already closed */
        }
      }
      if (active) {
        active.dispose();
        active = null;
      }
    };
  }, "soul-md.section()");
}

export { Config, SECTION_NAME, apply, inject, name };
