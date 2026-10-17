# Architecture

- `src/core` is pure TypeScript with no React: types, search, context building, Markdown fencing, import/export parsing, and the storage repository. The one exception is `store.ts`, the React hook that connects the repository to the UI.
- `Repository` is an interface. The IndexedDB implementation (`idb`) is the only one today, so a sync or Tauri backend can replace it without touching the UI.
- `parseSnapshot` is the one boundary that handles untrusted data. Everything past it trusts the types. `Id` is a branded string so project and entry ids are not mixed with plain strings.
- Search is a small in-memory prefix matcher. Entry counts per project are expected in the hundreds, so an index and list virtualization were skipped on purpose. Revisit if projects grow to thousands of entries.
- Token counts are a 4-characters-per-token heuristic, labeled as an estimate in the UI.
- Tests cover `src/core`, the store hook, the main UI flows (`tests/app.test.tsx`) and the service worker (`tests/sw.test.ts`).
- State lives in `useStore`, which writes to the repository first and then updates React state, so a failed write never shows as saved.
