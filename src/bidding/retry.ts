import type { BidResponse, SelectionStrategy } from "./types";
import { MAX_WINNER_RETRIES } from "./types";
import { selectWinner, type SelectionOutcome } from "./selection";

export interface RetryContextOptions {
  bids: BidResponse[];
  strategy: SelectionStrategy;
  maxRetries?: number;
}

export class RetryContext {
  private readonly bids: BidResponse[];
  private readonly strategy: SelectionStrategy;
  private readonly maxRetries: number;
  private readonly excluded = new Set<string>();
  private attempts = 0;

  constructor(options: RetryContextOptions) {
    this.bids = options.bids;
    this.strategy = options.strategy;
    this.maxRetries = options.maxRetries ?? MAX_WINNER_RETRIES;
  }

  selectInitial(): SelectionOutcome | null {
    return selectWinner(this.bids, this.strategy, this.excluded);
  }

  retryAfterNak(loserPrincipal: string): SelectionOutcome | null {
    if (this.attempts >= this.maxRetries) return null;
    this.excluded.add(loserPrincipal);
    this.attempts += 1;
    return selectWinner(this.bids, this.strategy, this.excluded);
  }

  attemptCount(): number {
    return this.attempts;
  }

  excludedPrincipals(): string[] {
    return Array.from(this.excluded);
  }
}
