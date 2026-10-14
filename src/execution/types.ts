import type { RunKind, RunOutcome } from "../subject-vocabulary";

export interface ExecutionRunReference {
  kind: RunKind;
  ref: string;
}

export interface ExecutionRunServes {
  /** Goal ID only; goal wording stays in soma-home. */
  goal?: string;
  node?: string;
}

export interface ExecutionRunState {
  subject: string;
  value: string;
}

/** Closed run-ledger contract: IDs, enum values and timestamps, no free text. */
export interface ExecutionRunFinishedPayload {
  run_id: string;
  producer: string;
  ran: ExecutionRunReference;
  outcome: RunOutcome;
  started_at: string;
  ended_at: string;
  serves?: ExecutionRunServes;
  state?: ExecutionRunState;
  /** Non-empty producer correlation ID; need not be a UUID. */
  correlation_id: string;
  /** Pointer into the producer's own log. */
  detail_ref?: string;
  /** Optional readable result: soma:relative/path, only when outcome is succeeded. */
  result_ref?: string;
  /** Optional proposals for the principal to answer: unique soma: refs, only when outcome is succeeded. */
  proposal_refs?: string[];
}

/** Producers may omit correlation_id to have the builder generate a UUID. */
export type ExecutionRunFinishedPayloadInput = Omit<ExecutionRunFinishedPayload, "correlation_id"> & {
  correlation_id?: string;
};
