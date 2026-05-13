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
      let best = eligible[0];
      for (let i = 1; i < eligible.length; i++) {
        if (eligible[i].load < best.load) best = eligible[i];
      }
      return { winner: best, reason: `lowest-load: ${best.load.toFixed(2)}` };
    }
    case "lowest-cost": {
      const withCost = eligible.filter(hasCost);
      if (withCost.length === 0) return null;
      let best: BidWithCost = withCost[0];
      for (let i = 1; i < withCost.length; i++) {
        if (withCost[i].cost < best.cost) best = withCost[i];
      }
      return { winner: best, reason: `lowest-cost: ${best.cost.toFixed(4)}` };
    }
    case "highest-match": {
      let best = eligible[0];
      for (let i = 1; i < eligible.length; i++) {
        if (eligible[i].capability_match > best.capability_match) best = eligible[i];
      }
      return { winner: best, reason: `highest-match: ${best.capability_match.toFixed(2)}` };
    }
  }
}
