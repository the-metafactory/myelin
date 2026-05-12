import { describe, it, expect } from "bun:test";
import { createInMemoryWorkflowExecutionStore } from "./memory-execution-store";
import type { WorkflowExecutionEvent } from "./execution-store";
import type { WorkflowExecution } from "./types";

function exec(id: string, status: WorkflowExecution["status"] = "running"): WorkflowExecution {
  return {
    execution_id: id,
    workflow_id: "wf-test",
    workflow_version: "1.0.0",
    correlation_id: `corr-${id}`,
    status,
    current_steps: ["a"],
    completed_steps: {},
    pending_fan_in: {},
    input: { test: true },
    started_at: "2026-05-11T00:00:00Z",
    last_checkpoint_at: "2026-05-11T00:00:00Z",
    retry_count: 0,
  };
}

describe("createInMemoryWorkflowExecutionStore", () => {
  describe("put / get", () => {
    it("round-trips an execution", async () => {
      const store = createInMemoryWorkflowExecutionStore();
      const e = exec("alpha");
      await store.put(e);
      const got = await store.get("alpha");
      expect(got).toEqual(e);
      await store.close();
    });

    it("returns null for an unknown execution_id", async () => {
      const store = createInMemoryWorkflowExecutionStore();
      expect(await store.get("ghost")).toBeNull();
      await store.close();
    });

    it("upserts on repeated put", async () => {
      const store = createInMemoryWorkflowExecutionStore();
      await store.put(exec("alpha", "running"));
      await store.put(exec("alpha", "completed"));
      const got = await store.get("alpha");
      expect(got?.status).toBe("completed");
      await store.close();
    });

    it("clones on put — caller mutation does not corrupt store", async () => {
      const store = createInMemoryWorkflowExecutionStore();
      const e = exec("alpha");
      await store.put(e);
      e.status = "failed";
      e.current_steps.push("mutated");
      const got = await store.get("alpha");
      expect(got?.status).toBe("running");
      expect(got?.current_steps).toEqual(["a"]);
      await store.close();
    });

    it("clones on get — returned mutation does not bleed back", async () => {
      const store = createInMemoryWorkflowExecutionStore();
      await store.put(exec("alpha"));
      const first = await store.get("alpha");
      first!.status = "failed";
      first!.current_steps.push("mutated");
      const second = await store.get("alpha");
      expect(second?.status).toBe("running");
      expect(second?.current_steps).toEqual(["a"]);
      await store.close();
    });
  });

  describe("listRunning", () => {
    it("returns only executions with status running", async () => {
      const store = createInMemoryWorkflowExecutionStore();
      await store.put(exec("a", "running"));
      await store.put(exec("b", "completed"));
      await store.put(exec("c", "running"));
      await store.put(exec("d", "failed"));
      const running = await store.listRunning();
      const ids = running.map((e) => e.execution_id).sort();
      expect(ids).toEqual(["a", "c"]);
      await store.close();
    });

    it("returns clones — mutating the result does not affect the store", async () => {
      const store = createInMemoryWorkflowExecutionStore();
      await store.put(exec("a"));
      const running = await store.listRunning();
      running[0]!.status = "failed";
      const re = await store.listRunning();
      expect(re[0]!.status).toBe("running");
      await store.close();
    });

    it("returns empty array when no running executions", async () => {
      const store = createInMemoryWorkflowExecutionStore();
      await store.put(exec("a", "completed"));
      expect(await store.listRunning()).toEqual([]);
      await store.close();
    });
  });

  describe("delete", () => {
    it("removes a known execution", async () => {
      const store = createInMemoryWorkflowExecutionStore();
      await store.put(exec("a"));
      await store.delete("a");
      expect(await store.get("a")).toBeNull();
      await store.close();
    });

    it("is a no-op on unknown id", async () => {
      const store = createInMemoryWorkflowExecutionStore();
      await store.delete("ghost");
      await store.close();
    });
  });

  describe("initial seed", () => {
    it("pre-populates from the initial array", async () => {
      const store = createInMemoryWorkflowExecutionStore({
        initial: [exec("a"), exec("b", "completed")],
      });
      expect(await store.get("a")).not.toBeNull();
      expect(await store.get("b")).not.toBeNull();
      expect((await store.listRunning()).map((e) => e.execution_id)).toEqual(["a"]);
      await store.close();
    });

    it("clones the initial array — caller mutation does not corrupt store", async () => {
      const e = exec("a");
      const store = createInMemoryWorkflowExecutionStore({ initial: [e] });
      e.status = "failed";
      const got = await store.get("a");
      expect(got?.status).toBe("running");
      await store.close();
    });
  });

  describe("snapshot", () => {
    it("returns every stored execution as clones", async () => {
      const store = createInMemoryWorkflowExecutionStore();
      await store.put(exec("a"));
      await store.put(exec("b", "completed"));
      const snap = store.snapshot();
      expect(snap.map((e) => e.execution_id).sort()).toEqual(["a", "b"]);
      snap[0]!.status = "failed";
      expect((await store.get(snap[0]!.execution_id))?.status).toBe("running");
      await store.close();
    });
  });

  describe("watch", () => {
    it("emits a put event after a write", async () => {
      const store = createInMemoryWorkflowExecutionStore();
      const events: WorkflowExecutionEvent[] = [];
      const watcher = store.watch();
      const iter = (async () => {
        for await (const event of watcher) {
          events.push(event);
          if (events.length === 1) break;
        }
      })();
      await store.put(exec("a"));
      await iter;
      expect(events.length).toBe(1);
      expect(events[0]!.operation).toBe("put");
      expect(events[0]!.execution.execution_id).toBe("a");
      await store.close();
    });

    it("emits a delete event with the executed snapshot", async () => {
      const store = createInMemoryWorkflowExecutionStore();
      await store.put(exec("a"));
      const events: WorkflowExecutionEvent[] = [];
      const watcher = store.watch();
      const iter = (async () => {
        for await (const event of watcher) {
          events.push(event);
          if (events.length === 1) break;
        }
      })();
      await store.delete("a");
      await iter;
      expect(events[0]!.operation).toBe("delete");
      expect(events[0]!.execution.execution_id).toBe("a");
    });

    it("watcher only sees events after its start (pre-watch puts do not replay)", async () => {
      const store = createInMemoryWorkflowExecutionStore();
      await store.put(exec("a"));
      await store.put(exec("b"));
      await store.put(exec("c"));
      const watcher = store.watch();
      const iter = watcher[Symbol.asyncIterator]();
      // Watcher only fires for events AFTER it was created.
      await store.put(exec("d"));
      const first = await iter.next();
      expect(first.value!.execution.execution_id).toBe("d");
      await iter.return!();
      await store.close();
    });

    it("buffers events queued before next() drains them in FIFO order", async () => {
      const store = createInMemoryWorkflowExecutionStore();
      const watcher = store.watch();
      const iter = watcher[Symbol.asyncIterator]();
      // Two puts arrive before any next() — they should buffer and
      // drain in arrival order on subsequent next() calls.
      await store.put(exec("a"));
      await store.put(exec("b"));
      const first = await iter.next();
      const second = await iter.next();
      expect(first.value!.execution.execution_id).toBe("a");
      expect(second.value!.execution.execution_id).toBe("b");
      await iter.return!();
      await store.close();
    });

    it("each event carries a monotonically-increasing revision", async () => {
      const store = createInMemoryWorkflowExecutionStore();
      const watcher = store.watch();
      const iter = watcher[Symbol.asyncIterator]();
      await store.put(exec("a"));
      await store.put(exec("b"));
      const first = await iter.next();
      const second = await iter.next();
      expect(first.value!.revision).toBeGreaterThan(0);
      expect(second.value!.revision).toBeGreaterThan(first.value!.revision);
      await iter.return!();
      await store.close();
    });

    it("watch({ startRevision }) suppresses events below the cursor", async () => {
      const store = createInMemoryWorkflowExecutionStore();
      // Bump the counter, capture, then open watcher with cursor
      // past the next two puts.
      await store.put(exec("ignored-1"));
      const cursor = store.currentRevision();
      const future = store.watch({ startRevision: cursor + 3 });
      const iter = future[Symbol.asyncIterator]();
      await store.put(exec("below-1")); // revision cursor+1 — suppressed
      await store.put(exec("below-2")); // revision cursor+2 — suppressed
      await store.put(exec("seen-1")); // revision cursor+3 — emitted
      const first = await iter.next();
      expect(first.value!.execution.execution_id).toBe("seen-1");
      await iter.return!();
      await store.close();
    });

    it("clones events per watcher — one watcher mutating its event does not bleed into a sibling", async () => {
      const store = createInMemoryWorkflowExecutionStore();
      let a: WorkflowExecutionEvent | undefined;
      let b: WorkflowExecutionEvent | undefined;
      const wa = (async () => {
        for await (const event of store.watch()) {
          a = event;
          break;
        }
      })();
      const wb = (async () => {
        for await (const event of store.watch()) {
          b = event;
          break;
        }
      })();
      await store.put(exec("shared"));
      await wa;
      await wb;
      // Mutate a — b must remain pristine.
      a!.execution.status = "failed";
      a!.execution.current_steps.push("mutated");
      expect(b!.execution.status).toBe("running");
      expect(b!.execution.current_steps).toEqual(["a"]);
      await store.close();
    });

    it("iterator.return() drops queued events (consumer break semantics)", async () => {
      const store = createInMemoryWorkflowExecutionStore();
      const watcher = store.watch();
      const iter = watcher[Symbol.asyncIterator]();
      await store.put(exec("a"));
      await store.put(exec("b"));
      // Consume one, break early via return().
      const first = await iter.next();
      expect(first.value!.execution.execution_id).toBe("a");
      const closing = await iter.return!();
      expect(closing.done).toBe(true);
      // After return(), the watcher is detached; subsequent puts do
      // not buffer (they have nowhere to go). The dropped 'b' event
      // is by design — consumer signalled it does not want more.
      await store.put(exec("c"));
      const after = await iter.next();
      expect(after.done).toBe(true);
      await store.close();
    });

    it("drops oldest queued event when maxQueueSize is exceeded", async () => {
      const store = createInMemoryWorkflowExecutionStore({ maxQueueSize: 2 });
      const watcher = store.watch();
      const iter = watcher[Symbol.asyncIterator]();
      await store.put(exec("a"));
      await store.put(exec("b"));
      await store.put(exec("c")); // overflow — 'a' is dropped
      const first = await iter.next();
      const second = await iter.next();
      expect(first.value!.execution.execution_id).toBe("b");
      expect(second.value!.execution.execution_id).toBe("c");
      // Revision gap is observable: revisions skip from event 1 (would
      // have been 'a' at rev 1) to event 2 = 'b' at rev 2 — but the
      // consumer only sees rev 2 and rev 3, missing rev 1 entirely.
      // Per the watch() consumer contract, this is the gap a
      // revision-aware consumer detects.
      expect(second.value!.revision - first.value!.revision).toBe(1);
      expect(first.value!.revision).toBeGreaterThan(1);
      await iter.return!();
      await store.close();
    });

    it("concurrent next() calls on the same iterator drain in FIFO order (wakers array)", async () => {
      const store = createInMemoryWorkflowExecutionStore();
      const watcher = store.watch();
      const iter = watcher[Symbol.asyncIterator]();
      // Queue is empty; two next() calls register two wakers.
      const p1 = iter.next();
      const p2 = iter.next();
      await store.put(exec("alpha"));
      await store.put(exec("beta"));
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1.value!.execution.execution_id).toBe("alpha");
      expect(r2.value!.execution.execution_id).toBe("beta");
      await iter.return!();
      await store.close();
    });

    it("multiple watchers each see every event after their start", async () => {
      const store = createInMemoryWorkflowExecutionStore();
      const a: WorkflowExecutionEvent[] = [];
      const b: WorkflowExecutionEvent[] = [];
      const wa = (async () => {
        for await (const event of store.watch()) {
          a.push(event);
          if (a.length === 2) break;
        }
      })();
      const wb = (async () => {
        for await (const event of store.watch()) {
          b.push(event);
          if (b.length === 2) break;
        }
      })();
      await store.put(exec("alpha"));
      await store.put(exec("beta"));
      await wa;
      await wb;
      expect(a.map((e) => e.execution.execution_id)).toEqual(["alpha", "beta"]);
      expect(b.map((e) => e.execution.execution_id)).toEqual(["alpha", "beta"]);
      await store.close();
    });

    it("terminates pending watchers on close()", async () => {
      const store = createInMemoryWorkflowExecutionStore();
      const watcher = store.watch();
      const iter = watcher[Symbol.asyncIterator]();
      const pending = iter.next();
      await store.close();
      const result = await pending;
      expect(result.done).toBe(true);
    });
  });

  describe("close", () => {
    it("rejects further operations", async () => {
      const store = createInMemoryWorkflowExecutionStore();
      await store.close();
      await expect(store.put(exec("a"))).rejects.toThrow(/closed/);
      await expect(store.get("a")).rejects.toThrow(/closed/);
      await expect(store.listRunning()).rejects.toThrow(/closed/);
      await expect(store.delete("a")).rejects.toThrow(/closed/);
    });

    it("is idempotent", async () => {
      const store = createInMemoryWorkflowExecutionStore();
      await store.close();
      await store.close();
    });
  });
});
