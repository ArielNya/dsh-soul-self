# dsh-soul-md

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

## Notes

- **Never write `{{` / `}}` in the card body** — they are prompt-variable
  syntax; unknown variables fail rendering (no escape syntax yet).
- Section text stays stable during an agent's life (KV-cache friendly);
  editing soul.md re-registers the section from the next assembly on.
- Suggest putting work-quality rules in the card (e.g. "task quality first")
  so roleplay never degrades real work.

## Examples

See [`examples/soul.example.md`](examples/soul.example.md).

## License

MIT
