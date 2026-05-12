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

    it("buffers events that arrive between iterator next() calls", async () => {
      const store = createInMemoryWorkflowExecutionStore();
      await store.put(exec("a"));
      await store.put(exec("b"));
      await store.put(exec("c"));
      const watcher = store.watch();
      const iter = watcher[Symbol.asyncIterator]();
      // Watcher only fires for events AFTER it was created. The three
      // puts above happened before watch() — they should not appear.
      // Trigger one more after watch().
      await store.put(exec("d"));
      const first = await iter.next();
      expect(first.value!.execution.execution_id).toBe("d");
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
