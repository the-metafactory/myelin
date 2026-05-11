/**
 * F-5 T-7.2 — sovereignty engine performance bench.
 *
 * Runs `N` mixed validations (default 10000, ~70% allow, ~30% block)
 * against the canonical `testPolicy` and prints p50/p95/p99/max
 * latency. Exits non-zero if p99 ≥ the configured budget so this
 * harness doubles as a regression guard.
 *
 * Run:
 *   bun run bench
 *   bun bench/sovereignty.bench.ts
 *   bun bench/sovereignty.bench.ts --iterations 50000 --budget-us 500
 *
 * Flags:
 *   --iterations <N>      total validations (default 10000)
 *   --warmup <N>          warm-up validations not measured (default 1000)
 *   --budget-us <µs>      p99 budget in microseconds (default 1000 = 1ms)
 *   --quiet               suppress per-bucket breakdown
 *
 * This file is bench tooling — not imported by `src/` and not part of
 * the package barrel. The runtime path under measurement is the same
 * `createSovereigntyEngine` + `validateEgress` / `validateIngress`
 * that ships in production.
 */
import { createSovereigntyEngine } from "../src/sovereignty/engine";
import { createInMemoryPolicyStore } from "../src/sovereignty/policy-store";
import { testPolicy } from "../src/sovereignty/test-fixtures";
import { clearSubjectPatternCache } from "../src/subject-matching";
import type { MyelinEnvelope } from "../src/types";
import type { SignedBy } from "../src/identity/types";

interface CliOptions {
  iterations: number;
  warmup: number;
  budgetUs: number;
  quiet: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    iterations: 10000,
    warmup: 1000,
    budgetUs: 1000,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--iterations" && argv[i + 1]) {
      opts.iterations = Number(argv[++i]);
    } else if (arg === "--warmup" && argv[i + 1]) {
      opts.warmup = Number(argv[++i]);
    } else if (arg === "--budget-us" && argv[i + 1]) {
      opts.budgetUs = Number(argv[++i]);
    } else if (arg === "--quiet") {
      opts.quiet = true;
    }
  }
  return opts;
}

/**
 * Tiny linear-congruential generator. We only need a deterministic
 * bucket pick per iteration; cryptographic randomness is irrelevant
 * here and a dependency-free LCG keeps the bench reproducible across
 * runs without adding any package.
 */
function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // Numerical Recipes parameters; period 2^32.
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function fakeSig(): SignedBy {
  return {
    method: "ed25519",
    principal: "did:mf:echo",
    signature: "x".repeat(86),
    at: "2026-05-10T00:00:00Z",
  };
}

function unknownSig(): SignedBy {
  return { ...fakeSig(), principal: "did:mf:rogue" };
}

function baseEnvelope(
  classification: "local" | "federated" | "public",
  residency: string,
): MyelinEnvelope {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    source: "metafactory.echo.local",
    type: "tasks.code-review",
    timestamp: "2026-05-10T00:00:00Z",
    sovereignty: {
      classification,
      data_residency: residency,
      max_hop: 0,
      frontier_ok: false,
      model_class: "any",
    },
    payload: {},
  };
}

/**
 * Bucket = one closure invoking the engine. The mix below covers all
 * six block paths plus three allow paths. Bucket frequencies sum to
 * 100 and target ~70% allow / ~30% block.
 *
 *   weight | bucket
 *   -------|--------------------------------------------------------
 *      40  | egress allow — local → local.metafactory.tasks.>
 *      20  | egress allow — federated → federated.metafactory.> (residency-free)
 *      10  | ingress allow — known principal, in-scope, no requirements
 *      ----| 70% allow
 *       6  | egress block — block_local_escape fast-path
 *       5  | egress block — subject not in allowed_subjects
 *       5  | egress block — residency-violation
 *       5  | ingress block — unsigned envelope (unknown-principal)
 *       4  | ingress block — known principal, subject outside local_scope
 *       3  | ingress block — known principal, requirement exceeds max_capabilities
 *       2  | ingress block — signed but no scope mapping AND reject_unknown_partners
 *   -------|--------------------------------------------------------
 *           30% block
 */
interface Bucket {
  name: string;
  weight: number;
  run: () => void;
}

