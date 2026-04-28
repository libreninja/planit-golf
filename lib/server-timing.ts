type TimingEntry = {
  name: string
  durationMs: number
  description?: string
}

export class RequestTimer {
  private readonly startedAt = performance.now()
  private readonly entries: TimingEntry[] = []

  async measure<T>(name: string, run: () => PromiseLike<T>, description?: string): Promise<T> {
    const start = performance.now()
    try {
      return await run()
    } finally {
      this.entries.push({
        name,
        durationMs: performance.now() - start,
        description,
      })
    }
  }

  finishTotal(name = 'total', description = 'total request time') {
    this.entries.push({
      name,
      durationMs: performance.now() - this.startedAt,
      description,
    })
  }

  toHeader() {
    return this.entries
      .map((entry) => {
        const base = `${entry.name};dur=${entry.durationMs.toFixed(1)}`
        return entry.description ? `${base};desc="${entry.description}"` : base
      })
      .join(', ')
  }

  toJSON() {
    return this.entries.map((entry) => ({
      ...entry,
      durationMs: Number(entry.durationMs.toFixed(1)),
    }))
  }
}
