# Multi-Tenant Organizations & Firestore v2 — Design

Status: **In progress** (Linear project: Multi-Tenant Organizations & Firestore v2)
Author: Zach Gover, 2026-07-09

> **2026-07-09 update:** the product is pre-launch, so the dual-write
> machinery in §10 was dropped in favor of a direct cutover. Implemented:
> org model + APIs (AGL-233), membership/invites (AGL-234), rules v2
> (AGL-235), the `backfill-orgs.mjs` one-shot script, and the org switcher
> behind `release_org_workspaces` (AGL-236 partial). Host content
> authorization uses a role-aware `memberRoles` projection on the host doc
> (kept in sync by the org APIs) instead of a second rules `get()`, and
> hosts remain top-level (`hostIndex` resolves host → org) — ancestry
> nesting was traded for keeping every existing `hosts/{hostId}` path
> working. Second pass (same day): workspace-subdomain middleware (inert
> until ops sets `NEXT_PUBLIC_WORKSPACE_DOMAIN`), org-scoped host
> creation, billing mirrored to org docs with entitlements resolving from
> them (AGL-237 part 1), per-org usage rollups (AGL-238 part 1), and a
> rules emulator matrix (`npm run test:rules`, 13 cases) that caught and
> fixed an editor-can-delete-host wildcard hole. Still open: wildcard DNS
> + cross-subdomain session cookies (ops, AGL-236), moving media/datasets/
> plugins to org scope + Stripe metering re-key (AGL-237), legacy
> `tenants` removal after a parity soak (AGL-238).

## 1. Context & goals

Billing v1 (AGL-38/67) keys `tenants/{tenantId}` by the **owner's auth uid** and
keeps hosts top-level with a per-host `admins` uid map. That works for
single-owner accounts but not for the product's real shape:

- **An organization subscribes to Aglyn** and owns 1–15+ websites (hosts).
- Hosts inside an org **share** dynamic data (datasets), plugin installs,
  community presence, media files, and billing.
- Hosts do **not** share site members (end-users of the published site) or
  screens/layouts.
- **A person belongs to many orgs** with different powers in each — e.g.
  zachary.w.gover@gmail.com writes blogs on 3 of Business 1's sites and
  oversees development on all 15 of Business 2's.
- A one-person small business is just an org with one member and 1–2 hosts —
  same model, no special case.

Constraints:

- Everything stays in **one Firestore database** — isolation must be
  structural, and cross-tenant contamination impossible by construction.
- **Cheap on freemium**: security-rule `get()` calls are billed reads; fan-outs
  and rule lookups must stay O(1) per request.
- **Cost forwarding**: metered pass-through billing (cost × 1.30, AGL-41)
  needs per-org usage attribution.
- No downtime migration from the v1 layout.

## 2. Current state (v1)

```
tenants/{ownerUid}                 plan, entitlements, suspension, Stripe ids
tenants/{ownerUid}/members/{uid}   tenant managers (AGL-127)
hosts/{hostId}                     admins: {uid: true}, tenantId?
hosts/{hostId}/screens|layouts|contacts|datasets|media|... (everything)
profiles/{ownerUid}                community publisher profile
communityListings/{id}             marketplace (global, fine as-is)
communityPurchases/{id}            global, fine as-is
revocations/{id}                   global kill switch, fine as-is
adminAudit/{id}                    staff-only, fine as-is
users/{uid}                        profile prefs
```

Problems: tenant identity is coupled to one human's uid (no transfer of
ownership, no org rename, awkward team semantics); host→tenant is a nullable
back-pointer enforced by discipline, not structure; org-shared resources
(media, datasets, plugins) are duplicated per host; "which sites can this
person touch" is an unbounded uid-map scan; nothing supports org-level
subdomains.

## 3. Design principles

1. **The organization is the tenant.** One org = one subscription = one
   isolation boundary = one subdomain.
2. **Ownership by ancestry.** Everything an org owns lives *under*
   `orgs/{orgId}`. A rule scoped to the org subtree cannot leak another org's
   data no matter what a query says. No `where('orgId'==…)` discipline.
3. **≤1 rule `get()` per request.** Authorization resolves from a single
   membership doc read (rules dedupe identical gets within one evaluation).
4. **Claims stay small.** Custom claims keep only `staff`/`staffRole`.
   Org membership can't live in claims: 1000-byte limit, multi-org users,
   and revocation latency (claims live until token refresh).
5. **Deny by default, allow by subtree.** Public reads only where the
   product requires them (published content is served by the Admin SDK from
   the tenant app, which bypasses rules — so almost nothing needs public read).

## 4. Data model (v2)