function buildBuckets(engine: ReturnType<typeof createSovereigntyEngine>): Bucket[] {
  // Pre-built envelopes — the bench measures the engine, not envelope
  // construction. Each bucket reuses its envelope so allocation is
  // hoisted out of the hot path.
  const allowLocal = baseEnvelope("local", "CH");
  const allowFederated = baseEnvelope("federated", "DE");
  const allowIngress: MyelinEnvelope = { ...baseEnvelope("federated", "CH"), signed_by: fakeSig() };

  const blockLocalEscape = baseEnvelope("local", "CH");
  const blockNotInAllowed: MyelinEnvelope = baseEnvelope("federated", "DE");
  const blockResidency = baseEnvelope("federated", "CH");
  const blockUnsigned = baseEnvelope("federated", "CH");
  const blockSubjectOutOfScope: MyelinEnvelope = { ...baseEnvelope("federated", "CH"), signed_by: fakeSig() };
  const blockReqExceedsScope: MyelinEnvelope = {
    ...baseEnvelope("federated", "CH"),
    signed_by: fakeSig(),
    requirements: ["forbidden-capability"],
  };
  const blockUnknownPartner: MyelinEnvelope = { ...baseEnvelope("federated", "CH"), signed_by: unknownSig() };

  return [
    {
      name: "egress.allow.local",
      weight: 40,
      run: () => {
        engine.validateEgress(allowLocal, "local.metafactory.tasks.review");
      },
    },
    {
      name: "egress.allow.federated",
      weight: 20,
      run: () => {
        engine.validateEgress(allowFederated, "federated.metafactory.tasks.review");
      },
    },
    {
      name: "ingress.allow",
      weight: 10,
      run: () => {
        engine.validateIngress(allowIngress, "federated.operator-b.tasks.review");
      },
    },
    {
      name: "egress.block.local_escape",
      weight: 6,
      run: () => {
        engine.validateEgress(blockLocalEscape, "federated.metafactory.tasks");
      },
    },
    {
      name: "egress.block.not_in_allowed",
      weight: 5,
      run: () => {
        // federated env to a federated subject that isn't in the rule.
        engine.validateEgress(blockNotInAllowed, "federated.foreign-org.tasks");
      },
    },
    {
      name: "egress.block.residency",
      weight: 5,
      // testPolicy's federated rule has no data_residency_constraints, so
      // we use a different shape: a federated envelope with a residency
      // not covered by the rule's allowed_subjects but classification ok.
      // testPolicy currently has no residency constraints; this bucket
      // surfaces the "subject not allowed for classification" path
      // instead, mapping to the same `classification-mismatch` code.
      // Engine path is still exercised end-to-end.
      run: () => {
        engine.validateEgress(blockResidency, "federated.unmapped-partner.x");
      },
    },
    {
      name: "ingress.block.unsigned",
      weight: 5,
      run: () => {
        engine.validateIngress(blockUnsigned, "federated.operator-b.tasks");
      },
    },
    {
      name: "ingress.block.subject_out_of_scope",
      weight: 4,
      run: () => {
        engine.validateIngress(blockSubjectOutOfScope, "federated.operator-b.other.path");
      },
    },
    {
      name: "ingress.block.requirement_exceeds_scope",
      weight: 3,
      run: () => {
        engine.validateIngress(blockReqExceedsScope, "federated.operator-b.tasks.review");
      },
    },
    {
      name: "ingress.block.unknown_partner",
      weight: 2,
      run: () => {
        engine.validateIngress(blockUnknownPartner, "federated.operator-b.tasks");
      },
    },
  ];
}

function buildSchedule(buckets: Bucket[], total: number, rng: () => number): Uint8Array {
  // Pre-pick the bucket for every iteration so the hot loop only does
  // the engine call + the timing call, never a Math.random dispatch.
  const totalWeight = buckets.reduce((s, b) => s + b.weight, 0);
  const cumulative: number[] = [];
  let running = 0;
  for (const b of buckets) {
    running += b.weight;
    cumulative.push(running);
  }
  const schedule = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const pick = rng() * totalWeight;
    let bucketIdx = 0;
    for (; bucketIdx < cumulative.length; bucketIdx++) {
      if (pick < cumulative[bucketIdx]!) break;
    }
    schedule[i] = bucketIdx;
  }
  return schedule;
}

function percentile(sorted: Float64Array, p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

function microseconds(ms: number): number {
  return ms * 1000;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  // Engine wiring — identical to production except using the in-memory
  // store (the bench measures the validator hot path, not KV IO).
  clearSubjectPatternCache();
  const policyStore = createInMemoryPolicyStore({ initial: testPolicy });
  const engine = createSovereigntyEngine({ policyStore });

  const buckets = buildBuckets(engine);
  const rng = makeLcg(0xc0ffee);
  const total = opts.warmup + opts.iterations;
  const schedule = buildSchedule(buckets, total, rng);

  // Warm-up — populate the subject-pattern cache and let the JIT
  // settle. Not measured.
  for (let i = 0; i < opts.warmup; i++) {
    buckets[schedule[i]!]!.run();
  }

  // Measured loop. Per-iteration timing via `performance.now()`
  // which Bun resolves at sub-microsecond precision.
  const samples = new Float64Array(opts.iterations);
  const counts = new Uint32Array(buckets.length);
  for (let i = 0; i < opts.iterations; i++) {
    const idx = schedule[opts.warmup + i]!;
    const bucket = buckets[idx]!;
    const start = performance.now();
    bucket.run();
    const end = performance.now();
    samples[i] = end - start;
    counts[idx] = (counts[idx]! + 1) >>> 0;
  }

  const sorted = samples.slice().sort();
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const max = sorted[sorted.length - 1] ?? 0;
  const mean = samples.reduce((s, x) => s + x, 0) / samples.length;

  process.stdout.write(`\nF-5 sovereignty engine bench (T-7.2)\n`);
  process.stdout.write(`iterations: ${opts.iterations} (warm-up ${opts.warmup})\n`);
  process.stdout.write(`p50: ${microseconds(p50).toFixed(2)} µs\n`);
  process.stdout.write(`p95: ${microseconds(p95).toFixed(2)} µs\n`);
  process.stdout.write(`p99: ${microseconds(p99).toFixed(2)} µs\n`);
  process.stdout.write(`max: ${microseconds(max).toFixed(2)} µs\n`);
  process.stdout.write(`mean: ${microseconds(mean).toFixed(2)} µs\n`);

  if (!opts.quiet) {
    process.stdout.write(`\nbucket counts:\n`);
    for (let i = 0; i < buckets.length; i++) {
      const pct = ((counts[i]! / opts.iterations) * 100).toFixed(1);
      process.stdout.write(`  ${buckets[i]!.name.padEnd(40)} ${counts[i]!.toString().padStart(6)} (${pct}%)\n`);
    }
  }

  const p99Us = microseconds(p99);
  const verdict = p99Us < opts.budgetUs ? "PASS" : "FAIL";
  process.stdout.write(`\nbudget: p99 < ${opts.budgetUs} µs — ${verdict}\n`);
  if (verdict === "FAIL") {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
