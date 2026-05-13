import type { LatencyHistogram } from "./types";

/**
 * Ring buffer of float samples + percentile computation. Bounded so a
 * long-running transport doesn't grow memory unbounded between metric
 * emissions. Samples are kept in insertion order; percentile reads
 * sort a copy.
 *
 * Default cap (4096) gives stable p50/p95/p99 estimates for typical
 * publish rates while keeping ~32KB of memory per histogram.
 */
const DEFAULT_CAP = 4096;

export class SampleHistogram {
  private samples: number[] = [];
  private readonly cap: number;
  private cursor = 0;

  constructor(cap: number = DEFAULT_CAP) {
    if (!Number.isInteger(cap) || cap < 1) {
      throw new Error(`SampleHistogram: cap must be a positive integer (got ${cap})`);
    }
    this.cap = cap;
  }

  observe(valueMs: number): void {
    if (!Number.isFinite(valueMs) || valueMs < 0) return;
    if (this.samples.length < this.cap) {
      this.samples.push(valueMs);
    } else {
      this.samples[this.cursor] = valueMs;
      this.cursor = (this.cursor + 1) % this.cap;
    }
  }

  reset(): void {
    this.samples = [];
    this.cursor = 0;
  }

  count(): number {
    return this.samples.length;
  }

  snapshot(): LatencyHistogram {
    const n = this.samples.length;
    if (n === 0) {
      return { count: 0, min: NaN, max: NaN, mean: NaN, p50: NaN, p95: NaN, p99: NaN };
    }
    const sorted = [...this.samples].sort((a, b) => a - b);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += sorted[i];
    const mean = sum / n;
    return {
      count: n,
      min: sorted[0],
      max: sorted[n - 1],
      mean,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
    };
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  // Nearest-rank, capped at last index. Stable, deterministic.
  const rank = Math.ceil(p * sorted.length) - 1;
  const idx = Math.max(0, Math.min(rank, sorted.length - 1));
  return sorted[idx];
}
