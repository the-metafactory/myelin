import { describe, it, expect } from "bun:test";
import {
  deriveBidRequestSubject,
  deriveAssignmentSubject,
  deriveBidLifecycleSubject,
} from "./subjects";

describe("deriveBidRequestSubject", () => {
  it("builds local.{org}.tasks.bid-request.{capability}", () => {
    expect(deriveBidRequestSubject("metafactory", "code-review")).toBe(
      "local.metafactory.tasks.bid-request.code-review",
    );
  });

  it("rejects bad org", () => {
    expect(() => deriveBidRequestSubject("Meta_Factory", "code-review")).toThrow(/invalid org/);
  });

  it("rejects bad capability", () => {
    expect(() => deriveBidRequestSubject("metafactory", "Code_Review")).toThrow(/invalid capability/);
  });
});

describe("deriveAssignmentSubject", () => {
  it("encodes principal DID into subject token", () => {
    expect(deriveAssignmentSubject("metafactory", "did:mf:luna", "code-review")).toBe(
      "local.metafactory.tasks.@did-mf-luna.code-review",
    );
  });

  it("encodes dotted suffix with double-hyphen", () => {
    expect(deriveAssignmentSubject("metafactory", "did:mf:hub.metafactory", "code-review")).toBe(
      "local.metafactory.tasks.@did-mf-hub--metafactory.code-review",
    );
  });

  it("rejects invalid principal DID", () => {
    expect(() => deriveAssignmentSubject("metafactory", "not-a-did", "code-review")).toThrow(
      /invalid principal DID/,
    );
  });
});

describe("deriveBidLifecycleSubject", () => {
  it("produces dispatch.bid.{event} (separate namespace from dispatch.task.>)", () => {
    expect(deriveBidLifecycleSubject("metafactory", "bid-opened")).toBe("local.metafactory.dispatch.bid.bid-opened");
    expect(deriveBidLifecycleSubject("metafactory", "bid-assigned")).toBe("local.metafactory.dispatch.bid.bid-assigned");
  });

  it("does not collide with F-020 dispatch.task.assigned namespace", () => {
    const bidSubject = deriveBidLifecycleSubject("metafactory", "bid-assigned");
    expect(bidSubject).not.toBe("local.metafactory.dispatch.task.assigned");
    expect(bidSubject.startsWith("local.metafactory.dispatch.bid.")).toBe(true);
  });

  it("rejects bad org", () => {
    expect(() => deriveBidLifecycleSubject("BAD", "bid-assigned")).toThrow(/invalid org/);
  });
});
