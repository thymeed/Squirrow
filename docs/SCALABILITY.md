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

| Operation                                   |  100 | 1,000 | 5,000 | 10,000 |  50,000 |
| ------------------------------------------- | ---: | ----: | ----: | -----: | ------: |
| searchEntries (3-word query)                | 0.97 |  8.63 |  33.3 |   67.1 |   335.7 |
| scoreTask (task sentence)                   | 1.58 |  11.6 |  54.8 |  101.3 |   511.2 |
| buildContext (all entries)                  | 0.15 |  1.29 |  7.40 |   15.0 |    93.3 |
| selectContext (Auto-pick), estimated tokens | 1.80 |  13.1 |  65.7 |  123.1 |   681.4 |
| selectContext (Auto-pick), real tokenizer   | 4.28 |  33.9 | 182.7 |  355.5 | 1,859.5 |
| exportMarkdown                              | 0.15 |  0.98 |  6.36 |   13.3 |    84.7 |
| exportJson + parseSnapshot                  | 0.31 |  2.76 |  15.5 |   29.8 |   140.6 |

JSON export size: 100 entries = 0.10 MB, 1,000 = 1.0 MB, 5,000 = 5.0 MB, 10,000 = 10.2 MB, 50,000 = 51.0 MB (characters are about bytes here).

### Real browser (Chrome, local production build), before #88

These numbers were measured before PR #88, when the search box and the list updated together. Milliseconds. "Load" is from creating the app iframe until all rows are in the DOM. "Search" columns are one search update each: the search box text is set to 'cache', then 'cache index', then 'cache index token', then cleared, each in one input event and timed until two animation frames later. The last column is the DOM node count after render.

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

### Real browser after #88 (5,000 entries)

PR #88 memoised the entry rows, made the tick handler stable, and made the list follow a deferred copy of the search text. Only 5,000 entries were re-measured. 1,000, 10,000 and 50,000 entries were not, so the table above still stands for those sizes.

Because the list now catches up after the search box, the stock harness (two animation frames after the input) would only time the search box. These numbers come from a small timing script that also waits until the list has the expected number of rows (4,494, 4,111, 3,820 and 5,000), then two more frames. Milliseconds, 3 runs each, same session as the "before" column.

| 5,000 entries, one search update | Before #88: list updated | After #88: list updated | After #88: search box updated |
| -------------------------------- | ------------------------ | ----------------------- | ----------------------------- |
| 'cache'                          | 1,880 / 2,076 / 2,027    | 1,414 / 1,914 / 1,776   | 95 / 436 / 404                |
| 'cache index'                    | 1,610 / 1,489 / 1,734    | 1,374 / 1,284 / 1,504   | 335 / 375 / 352               |
| 'cache index token'              | 1,402 / 1,624 / 1,331    | 1,281 / 1,230 / 1,185   | 279 / 293 / 301               |
| clear                            | 1,973 / 1,804 / 1,923    | 2,025 / 1,758 / 1,874   | 210 / 237 / 1,531             |

Ticking one entry in the 5,000-row list: before, 140, 189 and 158 ms (62 to 70 ms of React work); after, 54, 61, 58, 58 and 65 ms (4 to 6 ms of React work).

Notes on these numbers:

- The search box now shows the new text in about 0.1 to 0.4 s instead of waiting for the whole list. One clear step took 1.5 s.
- The list itself still takes about 1.2 to 2.0 s to show new results. On the medians that is 3% to 15% better than before, which is within the run-to-run noise.
- The same unchanged code measured 1,880 to 2,076 ms for 'cache' at 5,000 entries on the day of #88, against 1,413 ms in the table above. The machine state can differ by 30% or more between sessions, so only compare numbers measured in the same session.
- Profile at 5,000 entries (React work, then total until two frames later): removing all rows 185 and 231 ms; bringing all 5,000 rows back 221 and 1,527 ms; searching 'cache' 325 and 1,757 ms; clearing 280 and 1,988 ms. An earlier profile run split differently (React 842 to 1,237 ms, browser time about 0.6 to 0.8 s). Browser layout and paint of thousands of cards took 0.6 to 1.7 s every time, and memoising cannot reduce it.
- In this data the word 'cache' matches 4,494 of 5,000 entries, so the list barely shrinks when you search. That is a worst case for rendering.
- A CSS-only `content-visibility: auto` experiment did not help (most steps were slower in both runs) and was not kept.

## Where it breaks

For reference, under about 100 ms usually feels instant to a person using a UI, and over about 1 s feels slow.

