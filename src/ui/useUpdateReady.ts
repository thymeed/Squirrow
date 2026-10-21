import { useEffect, useState } from 'react'

/** True once a new service worker is installed and waiting; `apply` activates it and reloads. */
export function useUpdateReady() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)

  useEffect(() => {
    const sw = navigator.serviceWorker
    if (!sw) return
    let cancelled = false
    let registration: ServiceWorkerRegistration | undefined

    const watch = (reg: ServiceWorkerRegistration) => {
      registration = reg
      if (reg.waiting) setWaiting(reg.waiting)
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && sw.controller) setWaiting(worker)
        })
      })
      void reg.update().catch(() => {})
    }
    void sw.ready.then((reg) => !cancelled && watch(reg))

    const recheck = () => {
      if (document.visibilityState === 'visible') void registration?.update().catch(() => {})
    }
    document.addEventListener('visibilitychange', recheck)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', recheck)
    }
  }, [])

  const apply = () => {
    if (!waiting) return
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true })
    waiting.postMessage({ type: 'SKIP_WAITING' })
  }
  return waiting ? apply : null
}
