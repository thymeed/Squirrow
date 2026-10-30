# Squirrow: notes for agents

Local-first React 19 + TypeScript + Vite app that stores per-project AI context (facts, decisions, preferences, snippets, file notes) in IndexedDB and copies a chosen set as Markdown. No backend. Repo: thymeed/Squirrow (public).

Current status and the plan for the next change are kept in `CLAUDE.local.md`, which is gitignored and not in the repo.

## Commands

- `npm run dev` runs the app. `npm test` runs Vitest. `npm run build` typechecks and builds into `dist/`.
- `npm run format` writes Prettier fixes. `npm run format:check` is what CI runs.
- `npm run bench` times the core logic at 100 to 50,000 entries (about 6 minutes; code in `bench/`, results in `docs/SCALABILITY.md`).

## Where things live

- `src/core/types.ts` has the data types, `ENTRY_KINDS`, the model window table (`MODEL_PROFILES`) and `parseContextWindow`.
- `src/core/repository.ts` is the storage interface plus the IndexedDB implementation.
- `src/core/store.ts` is the React hook that writes to the repository, then updates state.
- `src/core/search.ts`, `inject.ts`, `markdown.ts` and `portability.ts` hold the pure logic: search and task scoring, context building, the token estimate and Auto-pick (`selectContext`), fence-safe Markdown helpers, import/export parsing.
- `src/ui/useUpdateReady.ts` watches for a waiting service worker and reloads every tab when a new one takes over. `scripts/stamp-sw.mjs` stamps the build hash into `dist/sw.js`.
- `src/ui/App.tsx` holds all screens and keyboard shortcuts. `src/ui/styles.scss` holds all styling and the dark theme.
- `tests/core.test.ts` covers `src/core`, `tests/store.test.tsx` the store hook, `tests/app.test.tsx` the main UI flows, `tests/sw.test.ts` runs `public/sw.js` against fake caches, and `tests/stamp-sw.test.ts` covers the build stamp.

## Rules for working here

- Keep core logic in `src/core` with no React imports. `store.ts` is the only exception, as the hook between storage and the UI. Parse untrusted input only in `parseSnapshot`.
- Work flows through GitHub: open an Issue, fix on a branch, open a PR. Run `npm run format:check`, `npm test` and `npm run build` before opening it. The owner does final acceptance before a release.

## Deployment and service worker

- Live at https://squirrow.thymeed.workers.dev, deployed by Cloudflare Workers Builds from `main` (`wrangler.jsonc` publishes `dist`). Cloudflare builds only run for `main`; preview builds for PR branches are switched off.
- The build stamps a content hash into the `CACHE` name in `dist/sw.js` (`scripts/stamp-sw.mjs`), so every release that changes a shipped file triggers the update prompt. Do not hand-bump `CACHE`; the source value `squirrow-dev` is a placeholder.
