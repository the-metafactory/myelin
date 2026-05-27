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
 *   subjects:   local.{principal}.dispatch.task.>
 *   retention:  limits
 *   max_age:    7 days (matches TASKS — Decision)
 *   storage:    file
 *   discard:    old
 *
 * Stream name is principal-scoped (`EVENTS_{principal}` upper-cased).
 * JetStream stream names are cluster-scoped, so a single bare `EVENTS`
 * would collide if two principals share a cluster — the second
 * principal's `ensureStream` would either fail or silently use the first
 * principal's subject filter and drop events. The principal suffix
 * prevents this; a principal running solo in its own cluster sees
 * `EVENTS_METAFACTORY` etc.
 *
 * NB (JetStream replay — see migration manifest): renaming the stream
 * NAME shape from the legacy `EVENTS_{org}` (pre-vocabulary-migration) to
 * the canonical `EVENTS_{principal}` does not rename a live stream in
 * place. The string template only changes how a NEW stream is named;
 * existing streams keep their names until drained.
 *
 * NATS stream names allow `[A-Z0-9_-]`, no dots — `principal` is
 * upper-cased and dots replaced with underscores so e.g.
 * `hub.metafactory` becomes `EVENTS_HUB_METAFACTORY`.
 */
export function getEventsStreamConfig(principal: string): EventsStreamConfig {
  const sanitizedPrincipal = principal.toUpperCase().replace(/\./g, "_");
  return {
    name: `EVENTS_${sanitizedPrincipal}`,
    subjects: [`local.${principal}.dispatch.task.>`],
    retention: "limits",
    max_age: 7 * 24 * 60 * 60 * 1e9,
    storage: "file",
    discard: "old",
  };
}
