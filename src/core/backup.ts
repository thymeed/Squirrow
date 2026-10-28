/** Remind to back up when the last JSON export is older than this. */
export const BACKUP_REMINDER_DAYS = 14
/** A dismissed reminder stays hidden for this long. */
export const NUDGE_SNOOZE_DAYS = 7

export const LAST_EXPORT_KEY = 'squirrow.lastExportAt'
export const NUDGE_DISMISSED_KEY = 'squirrow.nudgeDismissedUntil'

const DAY_MS = 24 * 60 * 60 * 1000

export interface NudgeState {
  now: number
  entryCount: number
  lastExportAt: number | null
  dismissedUntil: number | null
}

/** True when the backup reminder should show: there is data, it is not snoozed, and no export in 14 days. */
export function shouldShowBackupNudge({
  now,
  entryCount,
  lastExportAt,
  dismissedUntil,
}: NudgeState): boolean {
  if (entryCount <= 0) return false
  if (dismissedUntil !== null && now <= dismissedUntil) return false
  return lastExportAt === null || now - lastExportAt > BACKUP_REMINDER_DAYS * DAY_MS
}

export const dismissedUntilFrom = (now: number): number => now + NUDGE_SNOOZE_DAYS * DAY_MS

type TimeStore = Pick<Storage, 'getItem' | 'setItem'>

/** Reads a stored timestamp. Missing, unreadable or garbage values come back as null. */
export function readStoredTime(key: string, storage?: TimeStore): number | null {
  try {
    const raw = (storage ?? window.localStorage).getItem(key)
    if (raw === null) return null
    const value = Number(raw)
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

/** Saves a timestamp. A blocked or full localStorage is ignored, so the reminder may just show again. */
export function writeStoredTime(key: string, value: number, storage?: TimeStore): void {
  try {
    const target = storage ?? window.localStorage
    target.setItem(key, String(value))
  } catch {
    // Storage is blocked or full. The app keeps working without remembering this.
  }
}
