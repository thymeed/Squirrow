# Scalability

This page shows how Squirrow behaves as one project gets bigger, where it starts to slow down, and what was not measured. The numbers come from one machine, up to 3 browser runs per size (1 at 50,000 entries), and synthetic data. They are not a promise for any real dataset.

## What 'load' means for Squirrow

Squirrow has no backend. Each browser holds its own dataset in IndexedDB, and search, Auto-pick, copy and export all run in that one browser tab. So "load" here means one person with one dataset of N entries in one project, on one device. There are no concurrent-user, server or throughput numbers, because there is no server to measure. Nothing below says anything about many people using Squirrow at once.

## How it was measured

There are two methods.

- **Core logic in Node** (`npm run bench`, see `bench/run.mjs`). The pure functions in `src/core` run on generated entries: search, task scoring, context build, Auto-pick (`selectContext`), Markdown export, and JSON export with parse. Each operation and size runs in its own child process, and only the operation itself is timed. Fixture generation runs before the timer. Each cell is the median of 5 timed runs for 100 and 1,000 entries, or 3 timed runs for 5,000 and up, after 1 warm-up run. Each run has a 60 s cap, and a run over the cap is stopped and reported as such. Two full runs agreed within about 10%. One benchmark takes about 6 minutes.
- **Real browser** (`bench/browser-harness.js`). A local production build is served on 127.0.0.1 and measured in Chrome. The harness seeds the app's own IndexedDB database, then times two things: creating a same-origin iframe of the app until all N list rows are in the DOM ("Load"), and search updates ("Search"). Each search step sets the whole text of the search box in one input event and times it until two animation frames later, so each number is the cost of one search update, comparable to one keystroke, and includes up to about two frames of frame time (about 33 ms at 60 Hz; the refresh rate was not recorded). The browser numbers are medians of 3 runs for 100, 1,000 and 5,000 entries, 2 runs for 10,000 (shown as the average of the two), and 1 run for 50,000.

Machine and data:

- Date: 2026-10-30.
- Machine: AMD Ryzen 9 5900X, Windows 11.
- Node: v24.22.1.
- Chrome: version not recorded.
- Data: synthetic and seeded. Five kinds (fact, decision, preference, snippet, file note). Titles of 5 to 10 words and bodies of 20 to 200 words, drawn from a fixed word list. The Node benchmark and the browser harness each use their own generator with the same sizes and kinds, so the two data sets are similar but not identical (for example, the browser snippets are plain prose).
- Auto-pick budget: half of the full context's tokens, so about 40 to 45% of entries fit (checked at 100, 1,000 and 5,000 entries).

To rerun the Node benchmark:

```
npm install
npm run bench
```

To rerun the browser harness:

```
npm run build
npx vite preview --host 127.0.0.1
```

In a throwaway browser profile, first open the app itself at the origin that `vite preview` prints, once, so the app creates its `squirrow` database. Then open `/robots.txt` on the same origin (it does not load the app). Open the DevTools console, paste the contents of `bench/browser-harness.js`, run `runAll([[100,3],[1000,3]])`, and read `results`. The harness writes to the `squirrow` IndexedDB on that origin, so use a throwaway profile or run `indexedDB.deleteDatabase('squirrow')` afterwards. If `seed` throws, or the app stops loading after a first visit to `/robots.txt`, the harness may have created an empty database: run `indexedDB.deleteDatabase('squirrow')`, then open the app again in the same tab (or close the `/robots.txt` tab first, because a failed `seed` leaves a connection open that blocks the delete in other tabs). The tool used for these runs timed out on console calls longer than about 45 s, so start longer plans without awaiting and poll `status` and `results`.

## Results

### Core logic in Node

Milliseconds, median. "over 60 s (stopped)" means the run passed the 60 s cap and was stopped. "not run" means it was not attempted.

| Operation                                   |  100 | 1,000 | 5,000 |                            10,000 |                            50,000 |
| ------------------------------------------- | ---: | ----: | ----: | --------------------------------: | --------------------------------: |
| searchEntries (3-word query)                | 0.97 |  8.63 |  33.3 |                              67.1 |                             335.7 |
| scoreTask (task sentence)                   | 1.58 |  11.6 |  54.8 |                             101.3 |                             511.2 |
| buildContext (all entries)                  | 0.15 |  1.29 |  7.40 |                              15.0 |                              93.3 |
| selectContext (Auto-pick), estimated tokens | 1.80 |  13.1 |  65.7 |                             123.1 |                             681.4 |
| selectContext (Auto-pick), real tokenizer   | 4.28 |  33.9 | 182.7 |                             355.5 |                           1,859.5 |
| exportMarkdown                              | 0.15 |  0.98 |  6.36 |                              13.3 |                              84.7 |
| exportJson + parseSnapshot                  | 0.31 |  2.76 |  15.5 | rejected: over 10 MB import limit | rejected: over 10 MB import limit |

JSON export size: 100 entries = 0.10 MB, 1,000 = 1.0 MB, 5,000 = 5.0 MB, 10,000 = 10.2 MB, 50,000 = 51.0 MB (characters are about bytes here).

### Real browser (Chrome, local production build)

Milliseconds. "Load" is from creating the app iframe until all rows are in the DOM. "Search" columns are one search update each: the search box text is set to 'cache', then 'cache index', then 'cache index token', then cleared, each in one input event and timed until two animation frames later. The last column is the DOM node count after render.

