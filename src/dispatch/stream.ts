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
 * Stream name is org-scoped (`EVENTS_{org}` upper-cased). JetStream
 * stream names are cluster-scoped, so a single bare `EVENTS` would
 * collide if two operators share a cluster — second org's
 * `ensureStream` would either fail or silently use the first org's
 * subject filter and drop events. Org suffix prevents this; operators
 * running solo in their own cluster see `EVENTS_METAFACTORY` etc.
 *
 * NATS stream names allow `[A-Z0-9_-]`, no dots — `org` is
 * upper-cased and dots replaced with underscores so e.g.
 * `hub.metafactory` becomes `EVENTS_HUB_METAFACTORY`.
 */
export function getEventsStreamConfig(org: string): EventsStreamConfig {
  const sanitizedOrg = org.toUpperCase().replace(/\./g, "_");
  return {
    name: `EVENTS_${sanitizedOrg}`,
    subjects: [`local.${org}.dispatch.task.>`],
    retention: "limits",
    max_age: 7 * 24 * 60 * 60 * 1e9,
    storage: "file",
    discard: "old",
  };
}
