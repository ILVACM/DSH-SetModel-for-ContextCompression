# @hbk/dsh-compaction-setmodel

Adds a **Compaction** card to DSH Settings for the context-compaction backend `@deepseek-ai/dsh-compaction-basic`.

## What it does

DSH condenses older conversation history when the context window fills up. By default that summary request follows whichever model the conversation last used. When the conversation model sits behind a channel that cannot serve the auxiliary request, this card lets you pin compaction to a dedicated provider and model instead.

The card controls six values of the `compaction-basic` entry in the profile patch file:

| Control | Field | Default | Rule |
|---|---|---|---|
| Compaction model mode | `summarizationProvider` / `summarizationModel` | follow | Follow conversation model removes both keys; Dedicated model writes them |
| Retain ratio | `retainRatio` | 0.16 | greater than 0, below 0.8, at most two decimals |
| Auto compaction | `auto` | true | boolean |
| Compaction retries | `compactionRetries` | 1 | integer 0–9 |
| Overflow retries | `maxOverflowRetries` | 1 | integer 0–9 |
| Backups to keep | plugin-local setting | 3 | integer 1–50 |

## Follow conversation model

Without a dedicated model, DSH picks the route of this session: the model that last answered you, then the latest request route, then the DSH defaults. It does not promise to equal the chat model currently selected in the UI.

## Compact context

The button runs one on-demand compaction of the current session. It calls the same compaction service `/compact` uses, so the operation is identical; the button path additionally keeps the backend's real failure cause (for example a missing API key) instead of the command's generic message. When the compaction service is unavailable the button falls back to the `/compact` command and says so.

## Where it saves

Only the `compaction-basic` entry of `<profile>/cordis.patch.yml` is edited, by line — comments, ordering, and every other entry stay byte-identical. Before each write the current file is copied to `~/.dsh-compaction-setmodel/backups/`, keeping the configured number of copies. A failed read-back rolls the file back.

## Hot reload and status

Saving triggers the official DSH hot reload (`hmr.runExclusive` + `reconcileProfile`). The card never replays a stored verdict: every read compares the saved values in the patch file against what is running right now, and reports one of four states.

- **Applied** — the running compaction service reports the saved values;
- **Restart DSH to apply** — DSH itself reported that only a restart replaces the changed modules;
- **Not confirmed** — the comparison could not be made or found no basis; the card states why (no probe path, no settled reload, or a mismatch without a restart reason) and offers **Check again**;
- **Apply failed** — the reload threw; the file is saved and the real error is shown.

Two signals keep that comparison current: the official settled-reload event (`app-boot/config-reload`) invalidates the cached probe immediately, opening the card forces a fresh probe, and a 30-second poll is only a fallback. The status line also shows the evidence basis (running instance or settled config row), when it was last confirmed, and how many config recompositions were observed.

The probe tries the running engine instance first (through the plugin context, the root context, and the `compaction-basic` entry's own fiber scope) and only falls back to the Loader config row — which is reported as the weaker basis instead of being passed off as the instance.

## Notes

- The card appears only for the profile that has it installed; it never changes the chat model.
- Error details are redacted before display; API keys and tokens never appear.
- Removing the plugin removes the card; the `compaction-basic` values it wrote stay in the patch file.