| Entries |   Load | Search 'cache' | 'cache index' | 'cache index token' |  Clear | DOM nodes |
| ------: | -----: | -------------: | ------------: | ------------------: | -----: | --------: |
|     100 |    100 |             37 |            82 |                  56 |     34 |       984 |
|   1,000 |    306 |            323 |           214 |                 184 |    293 |     9,084 |
|   5,000 |  1,579 |          1,413 |         1,346 |                 968 |  1,620 |    45,084 |
|  10,000 |  2,643 |          3,109 |         3,457 |               2,484 |  3,151 |    90,084 |
|  50,000 | 13,181 |         25,805 |        50,253 |              13,906 | 22,502 |   450,084 |

Notes on these numbers:

- The 10,000 row is the average of 2 runs. The 50,000 row is a single run.
- Cells at 100 entries move around between runs (24 to 130 ms) because they are close to the frame time.
- An earlier exploratory version of the harness, which also had the app open in the host tab, gave one 5,000-entry load of 319 ms against 1,323 ms in another run. That version was discarded, and the numbers above come from the cleaner setup.
- One harness call that seeded 10,000 entries and then measured them left the page unresponsive for over 45 s, and the test tool timed out. The seeding and the measurement were not timed separately, so this says nothing on its own about how the app behaves for a user.
- The browser harness does not time Auto-pick or export. Those are only in the Node table.

## Where it breaks

For reference, under about 100 ms usually feels instant to a person using a UI, and over about 1 s feels slow.

1. **Auto-pick was the first wall and is now close to linear.** The first version measured each candidate by rebuilding the whole context, so its cost grew with the square of the entry count: 0.4 s at 1,000 entries with the estimate counter, about 9 s at 5,000 and about 41 s at 10,000, and with the real o200k tokenizer 6.7 s at 1,000 entries and more than 60 s at 5,000. Issue #79 fixed this by counting each entry once and doing one exact count of the final text. It now takes 13.1 ms at 1,000 entries and 681.4 ms at 50,000 with the estimate counter, and 33.9 ms at 1,000, 182.7 ms at 5,000 and 1,859.5 ms at 50,000 with the real tokenizer. From 1,000 to 5,000 entries (5 times as many) the time grows 5.0 times with the estimate counter and 5.4 times with the real tokenizer. Because pieces are counted separately, Auto-pick can occasionally leave out an entry that would have fit exactly; the total it reports is always an exact count. In a test with the real tokenizer at 1,000 entries, the old and new code picked the same entries.

2. **The list is now the first wall, in the browser.** The list is not virtualized, so every row is in the DOM, at about 9 DOM nodes per entry. Initial load is 306 ms at 1,000 entries, 1,579 ms at 5,000, 2,643 ms at 10,000 and 13,181 ms at 50,000. Every search update re-renders the whole list. One search update (setting the box to 'cache') takes 323 ms at 1,000 entries, 1,413 ms at 5,000, 3,109 ms at 10,000 and 25,805 ms at 50,000. A person typing a word pays about that cost per keystroke. Across all four search steps (the 'cache', 'cache index', 'cache index token' and clear cells), the 1,000-entry cells range from 184 to 323 ms, the 5,000-entry cells from 968 to 1,620 ms, the 10,000-entry cells from 2,484 to 3,457 ms, and the 50,000-entry cells from 13,906 to 50,253 ms.

   The search algorithm itself is not the likely cause. In Node, search, scoring, context build and export are roughly linear and cheap: search takes 335.7 ms even at 50,000 entries. The browser latency tracks the number of entries, so the likely cause is rendering the list on every search update. This is inferred from how the entry count matches the latency. No profile was taken, and the number of rows left after filtering was not recorded.

3. **Import limit.** A project of about 10,000 entries exports to about 10.2 MB of JSON. The import guard `MAX_IMPORT_CHARS` in `src/core/portability.ts` is 10,000,000 characters, so that export cannot be imported back. A 5,000-entry export (5.0 MB) is under the limit.

**Comfortable range, by feature:**

- **List, search and export:** up to about 1,000 entries per project. At that size every browser median measured here is under about 0.35 s (one Clear run reached 610 ms), and Node search, scoring, context build and export take under 12 ms.
- **Auto-pick:** under 0.2 s up to 5,000 entries with the real tokenizer, which the app uses by default (33.9 ms at 1,000 and 182.7 ms at 5,000), and 1.9 s at 50,000.
- **At 5,000 entries and above:** expect visible slowness in the list (about 1 to 1.6 s per search update). Auto-pick stays fast.

## What this does not cover

- One machine (AMD Ryzen 9 5900X, Windows 11), up to 3 browser runs per size, and one run for the 50,000-entry browser number.
- Chrome only. Firefox, Safari and Edge were not measured.
- No phone and no low-end device.
- Cold start is not isolated. The harness seeds the database and then loads the app in the same browser session, so the load numbers are not first-visit or cold-cache measurements, and database reads are not separated from rendering.
- No multi-tab test.
- Synthetic text from a fixed word list. Real notes will differ, and token counts on real text were not measured.
- Auto-pick and export were not timed in the browser.
- Memory use, battery use and clipboard copy in the browser were not measured.
- No concurrent users and no server load. Squirrow has no server, and none was measured.

## Known limits and next steps

- **Auto-pick:** fixed in [#79](https://github.com/thymeed/Squirrow/issues/79). It counts each entry once instead of rebuilding the context per candidate. The fallback estimate counter rounds up per piece, so it can leave out an entry that would fit exactly. Only the Auto-pick rows were re-measured after the fix; the other Node rows are from the first run (two full runs agreed within about 10%).
- **List:** not virtualized. Rendering all rows is the likely browser cost described above. Virtualization has not been done yet.
- **Import limit:** the 10 MB guard means a project of about 10,000 entries of this size cannot be restored from its own JSON export.
- This page records the baseline. The numbers above are what a follow-up change should be compared against.
