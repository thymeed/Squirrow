export function findUnprecached(input: {
  swSource: string
  files: Record<string, string | Uint8Array>
}): Promise<string[]>
