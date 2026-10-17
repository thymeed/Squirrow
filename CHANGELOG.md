# Changelog

## 1.0.0 (unreleased)

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
