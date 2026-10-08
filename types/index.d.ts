export type Window = { kind: string; percentUsed: number; resetsAt?: string }
export type Limits = Window[]

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { limits: Limits; now: number }
  }
}