```
orgs/{orgId}
  name, slug, createdAt, ownerUid            # denormalized slug for display
  plan, entitlements, seatAddons             # moves from tenants/{uid}
  suspendedAt?, suspendedReason?             # staff suspension (AGL-210)
  billing: { stripeCustomerId, ... }         # webhook-written, Admin SDK only

  members/{uid}                              # THE authz doc (one get in rules)
    role: 'owner' | 'admin' | 'editor' | 'viewer'
    allHosts: bool                           # org-wide access shortcut
    hostAccess: { [hostId]: 'admin'|'editor'|'viewer' }  # else per-host
    invitedBy, joinedAt, displayName, email  # denormalized for member lists

  invites/{inviteId}                         # pending email invites

  hosts/{hostId}                             # host doc + everything host-scoped
    name, domains, settings, ...
    screens/{...}, layouts/{...}             # NOT shared across hosts
    siteMembers/{...}                        # published-site end users
    contacts/{...}, redirects/{...}, ...

  media/{mediaId}                            # SHARED across the org's hosts
  datasets/{datasetId}                       # shared dynamic data
  pluginInstalls/{installId}                 # shared plugin installs + pins
  profile (doc or subdoc)                    # community publisher profile
  usage/{yyyymm}                             # cost-attribution rollups (§9)

orgSlugs/{slug} -> { orgId }                 # uniqueness reservation, tx-created
users/{uid}
  profile prefs (as today)
  orgs/{orgId} -> { role, orgName, slug }    # reverse index: "my organizations"
```

Notes:

- **hostId stays globally unique** (it's the console's route param and the
  tenant app's lookup key). A lightweight top-level `hostIndex/{hostId} ->
  { orgId }` mirror lets the tenant renderer and middleware resolve a host
  without knowing its org, written server-side alongside host create/delete.
- The **reverse index** `users/{uid}/orgs/{orgId}` is maintained
  transactionally with `orgs/{orgId}/members/{uid}` by the membership API
  route (Admin SDK), never by clients. "List my orgs" is then one cheap,
  rule-safe collection read — no collection-group query or composite index.
- **Small businesses**: signup auto-creates an org (`{slug} = handle or
  generated`), the creator is `role: owner, allHosts: true`. The console UX
  can hide org vocabulary until a second member or host exists.
- Marketplace collections (`communityListings`, `communityPurchases`,
  `revocations`, `adminAudit`) stay global — they are cross-tenant by nature.

## 5. Authorization model

Org roles (org-wide), then per-host refinement:

| role   | org settings/billing | members | create hosts | host content |
|--------|----------------------|---------|--------------|--------------|
| owner  | ✓ (incl. delete org) | ✓       | ✓            | ✓ all hosts  |
| admin  | ✓ (not delete/billing transfer) | ✓ | ✓        | ✓ all hosts  |
| editor | —                    | —       | —            | per `hostAccess` / `allHosts` |
| viewer | read-only            | —       | —            | read per `hostAccess` |

- `editor`/`viewer` get `hostAccess: { hostId: role }` unless `allHosts` —
  this is exactly the "blogs on 3 of 15 sites" case.
- Aglyn staff (`staff` custom claim + `staffRole`) keeps working exactly as
  today — claims-only checks, no org membership needed, audit-logged writes.
- Suspension: rules read `suspendedAt` off the org doc — but to preserve the
  1-get budget, the membership doc carries a denormalized `orgSuspended`
  flag maintained by the suspension API route (writes N member docs on
  suspend, a rare staff action — the right side of the read/write tradeoff).

### Rules v2 sketch

```
match /orgs/{orgId} {
  function member() {
    return get(/databases/$(db)/documents/orgs/$(orgId)/members/$(request.auth.uid)).data;
  }
  function hasOrgRole(roles) { return isStaff() || member().role in roles; }
  function canTouchHost(hostId, write) {
    return isStaff() ||
      member().allHosts == true ||
      (write ? member().hostAccess[hostId] in ['admin','editor']
             : member().hostAccess[hostId] != null);
  }
  function notSuspended() { return member().orgSuspended != true; }

  allow read: if isStaff() || member() != null;
  allow update: if hasOrgRole(['owner','admin']) && notSuspended()
                && billingKeysUntouched();   // plan/billing via Admin SDK only

  match /members/{uid}  { ... owner/admin manage; users read own doc ... }
  match /hosts/{hostId} {
    allow read:  if canTouchHost(hostId, false);
    allow write: if canTouchHost(hostId, true) && notSuspended();
    match /{document=**} { same, inherited }
  }
  match /media/{id}    { org-shared: any member reads; editors+ write }
  match /datasets/{id} { same }
}
match /orgSlugs/{slug} { allow read: if true; allow write: if false; }  // API-only
```

Identical `get()`s within one evaluation are billed once, so `member()`
appearing in several functions still costs one read per request.

## 6. Subdomains (Slack-style)

- **Org subdomain, not host subdomain**: `{org-slug}.aglyn.com` opens the
  console scoped to that org (like `acme.slack.com`). Hosts keep their own
  public domains/subdomains through the existing tenant app + custom-domain
  flow — those are the org's *products*, not its workspace.
- Wildcard DNS `*.aglyn.com` → the console's Vercel project (wildcard domain).
  Next.js middleware extracts the subdomain, resolves `orgSlugs/{slug}`
  (edge-cached), rewrites to org-scoped routing, and sets the org context.
  Unknown slug → marketing/404. Reserved list (`www`, `api`, `admin`,
  `console`, `docs`, `staff`, …) enforced at claim time.
- Slug claim happens at org creation inside a transaction that creates
  `orgSlugs/{slug}` + the org doc; renames re-reserve and keep a redirect
  tombstone for a grace period.
- Console paths become `/{hostId}/…` *within* the org context; on the apex
  domain (console.aglyn.com) an org switcher (from `users/{uid}/orgs`)
  redirects to the chosen subdomain. Auth: Firebase session cookies scoped
  to `.aglyn.com` so hopping subdomains doesn't re-authenticate.

## 7. Storage & other services

- Cloud Storage paths move to `orgs/{orgId}/media/{...}`; storage rules
  mirror the membership check via a custom-claims-free lookup — storage
  rules can't `get()` Firestore, so uploads go through the existing
  upload-URL API route (already the pattern: `api/media/upload-url.ts`),
  which checks membership server-side and signs a scoped URL. Public serving
  stays behind the media CDN route.
- RTDB (presence etc.) namespaced by orgId the same way.

## 8. Preventing cross-contamination

- Ancestry scoping (§3.2) — a query physically cannot span orgs.
- All privileged mutations (billing, membership, slug, suspension, plugin
  installs) go through API routes/Admin SDK — rules deny client writes.
- App Check stays mandatory; per-org rate limits in the API routes.
- Staff access remains claim-based, never membership-based, and every staff
  mutation writes `adminAudit`.

## 9. Cost model & attribution

- **Rule reads**: 1 membership get per request (deduped); reverse index
  avoids collection-group scans; member-doc denormalization avoids second
  gets (suspension).
- **Usage rollups**: `orgs/{orgId}/usage/{yyyymm}` documents aggregated by
  the existing usage pipeline (AGL-41 metered billing + AGL-136 quota
  banners) — bandwidth, storage bytes, function invocations, Firestore
  ops sampled from the billing export. This is what makes pass-through
  pricing and freemium abuse caps per-org instead of per-uid.
- **Freemium posture**: free orgs = 1 host, tight quotas (existing
  entitlements table), no scheduled functions per-org, shared CDN cache.
  The expensive primitives (rules gets, fan-outs) are bounded above, so a
  free org's floor cost is a handful of reads per session.

## 10. Migration plan (no downtime)

Phase 0 — **Dual-model foundation**: create `orgs` schema, slug reservation,
`hostIndex`; org-creation API; backfill script: every `tenants/{uid}` →
`orgs/{orgId}` (fresh orgId; `ownerUid` preserved; members copied with
`role: owner/admin`, `allHosts: true`; hosts re-parented by copy, original
kept). Dual-write from API routes (writes go to both models).

Phase 1 — **Membership & invites** on the new model (roles, per-host access,
reverse index); console team UI reads new model behind a release flag
(`release_org_workspaces` — dogfood via the feature-flag system).

Phase 2 — **Rules v2** for the `orgs` subtree + storage rules; emulator test
suite covering member/non-member/suspended/staff matrices for both models.

Phase 3 — **Console reads cutover**: org switcher, org-scoped routing,
subdomain middleware on a staging wildcard; hostIndex-based tenant renderer.

Phase 4 — **Shared resources**: media/datasets/plugin installs move to org
scope (copy + re-point), billing objects re-keyed to orgId (Stripe metadata
update, webhook handles both keys during transition).

Phase 5 — **Cutover & cleanup**: stop dual-writes, freeze `tenants`/top-level
`hosts` read paths behind staff-only fallback, delete after a full billing
cycle of parity checks. Remove v1 rules.

## 11. Open questions

- Org deletion/export: GDPR erasure currently keys off tenant uid
  (`erasureRequestedAt`) — needs an org-level equivalent with per-member
  handling.
- Do host-scoped `contacts` stay host-scoped, or become org-shared audiences?
  (Email campaigns pull cross-host; leaning host-scoped with org-level
  audience *views* — decide in Phase 4.)
- Slug squatting / trademark policy for subdomains.
- Whether `hostIndex` should also carry the public-domain → host mapping the
  tenant app uses today (probably yes, consolidating two lookups).
