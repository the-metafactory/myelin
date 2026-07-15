# Myelin — Context

Myelin is the **M2–M6 protocol layers of the Myelin layer model** — the metafactory contracts that connect agents across the bus: transport, envelope, identity, discovery, composition. One schema for all signals; sovereignty travels with the message.

This is the canonical domain glossary for the **myelin** bounded context — one canonical term per concept; aliases are listed under _Avoid_. Boundary terms shared with soma, cortex, and signal are reconciled in `compass/ecosystem/CONTEXT-MAP.md`. Resolved by a `grill-with-docs` session: contested terms (identity, network, source) were grilled; settled layer/charter terms were drafted from `docs/architecture.md`, `docs/identity.md`, `docs/sovereignty.md`.

## Language

### The layer model

**Myelin layer model**:
The seven-layer protocol model — M1 Connectivity, M2 Transport, M3 Envelope, M4 Identity, M5 Discovery, M6 Composition, M7 Surfaces. The canonical metafactory protocol layer model; supersedes the v4 nervous-system naming (MYELIN/AXON/DENDRITE/SYNAPSE/CORTEX). The **M-prefix (M1–M7) is canonical**; the historical L-prefix lettering is an accepted alias for the same seven charters — the equivalence is declared once in `compass/ecosystem/CONTEXT-MAP.md`.
_Avoid_: the Myelin stack (a `stack` is a cortex deployment unit — see the cortex bounded context), the seven-layer stack, bare L-prefixed layer numbering (use the M-prefix)

**Layer**:
One of the seven charters in the Myelin layer model — a narrow contract with swappable implementations. Higher layers compose against the layer below; code never skips a layer.
_Avoid_: tier, level, ring

### Identity & trust

**Identity**:
Any authenticatable entity in the system — a DID-style identifier (`did:mf:echo`) plus an Ed25519 keypair. Agents, services, network hubs, and principals all *have* identities. myelin's M4 is the Identity layer; the `signed_by` chain attests identities.
_Avoid_: principal (that is specifically the human — one kind of identity, not the general term)

**Principal**:
The human — the owner and trust root. A principal is **one kind of identity** (the human kind); agents and services are identities but not principals. Identical to `soma:principal` and `cortex:principal`.
_Avoid_: operator, user, owner, human

**Network**:
A federation of **principals** whose stacks interconnect at the NATS leaf-node layer — `metafactory` is one. The `federated.` scope crosses principal boundaries within a network. A network has a **hub** as its trust anchor. Never a subject segment.
_Avoid_: operator, org, federation, mesh, cluster

**Hub**:
The trust-anchor **identity** of a **network** — `did:mf:hub.metafactory`, `is_hub: true`. A hub issues hub-stamps that vouch for other identities. `Identity.type: "hub"`.
_Avoid_: operator, operator hub, root, authority

**Stamp**:
One cryptographic attestation in an **envelope**'s `signed_by` chain — an **identity** signing the canonical envelope bytes (including the prior chain). Methods: `ed25519` (direct) or `hub-stamp` (a **hub** vouching). A stamp may carry a role.
_Avoid_: signature (a stamp is a signature *plus* attester + method + role), seal

**signed_by**:
The ordered chain of **stamps** on an **envelope** — the verified trust anchor. Every stamp must verify for the envelope to be trusted. Distinct from `source` (self-asserted, unverified).
_Avoid_: signers, signatures, attestations

**source**:
The self-asserted origin label of an **envelope** — `{principal}.{stack}.{assistant}`. A routing/display hint only; **not verified** (trust comes from `signed_by`). Its first segment seeds the **subject**'s principal segment.
_Avoid_: origin, sender, from

### The message

**Envelope**:
The signed wrapper every bus message travels in — canonical fields (`id`, `source`, `type`, `timestamp`, `correlation_id`, `sovereignty`, `signed_by`, `extensions`) around a **payload**. myelin owns the envelope schema; cortex and other M7 surfaces consume it.
_Avoid_: message (too loose), packet, wrapper

**Payload**:
The inner content body of an **envelope** — the domain data, distinct from the envelope's routing/trust/sovereignty metadata.
_Avoid_: message, body, data

