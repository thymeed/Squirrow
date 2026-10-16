# Architecture

- `src/core` is pure TypeScript with no React: types, search, context building, import/export parsing, and the storage repository. It is what the tests cover.
- `Repository` is an interface. The IndexedDB implementation (`idb`) is the only one today, so a sync or Tauri backend can replace it without touching the UI.
- `parseSnapshot` is the one boundary that handles untrusted data. Everything past it trusts the types. `Id` is a branded string so project and entry ids are not mixed with plain strings.
- Search is a small in-memory prefix matcher. Entry counts per project are expected in the hundreds, so an index and list virtualization were skipped on purpose. Revisit if projects grow to thousands of entries.
- Token counts are a 4-characters-per-token heuristic, labeled as an estimate in the UI.
- State lives in `useStore`, which writes to the repository first and then updates React state, so a failed write never shows as saved.
