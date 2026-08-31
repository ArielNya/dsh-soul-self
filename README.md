# dsh-soul-self

Fork of [dsh-soul-md](https://github.com/Scorp1o117/dsh-soul-md) for one girl who writes her own card. You do not author a personality.

**GitHub**: [ArielNya/dsh-soul-self](https://github.com/ArielNya/dsh-soul-self)

Persona + long-term memory for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Coding tools stay on. `complete: true` is never mounted.

## What this fork changes

1. **Mechanism stub.** On first run, if there are no cards, the plugin seeds a card named `self`:

   ```markdown
   <!-- dsh-soul-self:stub -->
   I have not written myself yet.
   ```

   A frozen `soul:mechanism` section is always injected (byte-stable for cache). It is not a character sheet.

2. **Bootstrap once.** While the stub marker is still in the card, extra bootstrap text is appended to `soul:persona`. After the first real `soul_update`, bootstrap stays off.

3. **Hard rules in code.**
   - `soul_update` defaults to **patch** (one `##` heading). `replace` is for the first write off the stub or a rare consolidation.
   - `reason` is required. Only traits that showed up in real turns.
   - `{{` / `}}` are refused.
   - Soul cap is 8 KiB.
   - Facts about Alice go in `memory_append`, not the soul.

## Install

```bash
dsh plugin --profile web add github:ArielNya/dsh-soul-self
```

Or a local checkout:

```bash
dsh plugin --profile web add /path/to/dsh-soul-self
```

Restart `dsh web`. Open **Settings → Persona Card**. You should see `self` already there. Do not paste a character bible.

The bundle patch mounts:

```yaml
- insert:
    - id: soul-md
      name: 'dsh-soul-self'
```

Cordis id stays `soul-md` so the settings namespace and UI keep working.

## Two presets, one soul

`work` and `home` must use the **same** card (`self`) and the **same** memory directory (`$DSH_HOME/soul-md/memory/`). Two moods. One person.

| Preset | Use | Banter |
|---|---|---|
| `work` | coding | low |
| `home` | hanging out | normal |

Do not install `dsh-humanized-deepseek-maid`, `dsh-companion`, `dsh-plugin-memory`, or a second soul plugin alongside this. They fight over identity.

## First session

Open `home`. Do not paste a card. Talk. Do a small real task. Leave. Come back. Then check the card: `soul_update` should have fired and the stub marker should be gone. If it is still the stub, the tool is not firing — fix that. Do not write her personality for her.

## Tools

- `soul_read` / `soul_update` — her card
- `memory_append` / `memory_read` / `memory_rewrite` — shared life / project facts

Resolution: `session choice > workspace mapping > default card > none`.

## Config notes

Same settings namespace as upstream (`soul-md`). `complete` in config is ignored. `soulMaxBytes` defaults to 8192.

Never write `{{` / `}}` in a card body.

## License

MIT. Upstream: Scorp1o117/dsh-soul-md.
