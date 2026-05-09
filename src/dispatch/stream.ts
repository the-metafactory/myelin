// F-020: EVENTS JetStream stream config for dispatch lifecycle.

export interface EventsStreamConfig {
  name: string;
  subjects: string[];
  retention: "limits";
  max_age: number;
  storage: "file";
  discard: "old";
}

/**
 * EVENTS stream config — JetStream-backed lifecycle events.
 *
 *   subjects:   local.{org}.dispatch.task.>
 *   retention:  limits
 *   max_age:    7 days (matches TASKS — Decision)
 *   storage:    file
 *   discard:    old
 *
 * Returned config can be passed to NATSTransport.ensureStream() or
 * applied via NSC.
 */
export function getEventsStreamConfig(org: string): EventsStreamConfig {
  return {
    name: "EVENTS",
    subjects: [`local.${org}.dispatch.task.>`],
    retention: "limits",
    max_age: 7 * 24 * 60 * 60 * 1e9,
    storage: "file",
    discard: "old",
  };
}