1. **Auto-pick was the first wall and is now close to linear.** The first version measured each candidate by rebuilding the whole context, so its cost grew with the square of the entry count: 0.4 s at 1,000 entries with the estimate counter, about 9 s at 5,000 and about 41 s at 10,000, and with the real o200k tokenizer 6.7 s at 1,000 entries and more than 60 s at 5,000. Issue #79 fixed this by counting each entry once and doing one exact count of the final text. It now takes 13.1 ms at 1,000 entries and 681.4 ms at 50,000 with the estimate counter, and 33.9 ms at 1,000, 182.7 ms at 5,000 and 1,859.5 ms at 50,000 with the real tokenizer. From 1,000 to 5,000 entries (5 times as many) the time grows 5.0 times with the estimate counter and 5.4 times with the real tokenizer. Because pieces are counted separately, Auto-pick can occasionally leave out an entry that would have fit exactly; the total it reports is always an exact count. In a test with the real tokenizer at 1,000 entries, the old and new code picked the same entries.

2. **The list is now the first wall, in the browser.** The list is not virtualized, so every row is in the DOM, at about 9 DOM nodes per entry. Before #88, initial load was 306 ms at 1,000 entries, 1,579 ms at 5,000, 2,643 ms at 10,000 and 13,181 ms at 50,000, and one search update (setting the box to 'cache') took 323 ms at 1,000 entries, 1,413 ms at 5,000, 3,109 ms at 10,000 and 25,805 ms at 50,000. A person typing a word paid about that cost per keystroke. After #88 the search box and ticking stay responsive at 5,000 entries (see the section above), but the list still takes about 1.2 to 2.0 s to show new results there. Before #88, across all four search steps (the 'cache', 'cache index', 'cache index token' and clear cells), the 1,000-entry cells ranged from 184 to 323 ms, the 5,000-entry cells from 968 to 1,620 ms, the 10,000-entry cells from 2,484 to 3,457 ms, and the 50,000-entry cells from 13,906 to 50,253 ms.

   The search algorithm itself is not the cause. In Node, search, scoring, context build and export are roughly linear and cheap: search takes 335.7 ms even at 50,000 entries. A profile at 5,000 entries (section above) shows that most of the time is the browser laying out and painting thousands of cards, which took 0.6 to 1.7 s in every run. The only fix found is virtualization (rendering only the rows on screen), which has not been done. It is tracked in #84, parked for now.

3. **Import limit (raised in #85).** The import guard `MAX_IMPORT_CHARS` in `src/core/portability.ts` used to be 10,000,000 characters, so an export of about 10,000 entries (10.2 MB) could not be imported back. It is now 100,000,000 characters, which covers an export of about 50,000 entries (51.0 MB). Parsing alone took 92.8 to 99.3 ms at 50,000 entries (3 timed runs after a warm-up of 83.3 ms), and export plus parse took 140.6 ms (median). Saving that many entries into the browser's database was not measured.

**Comfortable range, by feature:**

- **List, search and export:** up to about 1,000 entries per project. At that size every browser median measured here is under about 0.35 s (one Clear run reached 610 ms), and Node search, scoring, context build and export take under 12 ms.
- **Auto-pick:** under 0.2 s up to 5,000 entries with the real tokenizer, which the app uses by default (33.9 ms at 1,000 and 182.7 ms at 5,000), and 1.9 s at 50,000.
- **At 5,000 entries and above:** typing and ticking stay responsive after #88, but expect visible slowness when the list updates (about 1.2 to 2.0 s per search update at 5,000 entries). Auto-pick stays fast.

## What this does not cover

- One machine (AMD Ryzen 9 5900X, Windows 11), up to 3 browser runs per size, and one run for the 50,000-entry browser number.
- Chrome only. Firefox, Safari and Edge were not measured.
- No phone and no low-end device.
- Cold start is not isolated. The harness seeds the database and then loads the app in the same browser session, so the load numbers are not first-visit or cold-cache measurements, and database reads are not separated from rendering.
- No multi-tab test.
- Synthetic text from a fixed word list. Real notes will differ, and token counts on real text were not measured.
- Auto-pick and export were not timed in the browser.
- After #88 only 5,000 entries were re-measured. 1,000, 10,000 and 50,000 entries were not.
- Memory use, battery use and clipboard copy in the browser were not measured.
- No concurrent users and no server load. Squirrow has no server, and none was measured.

## Known limits and next steps

- **Auto-pick:** fixed in [#79](https://github.com/thymeed/Squirrow/issues/79). It counts each entry once instead of rebuilding the context per candidate. The fallback estimate counter rounds up per piece, so it can leave out an entry that would fit exactly. Only the Auto-pick rows were re-measured after the fix; the other Node rows are from the first run (two full runs agreed within about 10%).
- **List:** #88 memoised the rows and deferred the list behind the search box, so typing and ticking stay responsive. The list is still not virtualized, and updating it takes about 1.2 to 2.0 s at 5,000 entries. Virtualization has not been done and is parked in #84.
- **Import limit:** raised from 10 MB to 100 MB in #85. A project of about 50,000 entries of this size can now be restored from its own JSON export. Import into IndexedDB at that size was not measured.
- This page records the baseline. The numbers above are what a follow-up change should be compared against.
