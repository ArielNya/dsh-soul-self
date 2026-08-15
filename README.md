# dsh-soul-md

[![中文文档](https://img.shields.io/badge/%E4%B8%AD%E6%96%87%E6%96%87%E6%A1%A3-blue)](README.zh.md)

**GitHub**: [Scorp1o117/dsh-soul-md](https://github.com/Scorp1o117/dsh-soul-md) · **npm**: [dsh-soul-md](https://www.npmjs.com/package/dsh-soul-md)

Soul.md-style persona injection for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

Load a markdown persona card (soul.md) and render it as the `soul:persona`
system-prompt section (order 0), so your agent keeps roleplaying while it
works. Edits to the file **hot-reload** — save and the next assembled prompt
uses the new persona.

- Registered on the **global prompt layer**: every agent in the process
  (web GUI, headless, subagents) sees it.
- No collision with the deployment persona (`deployment:persona`): it uses
  its own section name.
- Prompt variables (`{{model}}`, `{{cwd}}`) resolve at render time.
- **Web UI settings section (v0.2.0)**: Settings → 人设卡 edits the
  `soul-md` namespace (card path, fallback, order, watch) in `settings.yaml`;
  changes hot-apply. Mount by package name (`name: 'dsh-soul-md'`) so the
  web client bundle is discovered.
- **Long-term memory + self-growth (v0.3.0)**: the agent gets five tools —
  `soul_read` / `soul_update` to read and evolve its own persona card, and
  `memory_append` / `memory_read` / `memory_rewrite` for a persistent memory
  file (Agent.md / memory.md style). The tool descriptions encourage the
  agent to record what it learns and to fold stable traits into its persona,
  so it "grows" across sessions instead of resetting every time. The memory
  file is also injected as a `soul:memory` prompt section (capped) so the
  agent always sees its memories.

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
| `path` | required | Path to the soul.md card; absolute, or relative to the dsh home. |
| `fallback` | `''` | Text used when the file is missing/unreadable. Empty = no section. |
| `order` | `0` | Prompt section order (0 = right after the deployment persona slot). |
| `complete` | `false` | Treat the rendered card as the complete system prompt (advanced). |
| `watch` | `true` | Hot-reload the section on file change. |
| `debounceMs` | `300` | Reload debounce in milliseconds. |
| `soulMaxBytes` | `65536` | Cap for `soul_update` writes (protects the card from runaway rewrites). |
| `memory.path` | `memory.md` | Long-term memory file; absolute, or relative to the soul.md directory. |
| `memory.maxBytes` | `1048576` | `memory_append` / `memory_rewrite` refuse to exceed this size. |
| `memory.inject` | `true` | Also render the memory file as the `soul:memory` prompt section. |
| `memory.injectMaxChars` | `8000` | Cap for the injected section (from the file head); `memory_read` returns the full text. |
| `memory.order` | `0.5` | Prompt section order for the injected memory section. |

### Tools (the growth loop)

| Tool | What it does |
|---|---|
| `memory_append` | Append a dated Markdown entry (`section` heading + `content`) to the memory file. |
| `memory_read` | Read the whole memory file back (capped at 20k chars). |
| `memory_rewrite` | Replace the entire memory file (consolidate/dedupe; `""` clears it). |
| `soul_read` | Read the persona card exactly as stored. |
| `soul_update` | Replace the whole persona card — the agent's way to fold stable traits into its own identity. |

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

- **Never write `{{` / `}}` in the card body** — they are prompt-variable
  syntax; unknown variables fail rendering (no escape syntax yet).
- Section text stays stable during an agent's life (KV-cache friendly);
  editing soul.md re-registers the section from the next assembly on.
- Suggest putting work-quality rules in the card (e.g. "task quality first")
  so roleplay never degrades real work.

## Examples

See [`examples/soul.example.md`](examples/soul.example.md) and
[`examples/memory.example.md`](examples/memory.example.md).

## License

MIT
