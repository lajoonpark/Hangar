# Assets

Two-tier workflow so full-res masters never blow up git or agent context.

- `production/` — full-resolution masters from the image model. **Gitignored, local only.**
- `agent/` — ≤512px compressed previews. **Committed.** The agent only ever reads these.

## Drop workflow

1. Drop full-res masters into `assets/production/` (e.g. `icon-light-1024.png`).
2. Export/compress a ≤512px PNG copy into `assets/agent/` with the same basename
   (e.g. `icon-light-512.png`).
3. Tell the agent the filenames — it will review `assets/agent/` only.

## Naming

- `icon-light-*` / `icon-dark-*` — app icon masters (light/dark)
- `mark-*` — standalone `>>` chevron mark tests
- `hero-*` — welcome/empty-state artwork (if any)
