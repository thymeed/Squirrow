# Context Keeper: agent handoff

Local-first React 19 + TypeScript + Vite app that stores per-project AI context (facts, decisions, preferences, snippets, file notes) in IndexedDB and copies a chosen set as Markdown. No backend. Repo: thymeed/context-keeper (private until the owner flips it public).

## Commands

- `npm run dev` runs the app. `npm test` runs Vitest. `npm run build` typechecks and builds into `dist/`.
- `npm run format` writes Prettier fixes. `npm run format:check` is what CI runs.

## Where things live

- `src/core/types.ts` has the data types and `ENTRY_KINDS`.
- `src/core/repository.ts` is the storage interface plus the IndexedDB implementation.
- `src/core/store.ts` is the React hook that writes to the repository, then updates state.
- `src/core/search.ts`, `inject.ts` and `portability.ts` hold the pure logic: ranking, context building and token estimate, import/export parsing.
- `src/ui/App.tsx` holds all screens and keyboard shortcuts. `src/ui/styles.scss` holds all styling and the dark theme.
- `tests/core.test.ts` covers `src/core`, `tests/store.test.tsx` the store hook, `tests/app.test.tsx` the main UI flows, and `tests/sw.test.ts` runs `public/sw.js` against fake caches.

## Rules for working here

- The owner does not write code by hand. Explain behavior first, then name the file and function. Never ask them to edit code.
- Keep core logic in `src/core` with no React imports. Parse untrusted input only in `parseSnapshot`.
- Work flows through GitHub: open an Issue, fix on a branch, open a PR, CI must be green. The owner does final acceptance before a release.
- Commits end with the Co-Authored-By line from the session attribution.
- Token budget: handle small tasks inline and avoid spawning subagents unless asked.

## Status

- MVP is built and CI is green. Live at https://context-keeper.thymeed.workers.dev, deployed by Cloudflare Workers Builds from `main` (`wrangler.jsonc` publishes `dist`).
- Done: PWA (manifest, icons, offline service worker in `public/`), landing copy and SEO tags in `index.html`.
- Open: outside tester round, owner acceptance, then the v1.0.0 tag (notes in `CHANGELOG.md`) and making the repo public. Cloudflare builds for PR branches fail instantly; production builds from `main` succeed.
- Not done: list virtualization (skipped on purpose). After changing the service worker caching, bump `CACHE` in `public/sw.js`.