**Sovereignty**:
The envelope's "passport" — the metadata block governing how a message may be handled: classification, data residency, model constraints. A cross-layer concern: **declared** at M3, **attested** at M4, **enforced** at M2.
_Avoid_: policy (policy is the rules; sovereignty is the message's own declared constraints), compliance, governance

### The bus

**Subject**:
The dotted NATS routing string — `{scope}.{principal}.{stack}.{domain}.{entity}.{action}`. myelin owns the grammar (`specs/namespace.md`); cortex, signal, pilot consume it as a published language.
_Avoid_: topic, channel, path

**Transport**:
M2 — the abstract bus interface: pub/sub + request/reply, subject-based addressing, explicit delivery guarantees. Higher layers compose against the abstract `Transport`, never a concrete bus (NATS, Kafka) directly.
_Avoid_: bus (informal; the concept is the abstract interface), connection, broker

**Nak**:
A structured rejection of a dispatched task, carrying a typed `NakReasonCode` (e.g. `not-now`). Distinct from a silent drop or a timeout — a nak tells the sender *why*.
_Avoid_: reject, fail, error, decline

## Relationships

- The **Myelin layer model** has seven **layers**; each layer's contract is consumed by the layer above.
- An **envelope** carries a **payload**, a **sovereignty** block, a `source` label, and a `signed_by` chain.
- A `signed_by` chain is an ordered list of **stamps**; each stamp is made by an **identity**.
- A **principal** is one kind of **identity**; a **hub** is another; agents and services are others.
- A **network** has one **hub**; a hub vouches for the identities in its network.
- An **envelope** travels on a **subject** over the **transport**.

## Example dialogue

> **Dev:** An envelope arrived with `source` = `andreas.meta-factory.echo`. Can I trust it came from Echo?
> **Domain expert:** No — `source` is self-asserted, just a routing/display hint. Trust lives in `signed_by`.
> **Dev:** So I check `signed_by`?
> **Expert:** Right. It's a chain of **stamps**. Each stamp is an **identity** signing the canonical envelope bytes. If Echo's agent stamped it with `method: ed25519`, and the **hub** added a `hub-stamp` vouching for that identity, both must verify.
> **Dev:** And if the envelope wants to leave the network?
> **Expert:** Then its **sovereignty** block governs it — classification, data residency. Declared in the **envelope** at M3, attested by the `signed_by` chain at M4, enforced at M2 before the **transport** lets it cross to another **principal** on the `federated.` **subject** scope.

## Flagged ambiguities

- **`principal` was the broad term.** myelin defined `principal` as any DID entity (agent/service/operator). Resolved: that broad concept is **`identity`**; `principal` means the human, matching soma + cortex. myelin's `Principal` interface → `Identity`; the `signed_by[].principal` field → `signed_by[].identity` (an envelope-schema change).
- **`operator` → `network` / `hub`.** myelin used `operator` for the org-that-runs-the-hub and as an identity type. Resolved: the org is the **network**; the trust-anchor identity is the **hub** (`Identity.type: "hub"`); the `Identity.operator` field → `Identity.network`. `operator` is killed in all three contexts.
- **`source` grammar.** Was `org.agent.instance` (loose 3–5 segments) — the shape the pilot review-loop bug exploited. Resolved: fixed `{principal}.{stack}.{assistant}`, aligned with the subject grammar's leading segments.

## Boundary with adjacent contexts

Reconciled in full in `compass/ecosystem/CONTEXT-MAP.md`:

- `myelin:principal` **≡** `cortex:principal` **≡** `soma:principal` — the human.
- `myelin:identity` is the **superset** — any authenticatable entity. cortex/soma speak of agents and principals directly, with no separate word for the superset.
- `myelin:network` **≡** `cortex:network` — `metafactory`. `operator` killed everywhere.
- `myelin:envelope` / `myelin:subject` / `myelin:payload` are the **published language** — myelin defines them; cortex, signal, and pilot consume them. The cortex grill's renames (`{org}`→`{principal}`, "Reach"→"Scope", topic→subject) are myelin grammar changes, filed as a `namespace.md` issue.
- `myelin:layer` vs `cortex:stack` — both were once called "stack". A layer is a charter in the Myelin layer model; a stack is a cortex deployment unit. Never conflated.
