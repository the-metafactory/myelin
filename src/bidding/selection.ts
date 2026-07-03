import type { BidResponse, SelectionStrategy } from "./types";

export interface SelectionOutcome {
  winner: BidResponse;
  reason: string;
}

type BidWithCost = BidResponse & { cost: number };
function hasCost(b: BidResponse): b is BidWithCost {
  return typeof b.cost === "number";
}

export function selectWinner(
  bids: BidResponse[],
  strategy: SelectionStrategy,
  excluded: ReadonlySet<string> = new Set(),
): SelectionOutcome | null {
  const eligible = bids.filter((b) => !excluded.has(b.bidder));
  if (eligible.length === 0) return null;

  switch (strategy) {
    case "lowest-load": {
      // eligible is non-empty (checked above), so reduce without an
      // initial value returns a defined BidResponse. Strict `<` keeps
      // the earliest bid on ties, matching the prior indexed loop.
      const best = eligible.reduce((a, b) => (b.load < a.load ? b : a));
      return { winner: best, reason: `lowest-load: ${best.load.toFixed(2)}` };
    }
    case "lowest-cost": {
      const withCost = eligible.filter(hasCost);
      if (withCost.length === 0) return null;
      // withCost is non-empty (checked above); reduce returns a defined BidWithCost.
      const best = withCost.reduce((a, b) => (b.cost < a.cost ? b : a));
      return { winner: best, reason: `lowest-cost: ${best.cost.toFixed(4)}` };
    }
    case "highest-match": {
      // eligible is non-empty (checked above); reduce returns a defined BidResponse.
      const best = eligible.reduce((a, b) => (b.capability_match > a.capability_match ? b : a));
      return { winner: best, reason: `highest-match: ${best.capability_match.toFixed(2)}` };
    }
  }
}
