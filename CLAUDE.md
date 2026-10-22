# Squirrow: agent handoff

Local-first React 19 + TypeScript + Vite app that stores per-project AI context (facts, decisions, preferences, snippets, file notes) in IndexedDB and copies a chosen set as Markdown. No backend. Repo: thymeed/Squirrow (public).

## Commands

- `npm run dev` runs the app. `npm test` runs Vitest. `npm run build` typechecks and builds into `dist/`.
- `npm run format` writes Prettier fixes. `npm run format:check` is what CI runs.

## Where things live

- `src/core/types.ts` has the data types, `ENTRY_KINDS`, the model window table (`MODEL_PROFILES`) and `parseContextWindow`.
- `src/core/repository.ts` is the storage interface plus the IndexedDB implementation.
- `src/core/store.ts` is the React hook that writes to the repository, then updates state.
- `src/core/search.ts`, `inject.ts`, `markdown.ts` and `portability.ts` hold the pure logic: search and task scoring, context building, the token estimate and Auto-pick (`selectContext`), fence-safe Markdown helpers, import/export parsing.
- `src/ui/useUpdateReady.ts` watches for a waiting service worker and reloads every tab when a new one takes over. `scripts/stamp-sw.mjs` stamps the build hash into `dist/sw.js`.
- `src/ui/App.tsx` holds all screens and keyboard shortcuts. `src/ui/styles.scss` holds all styling and the dark theme.
- `tests/core.test.ts` covers `src/core`, `tests/store.test.tsx` the store hook, `tests/app.test.tsx` the main UI flows, `tests/sw.test.ts` runs `public/sw.js` against fake caches, and `tests/stamp-sw.test.ts` covers the build stamp.

## Rules for working here

- The owner does not write code by hand. Explain behavior first, then name the file and function. Never ask them to edit code.
- Keep core logic in `src/core` with no React imports. `store.ts` is the only exception, as the hook between storage and the UI. Parse untrusted input only in `parseSnapshot`.
- Work flows through GitHub: open an Issue, fix on a branch, open a PR, CI must be green. The owner does final acceptance before a release.
- Commits end with the Co-Authored-By line from the session attribution.
- Token budget: handle small tasks inline and avoid spawning subagents unless asked.

## Status

- MVP is built and CI is green. Live at https://squirrow.thymeed.workers.dev, deployed by Cloudflare Workers Builds from `main` (`wrangler.jsonc` publishes `dist`).
- Done: PWA (manifest, icons, offline service worker in `public/`), landing copy and SEO tags in `index.html`. v1.0.0 released 2026-10-17. v1.1.0 released 2026-10-21: rename to Squirrow with a migration from the old `context-keeper` database, a prompt-before-update flow (checked live), and Auto-pick with model budgets.
- Open: outside tester feedback (none yet; goes into 1.1.x). Cloudflare builds only run for `main`; preview builds for PR branches are switched off, so PRs show just the GitHub `test` check.
- Service worker: the build stamps a content hash into the `CACHE` name in `dist/sw.js` (`scripts/stamp-sw.mjs`), so every release that changes a shipped file triggers the update prompt. Do not hand-bump `CACHE`; the source value `squirrow-dev` is a placeholder.
- Not done: list virtualization (skipped on purpose). Auto-pick measures each candidate by rebuilding the context, which is slow with thousands of entries in one project.
