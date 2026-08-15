# dsh-soul-md

[![中文文档](https://img.shields.io/badge/%E4%B8%AD%E6%96%87%E6%96%87%E6%A1%A3-blue)](README.zh.md)

**GitHub**: [Scorp1o117/dsh-soul-md](https://github.com/Scorp1o117/dsh-soul-md) · **npm**: [dsh-soul-md](https://www.npmjs.com/package/dsh-soul-md)

Soul.md-style persona + long-term memory for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

**Multi-persona (v0.4.0)**: the persona is resolved per prompt assembly
through a three-level chain, so switching applies from the next turn and
different sessions carry different personas in one process:

```
session choice (chat-box switcher) > workspace card (.dsh-persona.md) > global default (path) > fallback
```

The `soul:persona` section uses **function text** (evaluated per assembly
with the agent context — the workspace comes from the session's cwd), with
mtime-cached reads, so a steady card stays byte-identical (KV-cache
friendly) and edits hot-apply with no watcher.

- Registered on the **global prompt layer** with per-agent resolution.
- No collision with the deployment persona (`deployment:persona`): it uses
  its own section name.
- Prompt variables (`{{model}}`, `{{cwd}}`) resolve at render time.
- **Chat-box switcher (v0.4.0)**: a "人设" select in the conversation header
  (`conversation.session.header.actions`) switches the current session's
  persona; the choice is stored per sessionId in the `soul-md` settings
  namespace.
- **Web UI settings section (v0.2.0)**: Settings → 人设卡 edits the
  `soul-md` namespace (global card path, fallback, order, persona registry
  dir, memory scoping) in `settings.yaml`; changes hot-apply. Mount by
  package name (`name: 'dsh-soul-md'`) so the web client bundle is
  discovered.
- **Long-term memory, scoped (v0.4.0)**: memory mirrors the persona scope —
  persona card memory (`<card dir>/<stem>.memory.md`) > workspace memory
  (`.dsh-memory.md`) > global memory (`memory.path`, default `memory.md`
  next to the global card). Reads and the injected `soul:memory` section
  walk the chain and use the first existing file; writes target the most
  specific scope of the current agent and create it on demand.
- **Self-growth tools (v0.3.0)**: `soul_read` / `soul_update` read/rewrite
  the card ACTIVE for the calling agent; `memory_append` / `memory_read` /
  `memory_rewrite` operate on the agent's memory scope. The tool
  descriptions encourage the agent to record what it learns and to fold
  stable traits into its persona, so it "grows" across sessions.

## Install

The plugin is a plain Cordis row. Mount it in a profile patch
(`$DSH_HOME/profiles/<name>/cordis.patch.yml`):

```yaml
- insert:
    - id: soul-md
      name: 'dsh-soul-md'          # after: pnpm add dsh-soul-md in the profile
      config:
        path: 'C:/Users/you/soul.md'   # absolute, or relative to dsh home
        watch: true
```

Or load it from a local path without npm:

```yaml
    - id: soul-md
      name: './plugins/dsh-soul-md/index.js'
```

## Config

| Field | Default | Meaning |
|---|---|---|
| `path` | required | Global-default persona card; absolute, or relative to the dsh home. |
| `fallback` | `''` | Text used when the resolved card is missing/unreadable. Empty = no section. |
| `order` | `0` | Prompt section order for the persona section. |
| `complete` | `false` | Treat the rendered card as the complete system prompt (advanced). |
| `watch` / `debounceMs` | `true` / `300` | Legacy no-ops (sections resolve per assembly now). |
| `soulMaxBytes` | `65536` | Cap for `soul_update` writes (protects cards from runaway rewrites). |
| `personas.dir` | `''` | Persona registry directory (`*.md` cards); empty disables the roster. |
| `personas.workspaceFile` | `.dsh-persona.md` | Workspace persona card filename (inside the session's workspace). |
| `sessions` | `{}` | Per-session persona choice (sessionId → persona key); written by the chat switcher. |
| `roster` | `[]` | Read-only list of selectable personas, maintained by the host. |
| `memory.path` | `memory.md` | Global memory file; absolute, or relative to the global card's directory. |
| `memory.workspaceFile` | `.dsh-memory.md` | Workspace memory filename (inside the session's workspace). |
| `memory.maxBytes` | `1048576` | `memory_append` / `memory_rewrite` refuse to exceed this size. |
| `memory.inject` | `true` | Also render the memory file as the `soul:memory` prompt section. |
| `memory.injectMaxChars` | `8000` | Cap for the injected section (from the file head); `memory_read` returns the full text. |
| `memory.order` | `0.5` | Prompt section order for the injected memory section. |

Persona keys: `""` (auto: workspace → global), `global`, `workspace`,
`registry:<stem>` (a card in `personas.dir`). Workspace cards/memories live
in the session's workspace directory, so one process serves many workspaces
with distinct personas and memories.

### Tools (the growth loop)

| Tool | What it does |
|---|---|
| `memory_append` | Append a dated Markdown entry to the CURRENT memory scope (persona card > workspace > global). |
| `memory_read` | Read the current memory scope, falling back down the chain (capped at 20k chars). |
| `memory_rewrite` | Replace the CURRENT memory scope's file (consolidate/dedupe; `""` clears it). |
| `soul_read` | Read the persona card ACTIVE for the calling agent, exactly as stored. |
| `soul_update` | Replace the active persona card — the agent's way to fold stable traits into its own identity. |

The tool descriptions carry the growth guidance: record what you learn
proactively, consolidate when the file grows unwieldy, and update the card
only for real, stable change.


> **Note for users**
> - `dsh plugin` prints "declares no dsh.bundle — installed as a plain
>   dependency" — **expected**: this plugin mounts via `cordis.patch.yml`.
> - The settings section needs the `dsh-host-apiproxy` namespace allowlist;
>   the plugin patches it automatically on first start — **restart `dsh web`
>   once more** and the section appears. A dsh update overwrites the patch;
>   the next plugin start re-applies it.
> - Settings changes hot-apply (no restart needed).
> - Tested against DSH `0.1.0-rc.6`.


## Notes

- **Never write `{{` / `}}` in a card body** — they are prompt-variable
  syntax; unknown variables fail rendering (no escape syntax yet).
- Persona/memory sections resolve per assembly (mtime-cached reads), so a
  steady card stays byte-identical and KV-cache friendly; switching persona
  or editing a card changes the text from the next assembly on.
- Suggest putting work-quality rules in the card (e.g. "task quality first")
  so roleplay never degrades real work.
- A session whose chosen persona key is missing (e.g. a registry card was
  deleted) silently falls back down the chain; the chat switcher shows the
  stale key so you can fix it.

## Examples

See [`examples/soul.example.md`](examples/soul.example.md) and
[`examples/memory.example.md`](examples/memory.example.md).

## License

MIT
