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
_Avoid_: operator, user, owner, human as synonyms for principal (the cross-Borg operator below is a role a principal holds)

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

### Cross-Borg contract vocabulary (proposal)

These terms carry the [approved authority glossary](https://github.com/the-metafactory/meta-factory/issues/581#issuecomment-5969165860) into the shared request/result/acceptance contract, as proposed by [the glossary task](https://github.com/the-metafactory/meta-factory/issues/592). Repository ratification remains pending [the ADR-0001 trigger decision](https://github.com/the-metafactory/meta-factory/issues/590); this proposal does not establish wire fields or implemented behavior. The [request-contract decision](https://github.com/the-metafactory/meta-factory/issues/583) owns the field definitions and signed set.

**Organization**:
The accountable governing body: one or more humans who decide for it. An organization governs one or more Borgs or stacks; separate signing identities alone do not establish separate organizations.
_Avoid_: network, principal, stack as synonyms for organization

**Borg**:
One organization's installation, represented on the wire as a peer with one signing identity and one sovereignty boundary. A Cortex stack is its peer-level counterpart, without becoming an organization.
_Avoid_: organization, Cube, assistant as synonyms for Borg

**Seat**:
A named role inside one Borg or stack that owns obligations across sessions and has exactly one accountable human seat owner. Its obligations survive replacement of its occupant or sessions.
_Avoid_: assistant, agent, session, pack as synonyms for seat

**Occupant**:
The agent and assistant currently bound to a seat. The occupant and the sessions beneath it are replaceable.
_Avoid_: seat, seat owner

**Pack**:
Installable content, owned by Arc's packaging context, that can fill a seat. A pack does not own the seat's obligations.
_Avoid_: seat, occupant

**Capability offering** (or **offering**):
A named, versioned capability a Borg or stack exposes to one specific peer. It is the cross-Borg wire unit; the pilot's offering is `research-brief` v1.
_Avoid_: Cube, capability tag alone, Offer-mode dispatch

**Requested permission**:
The authority one request asks for, bounded by the receiving peer's capability offering. A request cannot widen that offering.
_Avoid_: offering, unrestricted delegation

**Originator**:
The human or agent who asked for the work, distinct from the Borg or stack authenticated by the peer stamp. The originator is the policy actor, not necessarily the cryptographic signer.
_Avoid_: source, signer, sealer as synonyms for originator

**Seal (request approval)**:
A human approval of a request under the sealer role. It is distinct from a peer stamp and from sealing payloads or issuing transport credentials.
_Avoid_: signature alone, encryption, transport-credential seal

#### Human roles in the cross-Borg contract

**Operator (Borg or stack administration)**:
The human who administers a Borg or stack: keys, peer connections, offerings and kill switch. This is an act-specific role, not an identity type, a synonym for principal, or the NATS NSC operator.
_Avoid_: bare operator outside this contract, network, hub, NSC operator

**Requester**:
The human on the requesting side who asks for work. Their agent may draft the request as originator without becoming its human sealer.
_Avoid_: signer, sealer, recipient as synonyms for requester

**Sealer**:
The human who approves an outbound request on the requesting side or admits an inbound request on the supplying side. Supplying-side approval remains bounded by the per-peer offering.
_Avoid_: cryptographic signer, transport-credential issuer

**Recipient**:
The human on the requesting side who accepts a result. Result release belongs to the supplying side and is a separate act.
_Avoid_: requester as an automatic acceptance role, supplying agent

**Seat owner**:
The one accountable human for a seat and the role that delegates work to it on the supplying side. It is distinct from the replaceable occupant.
_Avoid_: occupant, session owner

One human may hold several roles, including every role on their own Borg; each act retains its role attribution. Role names do not imply separate people.

## Relationships

- The **Myelin layer model** has seven **layers**; each layer's contract is consumed by the layer above.
- An **envelope** carries a **payload**, a **sovereignty** block, a `source` label, and a `signed_by` chain.
- A `signed_by` chain is an ordered list of **stamps**; each stamp is made by an **identity**.
- A **principal** is one kind of **identity**; a **hub** is another; agents and services are others.
- A **network** has one **hub**; a hub vouches for the identities in its network.
- An **envelope** travels on a **subject** over the **transport**.
- An **organization** governs one or more **Borgs** or **stacks**; each peer signs as its own **identity**.
- A Borg or stack contains **seats**; each seat has one human **seat owner** and a replaceable **occupant** (agent + assistant), whose sessions are replaceable.
- A **capability offering** is exposed to one specific peer; a request's **requested permission** is bounded by that offering.
- **Effective cross-Borg authority = stamp ∩ originator ∩ seal ∩ receiver's per-peer offering.** The stamp authenticates the sending peer, the originator identifies who asked, the request seal records human approval, and the receiver controls what that peer may invoke. A valid signature alone grants no permission.

## Example dialogue

> **Dev:** An envelope arrived with `source` = `andreas.meta-factory.echo`. Can I trust it came from Echo?
> **Domain expert:** No — `source` is self-asserted, just a routing/display hint. Trust lives in `signed_by`.
> **Dev:** So I check `signed_by`?
> **Expert:** Right. It's a chain of **stamps**. Each stamp is an **identity** signing the canonical envelope bytes. If Echo's agent stamped it with `method: ed25519`, and the **hub** added a `hub-stamp` vouching for that identity, both must verify.
> **Dev:** And if the envelope wants to leave the network?
> **Expert:** Then its **sovereignty** block governs it — classification, data residency. Declared in the **envelope** at M3, attested by the `signed_by` chain at M4, enforced at M2 before the **transport** lets it cross to another **principal** on the `federated.` **subject** scope.

## Flagged ambiguities

- **`principal` was the broad term.** myelin defined `principal` as any DID entity (agent/service/operator). Resolved: that broad concept is **`identity`**; `principal` means the human, matching soma + cortex. myelin's `Principal` interface → `Identity`; the `signed_by[].principal` field → `signed_by[].identity` (an envelope-schema change).
- **`operator` → `network` / `hub`.** myelin used `operator` for the legacy org-that-runs-the-hub label and as an identity type. That label became **network**; the trust-anchor identity is the **hub** (`Identity.type: "hub"`); the `Identity.operator` field → `Identity.network`. The proposed cross-Borg **organization** is a governing body distinct from network topology; its **operator** is a qualified human administration role, not a reversal of those identity renames.
- **`source` grammar.** Was `org.agent.instance` (loose 3–5 segments) — the shape the pilot review-loop bug exploited. Resolved: fixed `{principal}.{stack}.{assistant}`, aligned with the subject grammar's leading segments.

## Boundary with adjacent contexts

Reconciled in full in `compass/ecosystem/CONTEXT-MAP.md`:

- `myelin:principal` **≡** `cortex:principal` **≡** `soma:principal` — the human.
- `myelin:identity` is the **superset** — any authenticatable entity. cortex/soma speak of agents and principals directly, with no separate word for the superset.
- `myelin:network` **≡** `cortex:network` — `metafactory`. The legacy operator identity type remains retired; the cross-Borg operator is a qualified human role.
- `myelin:envelope` / `myelin:subject` / `myelin:payload` are the **published language** — myelin defines them; cortex, signal, and pilot consume them. The cortex grill's renames (`{org}`→`{principal}`, "Reach"→"Scope", topic→subject) are myelin grammar changes, filed as a `namespace.md` issue.
- `myelin:layer` vs `cortex:stack` — both were once called "stack". A layer is a charter in the Myelin layer model; a stack is a cortex deployment unit. Never conflated.
- The shared cross-Borg contract reuses Cortex's **stack**, **assistant**, **agent** (non-human runtime identity) and **session** meanings. A pack belongs to Arc; a seat is not any of those entities. [Cortex's glossary](https://github.com/the-metafactory/cortex/blob/main/CONTEXT.md) records its adapter mappings.
- **Cube** is Borgir-internal packaging and never a cross-Borg wire unit. Borgir's adapter mappings and any internal renames remain Magnús's decision (Q-M6 on the [authority resolution](https://github.com/the-metafactory/meta-factory/issues/581#issuecomment-5969165860)); this glossary does not approve them for him.
