import type { MyelinEnvelope } from "../types";

const baseSovereignty = {
  classification: "local" as const,
  data_residency: "CH",
  max_hop: 0,
  frontier_ok: false,
  model_class: "any" as const,
};

export const broadcastTaskEnvelope: MyelinEnvelope = {
  id: "550e8400-e29b-41d4-a716-446655440001",
  source: "metafactory.cortex.dispatch",
  type: "tasks.code-review",
  timestamp: "2026-05-09T20:00:00Z",
  sovereignty: baseSovereignty,
  requirements: ["code-review", "typescript"],
  sovereignty_required: "selective",
  deadline: "2026-05-10T20:00:00Z",
  distribution_mode: "broadcast",
  payload: {
    pr_url: "https://github.com/the-metafactory/myelin/pull/44",
    base_sha: "cc9d814",
  },
};

export const directTaskEnvelope: MyelinEnvelope = {
  id: "550e8400-e29b-41d4-a716-446655440002",
  source: "metafactory.cortex.dispatch",
  type: "tasks.release",
  timestamp: "2026-05-09T20:00:00Z",
  sovereignty: baseSovereignty,
  requirements: ["release"],
  sovereignty_required: "strict",
  deadline: "2026-05-09T23:00:00Z",
  distribution_mode: "direct",
  target_assistant: "did:mf:forge",
  payload: {
    package: "@the-metafactory/myelin",
    version: "0.8.0",
  },
};

export const delegateTaskEnvelope: MyelinEnvelope = {
  id: "550e8400-e29b-41d4-a716-446655440003",
  source: "metafactory.cortex.dispatch",
  type: "tasks.pr-merge",
  timestamp: "2026-05-09T20:00:00Z",
  sovereignty: baseSovereignty,
  requirements: ["orchestration", "code-review", "release"],
  sovereignty_required: "strict",
  deadline: "2026-05-10T18:00:00Z",
  distribution_mode: "delegate",
  target_assistant: "did:mf:pilot",
  payload: {
    pr_url: "https://github.com/the-metafactory/myelin/pull/32",
    outcome: "merged",
    escalation_channel: "discord:metafactory-ops",
  },
};
