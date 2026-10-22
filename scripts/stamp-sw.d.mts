export function stampServiceWorker(source: string, version: string): string
export function hashableWorker(source: string): string
export function versionOf(files: { path: string; bytes: Uint8Array }[]): string
export function stampSwPlugin(): import('vite').Plugin
