---
sidebar_position: 7
title: "Architecture: Multi-Tenant Organizations"
description: How Aglyn organizes tenants — org workspaces, membership with per-site access, security rules, subdomains, and billing attribution.
---

# Architecture: Multi-Tenant Organizations

:::warning Aglyn staff only
Internal architecture reference for the organization tenancy model (Linear project
*Multi-Tenant Organizations & Firestore v2*; the full design doc lives in the repo at
`docs/MULTI_TENANT_FIRESTORE.md`).
:::

## The model in one sentence

**An organization is the tenant**: one subscription, one workspace subdomain, one
isolation boundary — owning any number of hosts (websites), with people belonging to
many organizations under different roles.

## Data model

Everything lives in one Firestore database. Isolation comes from membership documents
and server-maintained projections, never from client-side query discipline:

```mermaid
graph TD
  subgraph ORG ["orgs/#lcub;orgId#rcub; — the tenant boundary"]
    O["org doc<br/>name · slug · ownerUid<br/>plan · entitlements · subscription"]
    M["members/#lcub;uid#rcub;<br/>role · allHosts · hostAccess map"]
    I["invites/#lcub;inviteId#rcub;<br/>email · role · host access"]
    U["usage/#lcub;yyyymm#rcub;<br/>storage · views · cost rollups"]
  end

  SLUG["orgSlugs/#lcub;slug#rcub;<br/>(public read — subdomain resolution)"] --> O
  HIDX["hostIndex/#lcub;hostId#rcub;<br/>(host → org resolver)"] --> O
  RIDX["users/#lcub;uid#rcub;/orgs/#lcub;orgId#rcub;<br/>(reverse index: 'my organizations')"] --> O

  subgraph HOST ["hosts/#lcub;hostId#rcub; (top-level, globally unique id)"]
    H["host doc<br/>orgId · memberRoles projection<br/>(+ legacy admins map)"]
    HC["screens · layouts · contacts<br/>media · datasets · redirects …"]
  end

  O -- "hosts directory" --> H
  M -- "syncHostMemberRoles()<br/>projection fan-out" --> H
  H --- HC
```

Two deliberate choices:

- **Hosts stay top-level.** Host ids are the console's route params and the tenant
  renderer's lookup keys; `hostIndex` resolves a host's org without knowing it. The
  isolation the design wanted from ancestry nesting comes from the projection below.
- **Reverse index over collection-group queries.** "List my orgs" is one cheap
  collection read under the user's own doc — no composite indexes, no cross-org scans.

## Authorization: one read per request

Security rules never do more than one extra document read. For host content that read is
the host doc itself, which carries a **`memberRoles` projection** — a map of
`uid → admin | editor | viewer` recomputed by the org APIs whenever membership changes:

```mermaid
flowchart TD
  R["Request on hosts/#lcub;hostId#rcub;/…"] --> G["Rules read the host doc (1 get)"]
  G --> P{"memberRoles[uid]<br/>(or legacy admins[uid])"}
  P -- "absent" --> DENY["⛔ denied"]
  P -- "viewer" --> READ["👁 read only"]
  P -- "editor" --> RW["✏️ read + write content<br/>(cannot delete the host)"]
  P -- "admin" --> ALL["🔑 read + write + delete"]
  RW --> S{"owning tenant<br/>suspended?"}
  ALL --> S
  S -- "yes" --> RO["reads keep working,<br/>writes blocked"]
  S -- "no" --> OK["✅ allowed"]
  STAFF["Staff claim"] -. "bypasses membership,<br/>always audited" .-> OK
```

Org-level roles feed that projection:

| Org role | Org settings | Members & invites | Create hosts | Host access |
|----------|--------------|-------------------|--------------|-------------|
| owner    | ✓ (incl. delete) | ✓ | ✓ | admin on all hosts |
| admin    | ✓ | ✓ | ✓ | admin on all hosts |
| editor   | — | — | — | per `hostAccess` / `allHosts` |
| viewer   | read-only | — | — | read per `hostAccess` / `allHosts` |

Billing, suspension, slugs, membership and the projections are **Admin-SDK-only** —
security rules deny every client write, so the invariants can't drift from the browser.
A 13-case emulator matrix (`npm run test:rules`) locks this behavior in; it caught a
rules-v2 wildcard subtlety (zero-segment `{document=**}` matching the host doc itself)
before it shipped.

## Membership lifecycle

All mutations flow through API routes so three places stay consistent — the member doc,
the reverse index, and every affected host's projection:

```mermaid
sequenceDiagram
  autonumber
  actor A as Org admin
  participant API as orgs API
  participant M as member doc
  participant R as reverse index
  participant H as host projections

  A->>API: upsert / remove / invite
  API->>API: admin check + owner guards
  API->>M: write (transaction)
  API->>R: users/uid/orgs (same tx)
  API->>H: syncHostMemberRoles() fan-out
  Note over H: rules verdicts update instantly
```

Invites follow the same path: an org admin records the invite, the invited person signs
in with a **verified matching email** and accepts, which materializes the membership
through the identical transaction + fan-out.

## Workspace subdomains

Each org gets a Slack-style workspace address. Host sites keep their own domains — the
workspace subdomain scopes the **console**, not published sites:

```mermaid
flowchart LR
  B["Browser:<br/>business1.aglyn.com"] --> MW{"Next middleware:<br/>slug known?<br/>(public orgSlugs read, cached)"}
  MW -- "yes" --> CON["Console renders;<br/>OrgWorkspaceProvider pins the org scope"]
  MW -- "no" --> APEX["Redirect to apex console<br/>?unknown-workspace=slug"]
  A2["Browser: console.aglyn.com"] --> SW["Org switcher<br/>(users/#lcub;uid#rcub;/orgs)"]
  SW --> CON
```

The middleware is inert until ops sets `NEXT_PUBLIC_WORKSPACE_DOMAIN` beside the
wildcard domain. Organizations are the permanent tenancy model (not release-flagged):
every account operates inside an org, and the switcher appears as soon as a user
belongs to one.

## Billing & cost attribution

Plans and entitlements are migrating from uid-keyed `tenants` docs to org docs. During
the transition both are written; the console already **reads from the org doc first**:

```mermaid
flowchart TD
  CO["Checkout API<br/>(orgId in Stripe metadata)"] --> ST["Stripe subscription"]
  ST -- "webhook" --> WH["/api/billing/webhook"]
  WH --> T["tenants/#lcub;uid#rcub;<br/>(legacy, until cutover)"]
  WH --> OG["orgs/#lcub;orgId#rcub;<br/>plan · subscription mirror"]
  OG --> ENT["useCurrentTenant →<br/>entitlements & quotas"]
  T -. "fallback only" .-> ENT
  CRON["Monthly usage cron"] --> UR["orgs/#lcub;orgId#rcub;/usage/#lcub;month#rcub;<br/>storage · views · cost × 1.30"]
  UR --> METER["Stripe metered billing<br/>(pass-through pricing)"]
```

Per-org usage rollups are what keep the freemium model affordable: every org's floor
cost is a handful of Firestore reads per session (one membership/host-doc read per
request, reverse index instead of scans), and anything metered is attributed to the org
that caused it.

## Related

- [Feature flags](./feature-flags.md) — the release-gating system the workspace UX
  ships behind.
- [Teams, Roles & Membership](../teams-and-roles/overview.md) — the customer-facing
  view of the same membership model.
- `docs/MULTI_TENANT_FIRESTORE.md` (repo) — full design doc with the migration plan
  and open questions.
