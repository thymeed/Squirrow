# Changelog

## Unreleased

- Auto-pick chooses the entries that fit a model's context window, ranked by your task. It lists the entries it left out.
- Every release that changes a shipped file now triggers the update prompt. The build stamps a hash of the shipped files, including the service worker's own code, into its cache name, so a release can no longer forget the manual bump.
- Updates no longer swap the app under an open tab. A new version waits, and an "Update available" notice with a Reload button appears. Nothing reloads until you click it.
- Renamed to Squirrow. Data from the old `context-keeper` database on the same address is copied over on first open. If that copy fails, the app starts empty and the old database is kept.
- A new web address has a separate browser storage area. Before switching, export your data from the old address, then import it at the new one.

## 1.0.0 (2026-10-17)

First public release.

- Projects with five kinds of entry: fact, decision, preference, snippet and file note.
- Search by word prefix, with title matches ranked first.
- Copy ticked entries as paste-ready Markdown with a token estimate. Ticked entries stay selected while you search.
- Export and import as JSON, plus Markdown export. Import rejects invalid files, duplicate ids and files over 10 MB with a readable message.
- Text containing code fences or several lines keeps the copied Markdown intact.
- Installable PWA that works offline. Visiting a broken link no longer replaces the offline app.
- Clear messages when your data can't load or the clipboard is blocked.
- Keyboard shortcuts: `/` search, `n` new entry, `Esc` close. Browser shortcuts such as Ctrl+N are left alone.
- Everything stays in your browser. There is no backend, account or analytics.
