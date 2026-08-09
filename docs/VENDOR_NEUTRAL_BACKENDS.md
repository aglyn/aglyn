# Vendor-neutral backends

The AGL-909 design decision, condensed. Full option analysis (three
candidates, the hard problems, open product questions) lives in the Linear
document on the Self-hosting project:
[AGL-909 — Vendor-neutral backends: provider abstraction design](https://linear.app/aglyn/document/agl-909-vendor-neutral-backends-provider-abstraction-design-d7c41c31e983).

## The decision (2026-08-08)

**We are not building a provider abstraction.** BYO-Firebase — the shipped
self-hosting model ([SELF_HOSTING.md](./SELF_HOSTING.md), AGL-904..906) — is
the permanent answer: a self-hoster points the same Apache-2.0 code at their
own Firebase project and owns the data, the identity store, the rules, and
the billing. That already delivers the substance of "vendor-neutral" (data
sovereignty, no Aglyn-controlled backend) without pretending Firestore's
semantics are swappable.

Enterprise "bring our IdP" asks are served today by Firebase Auth's OIDC/SAML
federation — configuration, not code.

## Why: the coupling survey (measured on `main`, 2026-08-08)

Firebase is not a dependency here; it is the architecture. Across the repo's
~14,600 TS/TSX files under `libs/` + `apps/`:

- **~230 files import a Firebase SDK**: 158 `firebase/firestore` (web SDK,
  83 in `apps/console`), 72 `firebase-admin/*`, 21 `firebase/auth`,
  3 `firebase/database`, 3 `firebase/app-check`.
- **>2,500 Firestore call sites**: `collection(` 1,176 · `doc(` 1,032 ·
  `where(` 196 · `serverTimestamp(` 176 · `runTransaction` 27 ·
  `withConverter` in 15 files. Firestore types (`DocumentReference`,
  snapshots) leak into 101 sites including shared type libs
  (`libs/shared/data/types`, `libs/shared/util/timestamp`).
- **Authorization is the database's job**: `cloud/firebase-firestore.rules`
  (998 lines) is evaluated against browser-direct connections. There is no
  API tier to re-host it on — a neutral backend means building one, plus a
  policy engine, for every one of those call sites.
- **Offline cache is load-bearing**: `persistentLocalCache`
  (`libs/tenant/feature/instance/src/lib/hooks/firebase/firebase-services.tsx`)
  provides queued-write replay and cross-tab cache that product code and
  tests explicitly depend on.
- **Realtime is two systems**: `onSnapshot` listeners are the console's
  primary read path, and RTDB carries co-editing/presence
  (`apps/console/hooks/use-coediting.ts`, `use-presence.ts`) with
  `onDisconnect` semantics that have no drop-in neutral analogue.
- **App Check** protects both client bootstraps and the admin path; the
  neutral replacement is a security-posture redesign, not a shim.

Abstracting the imports is the cheap half. Re-implementing rules-based
authorization, listener + offline sync, presence, and the semantic long tail
(converters running on partial writes, negative-cache tombstones,
field transforms) is a multi-quarter rewrite.

## Revisit triggers

Any one of these reopens the question:

- A signed or late-stage enterprise deal conditioned on no Google cloud.
- A Firebase pricing or deprecation shock.
- A regulated-market/sovereign-cloud requirement Firebase regions can't meet.
- The customer REST API arc organically grows an API tier over Firestore
  broad enough to change the browser-direct math.

If a trigger fires, the first step is a priced spike against that customer's
contract value — not implementation issues.
