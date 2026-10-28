# Squirrow

A local-first memory manager for your AI chats. Save facts, decisions, preferences, snippets and file notes per project, then copy the ones you pick into ChatGPT, Claude or any other assistant. No account, no backend. Your data stays in your browser's IndexedDB.

![Squirrow showing a demo project with three entries ticked and the copy panel open, in front of pixel-art scenery](public/og.png)

Live at https://squirrow.thymeed.workers.dev. It is installable and works offline.

## Install it as an app

- **Chrome or Edge (desktop):** open the site and click the install icon at the right of the address bar.
- **Android (Chrome):** open the menu and choose **Install app**.
- **iPhone or iPad (Safari):** tap **Share**, then **Add to Home Screen**.

After the first visit, the app opens without a connection.

## Back up your data

Your entries live only in this browser on this device. Clearing site data, using a private window, or switching browsers or devices means you won't see them. Use **Export JSON** now and then to keep a backup, and **Import JSON** to restore it or move it to another device. A banner asks you to back up when your last JSON export is more than 14 days old, or when you have never exported and your entries were first seen in this browser more than 14 days ago. **Dismiss** hides it for 7 days. Exporting JSON from the banner or the sidebar counts as a backup; Markdown export does not. The reminder and the date your entries were first seen are kept in local storage, and are never part of the export file.

## What it does

- **Projects** with five kinds of entry: fact, decision, preference, snippet and file note. Each kind has its own color and icon, and the entry dialog explains the chosen kind with an example.
- **Search** matches the start of any word, so `setup` finds "Database setup" but `base` does not. Every search word must match, and title matches rank above body matches. Ties go to the most recently edited entry.
- **Kind filter:** click the kind chips under the search box to show only those kinds. Several chips can be on at once, and they work together with search.
- **Copy for your AI chat:** tick entries, see a token estimate, and copy a paste-ready Markdown block. Snippets are wrapped in code fences.
- **Auto-pick:** choose a model (or type your own context window), a share of it and a task, and Auto-pick fills that budget with the best entries. Entries matching your task words come first, then decisions, preferences and facts. Entries you tick by hand are kept, entries you untick stay out, and everything left out is listed so nothing disappears silently.
- **Keyboard first:** `/` to search, `n` for a new entry, `Esc` to close.
- **Safe updates:** a new version waits until you click Reload, so it never swaps out the app mid-edit. When you do reload, every open Squirrow tab reloads, so finish typing in other tabs first.
- **Export and import:** JSON round-trips, and Markdown export is available. Import asks before it replaces your data.
- **Backup reminder:** a dismissible banner offers a JSON export when the last one is more than 14 days old, or when you have never exported and your entries were first seen more than 14 days ago. Dismissing hides it for 7 days.
- **Beginner friendly:** an empty-state guide with three steps, and a clear "Title is required" message instead of a silent failure.
- **Pixel-art scenery** (light and dark) with twinkling stars, shooting stars and hopping robots. The motion switches off when your system asks for reduced motion.

## Develop

```
npm install
npm run dev      # local server
npm test         # Vitest (core logic, UI flows, service worker)
npm run build    # typecheck + production build into dist/
npm run format   # Prettier; CI runs format:check
```

The scenery images are generated: edit `scripts/make-scenery.py` and run `python scripts/make-scenery.py` from the repo root.

## How it is built

React 19, TypeScript and Vite. Logic lives in `src/core` with no React imports: storage behind a `Repository` interface, ranking in `search.ts`, context building and the token estimate in `inject.ts`, and import parsing in `portability.ts`. Untrusted input is parsed in one place, `parseSnapshot`. See [ARCHITECTURE.md](ARCHITECTURE.md) for the design decisions.

## Limits

- The token count is an estimate of about 4 characters per token, not a real tokenizer.
- The backup reminder is remembered per browser. Another browser or device will show its own reminder, and counts its own 14 days from when it first saw entries. Anyone who already has entries starts counting from their next visit.
- The list is not virtualized, which is fine for hundreds of entries. It would need changing for thousands.
- Tests cover `src/core`, the main UI flows and the service worker. Browser-specific behavior such as installing and clipboard permissions is checked by hand.

## Privacy

Nothing is sent anywhere. There is no backend, analytics or account.

## License

MIT
