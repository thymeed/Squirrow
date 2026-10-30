// Browser harness for the Chrome numbers in docs/SCALABILITY.md. Manual measurement aid, not part of the app.
// Serve a build on 127.0.0.1: `npm run build`, then `npx vite preview --host 127.0.0.1`.
// In a throwaway profile, open the app at / once so it creates its database. Then open /robots.txt (it does not load the app) and paste this file into the console.
// If seed throws, run indexedDB.deleteDatabase('squirrow') and open the app again in the same tab (or close this tab first: a failed seed leaves a connection open that blocks the delete elsewhere).
// Run `runAll([[100,3],[1000,3]])` and read `results`. Runs over ~45 s per call: start without awaiting, poll `status`/`results`.
// It seeds the app's own IndexedDB 'squirrow' on that origin: use a throwaway profile or run indexedDB.deleteDatabase('squirrow') after.
// Load = iframe creation until all N rows are in the DOM. Search steps = one search update each (whole box text set in one input event) until two animation frames later (up to ~33 ms at 60 Hz).
window.seed = async (n) => {
  let s = 12345
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296
  const words =
    'cache index token budget project render list entry search context model prompt decision fact snippet note file store sync merge branch deploy build test review agent memory queue worker vector schema parse export import dialog filter score rank'.split(
      ' ',
    )
  const phrase = (min, max) => {
    const k = min + Math.floor(rnd() * (max - min + 1))
    return Array.from({ length: k }, () => words[Math.floor(rnd() * words.length)]).join(' ')
  }
  const kinds = ['fact', 'decision', 'preference', 'snippet', 'file-note']
  const pid = 'bench-project'
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('squirrow', 2)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  const tx = db.transaction(['projects', 'entries'], 'readwrite')
  tx.objectStore('entries').clear()
  tx.objectStore('projects').clear()
  tx.objectStore('projects').put({ id: pid, name: 'Bench ' + n, createdAt: Date.now() })
  for (let i = 0; i < n; i++)
    tx.objectStore('entries').put({
      id: 'e' + String(i).padStart(7, '0'),
      projectId: pid,
      kind: kinds[i % 5],
      title: phrase(5, 10),
      body: phrase(20, 200),
      updatedAt: 1700000000000 + i,
    })
  await new Promise((res, rej) => {
    tx.oncomplete = res
    tx.onerror = () => rej(tx.error)
  })
  db.close()
  return n
}
window.measure = async (n, capMs = 180000) => {
  const out = { n }
  const f = document.createElement('iframe')
  f.style.cssText = 'position:fixed;left:0;top:0;width:1200px;height:800px;border:0;opacity:0'
  const t0 = performance.now()
  f.src = '/?r=' + Math.random()
  document.body.appendChild(f)
  await new Promise((res) => {
    const iv = setInterval(() => {
      const d = f.contentDocument
      const c = d ? d.querySelectorAll('ul.entries > li').length : 0
      if (c >= n) {
        clearInterval(iv)
        out.load = Math.round(performance.now() - t0)
        res()
      } else if (performance.now() - t0 > capMs) {
        clearInterval(iv)
        out.load = '>' + capMs
        res()
      }
    }, 5)
  })
  const d = f.contentDocument,
    w = f.contentWindow
  const raf = () => new Promise((r) => w.requestAnimationFrame(() => w.requestAnimationFrame(r)))
  await raf()
  const input = d.querySelector('.bar input')
  if (input) {
    const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set
    const type = async (txt) => {
      const t = performance.now()
      setter.call(input, txt)
      input.dispatchEvent(new w.Event('input', { bubbles: true }))
      await raf()
      return Math.round(performance.now() - t)
    }
    out.t1 = await type('cache')
    out.t2 = await type('cache index')
    out.t3 = await type('cache index token')
    out.clear = await type('')
  }
  out.dom = d.getElementsByTagName('*').length
  f.remove()
  return out
}
window.results = []
window.status = 'idle'
window.runAll = async (plan) => {
  window.status = 'running'
  for (const [n, runs] of plan) {
    window.status = 'seeding ' + n
    await window.seed(n)
    for (let i = 0; i < runs; i++) {
      window.status = 'measuring ' + n + ' run ' + (i + 1)
      window.results.push(await window.measure(n))
    }
  }
  window.status = 'done'
}
