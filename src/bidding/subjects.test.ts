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
  it("produces dispatch.task.{event}", () => {
    expect(deriveBidLifecycleSubject("metafactory", "bid-opened")).toBe("local.metafactory.dispatch.task.bid-opened");
    expect(deriveBidLifecycleSubject("metafactory", "assigned")).toBe("local.metafactory.dispatch.task.assigned");
  });

  it("rejects bad org", () => {
    expect(() => deriveBidLifecycleSubject("BAD", "assigned")).toThrow(/invalid org/);
  });
});
