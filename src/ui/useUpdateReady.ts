import { useEffect, useState } from 'react'

const defaultReload = () => location.reload()

/**
 * Returns a function that applies a waiting service worker update, or null when none is waiting.
 * Every open tab reloads when a new worker takes over, because the old page would be running
 * against caches the new worker has deleted.
 */
export function useUpdateReady(reload: () => void = defaultReload) {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)

  useEffect(() => {
    const sw = navigator.serviceWorker
    if (!sw) return
    let cancelled = false
    let registration: ServiceWorkerRegistration | undefined
    // A first install also fires controllerchange; only a replaced worker should reload the page.
    const hadController = !!sw.controller

    const track = (worker: ServiceWorker) => {
      if (worker.state === 'installed') setWaiting(worker)
      else
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && sw.controller) setWaiting(worker)
        })
    }
    const onUpdateFound = () => registration?.installing && track(registration.installing)
    const watch = (reg: ServiceWorkerRegistration) => {
      registration = reg
      if (sw.controller) {
        if (reg.waiting) track(reg.waiting)
        if (reg.installing) track(reg.installing)
      }
      reg.addEventListener('updatefound', onUpdateFound)
      void reg.update().catch(() => {})
    }
    void sw.ready.then((reg) => !cancelled && watch(reg))

    const onControllerChange = () => hadController && reload()
    sw.addEventListener('controllerchange', onControllerChange)
    const recheck = () => {
      if (document.visibilityState === 'visible') void registration?.update().catch(() => {})
    }
    document.addEventListener('visibilitychange', recheck)
    return () => {
      cancelled = true
      registration?.removeEventListener('updatefound', onUpdateFound)
      sw.removeEventListener('controllerchange', onControllerChange)
      document.removeEventListener('visibilitychange', recheck)
    }
  }, [reload])

  return waiting ? () => waiting.postMessage({ type: 'SKIP_WAITING' }) : null
}
