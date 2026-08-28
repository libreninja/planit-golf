export const SEATTLE_CUP_TIMING_METRICS = [
  'cache-read',
  'golf-genius',
  'normalization',
  'identity',
  'cache-write',
  'total',
] as const

export type SeattleCupTimingMetric = typeof SEATTLE_CUP_TIMING_METRICS[number]

export interface SeattleCupTimingSink {
  add(metric: SeattleCupTimingMetric, durationMs: number): void
}

export interface SeattleCupTimingCollector extends SeattleCupTimingSink {
  toHeaderValue(): string
}

export function createSeattleCupTimingCollector(): SeattleCupTimingCollector {
  // The live route reads four rounds concurrently for Race state. Stage values
  // intentionally accumulate work across those reads; `total` remains the
  // request wall clock, so parallel stage totals may exceed it.
  const durations = new Map<SeattleCupTimingMetric, number>(
    SEATTLE_CUP_TIMING_METRICS.map((metric) => [metric, 0]),
  )

  return {
    add(metric, durationMs) {
      if (!Number.isFinite(durationMs) || durationMs < 0) return
      durations.set(metric, (durations.get(metric) ?? 0) + durationMs)
    },
    toHeaderValue() {
      return SEATTLE_CUP_TIMING_METRICS
        .map((metric) => `${metric};dur=${(durations.get(metric) ?? 0).toFixed(1)}`)
        .join(', ')
    },
  }
}

export async function measureSeattleCupTiming<T>(
  timing: SeattleCupTimingSink | undefined,
  metric: SeattleCupTimingMetric,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now()
  try {
    return await operation()
  } finally {
    timing?.add(metric, performance.now() - startedAt)
  }
}

export function measureSeattleCupTimingSync<T>(
  timing: SeattleCupTimingSink | undefined,
  metric: SeattleCupTimingMetric,
  operation: () => T,
): T {
  const startedAt = performance.now()
  try {
    return operation()
  } finally {
    timing?.add(metric, performance.now() - startedAt)
  }
}

export function serverTimingHeaders(timing: SeattleCupTimingCollector): Record<string, string> {
  return { 'Server-Timing': timing.toHeaderValue() }
}
