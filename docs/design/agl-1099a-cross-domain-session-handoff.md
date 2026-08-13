# AGL-1099a — Cross-domain session handoff for custom console domains

**Status:** design, not implemented. No feature code exists for any of this.
**Parent:** AGL-1099 (White-Label Phase 4 — custom console domain).
**Written:** 2026-08-09.

AGL-1099 says "start at 1099a … everything else is wasted if it is decided
wrong." This document is that decision. It is written to be argued with: every
choice carries its reason, and the alternatives that were tried and rejected are
in [§8](#8-what-this-design-is-not-proposing), because those are the doors the
next reader would otherwise re-open.

---

## 1. The problem, stated precisely

`brandingProfile.customConsoleDomain` is stored, validated for shape, and
editable in Org → Branding. Nothing routes on it. The blocker is not wiring.

The console's session cookie is minted with `Domain=.aglyn.com`
(`apps/console/app/api/auth/session/route.ts`, `cookieAttributes`). Workspace
subdomains work *because* of that: `apps/console/utils/auth-delegation.ts`
delegates interactive sign-in to `auth.aglyn.com` — Firebase authorized domains
and the `frame-ancestors` allowlist cannot wildcard dynamically-provisioned
subdomains (AGL-465) — and the workspace picks the session back up through the
shared parent-domain `__session` cookie.

`console.acme-agency.com` shares no parent domain with `aglyn.com`. It cannot
receive that cookie. **The delegation mechanism is not merely inconvenient here;
it is unavailable.**

And the route already refuses to help. `rejectUnknownWorkspaceHost` 421s a
`.aglyn.com` hostname that is not a real workspace, deliberately, because
`/api/*` sits outside the middleware matcher and the browser would otherwise
attach a caller's real `__session` to a request from an unregistered host. That
guard is correct and this design does not touch it.

So a custom console domain needs **its own first-party session**, bootstrapped
by a hand-off from `auth.aglyn.com`.

---

## 2. The mechanism, in one paragraph

The custom domain plants a **verifier** in its own first-party cookie jar and
bounces the user to `auth.aglyn.com`. The user signs in there, exactly as they do
today. The auth host authorizes a pending handoff record — but only if the
signed-in user is a **member of the org that owns that domain** — and hands the
browser back to the custom domain carrying a **return secret in the URL
fragment**. The custom domain's redemption endpoint requires *both* the return
secret (from the fragment, proving this browser just authenticated) and the
verifier (from its own cookie, proving this browser started the flow here), and
consumes the record in a single Firestore transaction. It returns a Firebase
**custom token** — the identical shape `GET /api/auth/session` already returns
for cross-subdomain silent sign-in — and the client completes sign-in and mints
its own host-only session cookie through the **existing** `POST
/api/auth/session` path.

Two independent secrets, delivered over two different channels, both required.
Neither channel alone is a session-theft primitive.

```
console.acme-agency.com                auth.aglyn.com                 Firestore
──────────────────────────             ──────────────                 ─────────
GET /  (no session)
  └─ /auth/handoff/start
       set __aglyn_handoff = V  ─────────────────────────────────────▶ authHandoffs/{rid}
       (HttpOnly, Secure,                                                status: pending
        SameSite=Lax, host-only)                                         verifierHash = H(V)
       303 ────────────────────▶ /signin?handoff={rid}                   targetHost, orgId

                                 [existing sign-in, unchanged]
                                 [mints .aglyn.com __session — AGL-466]

                                 POST /api/auth/handoff/authorize
                                   Bearer <fresh ID token>
                                   • member of orgId?      ───────────▶ status: authorized
                                   • domain active+entitled?             secretHash = H(S)
                                   • flip pending→authorized             uid, tenantId
                                     (transaction)                       expires in 120s
                                 location.replace(
   ◀───────────────────────────    https://console.acme-agency.com
                                     /auth/handoff#{rid}.{S} )
/auth/handoff  (fragment: never sent to any server)
  └─ JS: history.replaceState, then
     POST /api/auth/handoff/redeem  {rid, S}   ← same-origin, so __aglyn_handoff rides along
         • Origin / Sec-Fetch-Site same-origin?
         • H(S) == secretHash && H(V) == verifierHash?
         • host == targetHost, not expired, domain still live?
         • consume  (transaction) ────────────────────────────────────▶ status: redeemed
       → { token: <custom token>, tenantId }
  └─ signInWithCustomToken(token)          ← in the browser, where App Check works
  └─ POST /api/auth/session  (Bearer fresh ID token)
       → Set-Cookie: __console_session   host-only, Secure, HttpOnly, SameSite=Lax, 1h
  └─ location.replace(continuePath)
```

---

## 3. The decisions

### D1 — Transport: the URL carries a pointer *and* a secret, and the secret goes in the fragment

**Decision.** The outbound leg carries only an opaque request id (`rid`) in the
query string. The return leg carries `{rid}.{S}` in the **URL fragment**, placed
there by `location.replace()` from JavaScript on the auth host — not by a `302`
`Location` header. The landing page immediately `history.replaceState`s it away
and POSTs it same-origin. `Referrer-Policy: no-referrer` and `Cache-Control:
no-store` on `/auth/handoff`.

**Why.** AGL-1099 names the hazard as "tokens in URLs leak — browser history,
`Referer`, server logs, analytics". Taking those one at a time:

| Leak channel | Query string | Fragment |
| --- | --- | --- |
| Our own Vercel/edge access logs and log drains | **yes** | never — fragments are not transmitted |
| `Referer` on outbound subresources | yes (killable) | never |
| Back/forward history | no (3xx redirects do not create history entries) | yes, until `replaceState` (~one frame) |
| The `Location` response header | yes | avoided by navigating from JS |
| Address bar, over the user's shoulder | yes | yes |

The channel we actually own and cannot audit is the first one. A session-grade
secret in an access log is a long-lived copy in a store that many people and
several third-party observability vendors can read. That alone decides it.

**Why not POST-redirect (`form_post`), which is the textbook answer.** It was the
first choice and it is *unavailable*, for a mechanical reason worth recording so
nobody re-proposes it: a cross-site `POST` does **not** carry `SameSite=Lax`
cookies. `SameSite=Lax` permits top-level **GET** navigations only. So a
`form_post` return leg would arrive at the custom domain without
`__aglyn_handoff`, destroying the second factor. Making the verifier
`SameSite=None` puts it squarely in the third-party-cookie bucket that Safari ITP
already blocks and Chrome is dismantling — the exact class of mechanism this
whole feature exists to route around. `form_post` therefore buys log-safety at
the cost of the binding. The fragment buys both.

**Cost.** The redemption leg requires JavaScript. `<noscript>` gets an honest
message; the console is a React SPA and is unusable without JS regardless.

**Challenge this if:** you think a same-origin `POST` from a page the auth host
rendered could carry the verifier some other way, or you are willing to trade
the verifier for a JS-free flow.

### D2 — Single use is a property of a Firestore transaction, not a policy

**Decision.** `authHandoffs/{rid}` is read and mutated in one
`firestore.runTransaction`. Every validity check — status, expiry, both hashes,
target host, domain liveness — happens **inside** that transaction, and the
transaction always writes to the document it read.

This is the pattern already proven in this repo, at
`apps/console/app/api/_lib/passkeys.ts`, whose comment states the standard this
design adopts verbatim:

> single use is not a policy here, it is a property: a second consume of the same
> id finds nothing, whatever the outcome of the first

**Concurrent redemption.** Firestore transactions are serializable with optimistic
concurrency: two transactions reading and writing the same document cannot both
commit. The loser retries, re-reads `status: 'redeemed'`, and fails cleanly. Exactly
one caller ever receives a custom token. Because the transaction *writes* to the
document it read, the contention is always detected — a read-only check followed
by a write outside the transaction would not be safe, and is the mistake to avoid
in review.

**Deliberately not the rate limiter.** `consumeRateLimit`
(`libs/tenant/data/admin/src/lib/server/rate-limit-store.ts`) is an atomic
Firestore counter and `limit: 1` superficially looks like single-use. It **fails
soft**: on a Firestore error it silently falls back to a per-instance in-memory
limiter and returns `degraded: true`. A handoff token whose single-use guarantee
evaporates during a Firestore blip is a replayable session token. The rate
limiter is used here only for volume control (see D9), never for uniqueness.

**Cleanup.** `expiresAt` as a Firestore `Timestamp`, matching the idiom in
`passkeys.ts` and `rate-limit-store.ts`, plus a TTL policy added to
`docs/FIRESTORE_MANUAL_CONFIG.md`. That doc already warns TTL deletion is
best-effort within ~72h, so **expiry is enforced in code and TTL is hygiene
only** — never the other way round. (Note: `webauthnChallenges` is not in that
doc's enabled-TTL table today; `authHandoffs` must be, or expired records
accumulate forever.)

### D3 — Origin binding, and who may register a domain at all

Origin binding has two halves, and conflating them is how this goes wrong.

**Half one: the record names its target, and the target is checked at redemption.**
`authHandoffs/{rid}.targetHost` is written at initiation from the host the
request actually arrived on, and redemption requires `requestHost ===
targetHost`. The authorize step separately requires that `targetHost` still
resolves to `orgId` in `consoleDomains`, is `status: 'active'`, and that the org
still passes `checkEntitlement(org, 'whiteLabel')`.

**Half two — and this is the load-bearing one: an unbound token is a
theft primitive even when the attacker controls no domain at all.** If possessing
the token were sufficient, an attacker who obtained it from a log could simply
`POST` it to our own redemption endpoint from their own machine and receive a
`Set-Cookie` for the victim's account. Naming the target origin in the record
does not stop that; only requiring a second secret the attacker does not have
does. That is the verifier cookie, and it is why D1's transport choice and this
decision are one decision, not two.

The two-secret requirement closes each direction:

- **Token leaks from a log / `Referer` / a shoulder.** Useless: `S` alone fails
  the verifier check.
- **Attacker starts the flow themselves, phishes the victim into completing it,
  then redeems** (the attacker holds `V`). Useless: `S` is delivered only to the
  browser that completed sign-in — the victim's.
- **A compromised sibling host under the customer's own apex sets a
  `Domain=.acme-agency.com` cookie named `__aglyn_handoff`.** This *shadows* our
  host-only cookie in the `Cookie` header with no way to tell them apart — the
  precise failure AGL-1259 hit with duplicate `__session` cookies. Mitigation:
  the redemption endpoint hashes **every** value with that name and accepts if
  any matches. That is safe by construction (only the real `V` hashes to
  `verifierHash`) and turns a hijack attempt into a no-op rather than a denial of
  service. Reuse the reasoning, and ideally the shape, of `readCookie` in
  `apps/console/app/api/auth/session/route.ts`.

**What stops an attacker registering an attacker-controlled domain?** Nothing,
today, and this is the sharpest finding in the whole review. `customConsoleDomain`
currently has:

- a shape regex only (`apps/console/app/api/orgs/settings/route.ts`) — no
  reserved-name blocklist, so `aglyn.com`, `app.aglyn.com` and
  `console.aglyn.com` all pass validation today;
- **no uniqueness check** — two orgs can store the same value;
- **no ownership proof** — no DNS TXT, no HTTP challenge;
- and `brandingProfile` is **absent from the denied-key list** in
  `cloud/firebase-firestore.rules` (`match /orgs/{orgId}`, `allow update`), so
  any org owner or admin **on any plan** can write it straight from the client
  SDK and skip the API route's entitlement gate and every validation above.

It is inert only because nothing routes on the value. The moment 1099c routes on
it, that is a live account-takeover surface. So this design has hard
prerequisites, and they are not optional:

1. **DNS ownership proof**, modelled on the SSO path, which already does this
   correctly — `SSO_TXT_PREFIX = 'aglyn-domain-verification='` in
   `libs/tenant/data/admin/src/lib/server/sso-provisioning.ts`, with
   `publishSsoDomains` re-reading the claim and skipping anything whose
   `verified !== true`. Same TXT record, same re-read, applied to
   `consoleDomains`.
2. **Atomic uniqueness**, modelled on `orgSlugs`: claim `consoleDomains/{host}`
   with a `tx.get`-then-`tx.set` inside a transaction, as
   `createOrganization`/`changeOrgSlug` do in
   `libs/tenant/data/admin/src/lib/server/organizations.ts`. A second org
   claiming a live domain gets a 409.
3. **A blocklist**: any name inside `aglyn.com` / `aglyn.io` / `aglyn.app`, any
   bare public suffix, and anything already in `PRODUCTION_DOMAINS`.
4. **`brandingProfile` added to the rules' denied-key list**, so the API route is
   the only writer. This is worth doing on its own merits, immediately,
   independent of 1099 — a bypassable entitlement gate is not a gate.

Even with all four, an attacker *can* verify a domain they genuinely own —
`console.aglyn-support.com`, say — and have a real Aglyn console served on it.
The defence against that is not domain registration, it is **membership**:

> **The auth host must refuse to authorize a handoff unless the signed-in user is
> a member of the org that owns the target host.**

Verified custom-domain status is not sufficient. Under this rule, a victim
phished onto `console.aglyn-support.com` signs in on the genuine
`auth.aglyn.com` — their credential never touches the attacker's origin — and is
then told they have no access to that workspace. The attacker gets nothing. This
single check is what makes the feature safe to sell, and it should be the first
thing a reviewer looks for in the implementation.

Belt-and-braces: an **interstitial on the auth host** naming the destination and
the org ("Continue to Acme Agency at `console.acme-agency.com`") on first handoff
for a given (uid, host), remembered in `.aglyn.com`-scoped storage so repeats are
silent.

### D4 — Replay, clock skew, and TTLs

Two windows, because they answer different questions:

| Window | Value | Reason |
| --- | --- | --- |
| initiate → authorize (`pending`) | **15 min** | The user may type a password, do MFA, verify an email. Generous, and harmless: a `pending` record grants nothing. |
| authorize → redeem (`authorized`) | **120 s** | One `location.replace` and one same-origin POST. Anything slower is a broken flow, not a slow user. |

**Replay** is closed by D2 — the record is consumed. The TTL is defence in depth
for the case where a record is authorized and then never redeemed.

**Clock skew is not a threat in this design, and the reason is structural:
no timestamp originates in a browser.** Both legs execute on our own serverless
runtime and compare `Date.now()` against a value another instance of the same
runtime wrote. Vercel/GCP hosts are NTP-disciplined; skew is milliseconds against
a 120-second window — three orders of magnitude of headroom. There is no
skew-tolerance parameter to tune, and adding one would only widen the replay
window. The client-supplied inputs (`rid`, `S`) are opaque and carry no
timestamps to lie about.

The one real clock dependency is inside Firebase's own
`createSessionCookie`/`verifySessionCookie`, which validate `iat`/`exp` against
Google's clock. That is already how every session on the platform works and this
design does not change it.

### D5 — The failure path

AGL-1099 is right that "a confusing failure here will read as *the product is
broken*". Failures are classified and each gets specific copy and a specific
next action. Where the message is shown matters: a failure that means "you may
not be here" must be shown on **`auth.aglyn.com`**, under our own branding, both
because we can say it honestly there and because the custom domain may be exactly
the thing that is suspended.

| Cause | Where | What the user sees | Next action |
| --- | --- | --- | --- |
| `authorized` record expired (>120 s) | custom domain | "That took too long. Signing you in again…" | one silent automatic retry, then stop |
| already redeemed **and a valid session exists** | custom domain | *nothing* — proceed | continue to `continuePath` |
| already redeemed and no session | custom domain | as "expired" | one silent retry |
| verifier cookie missing (blocked, cleared, different browser, QR-to-phone) | custom domain | "Finish signing in from the same browser you started in." | link to start over |
| not a member of the owning org | **auth host** | "Your account doesn't have access to *Acme Agency* at `console.acme-agency.com`." | button → `app.aglyn.com` |
| org not entitled / domain suspended | **auth host** | "`console.acme-agency.com` isn't active right now." | button → `{slug}.aglyn.com` |
| domain unknown / detached | middleware | 308 → `app.aglyn.com` | — |
| JS disabled | custom domain | `<noscript>`: "This page needs JavaScript." | — |

The "already redeemed **and** a valid session exists → say nothing" row is not a
nicety. The single most likely way a user meets this error is pressing Back onto
a spent handoff URL. Treating that as a failure would manufacture a scary error
out of a working session.

**Loop breaking is not optional.** AGL-466 is a redirect loop on exactly this
shape of flow, and AGL-465's fix already ships the breaker:
`recordDelegationBounce()` / `clearDelegationBounces()` in
`apps/console/utils/auth-delegation.ts` — 3 bounces in a 30 s window, backed by
`sessionStorage`, failing open when storage is unavailable. **Reuse it. Do not
write a second one.** On cap, render a terminal page with a support link rather
than bouncing again.

AGL-466's other lesson transfers directly and must not be re-learned: on the auth
host, the `.aglyn.com` `__session` mint must be **awaited before** the
cross-origin navigation. A fire-and-forget mint racing `location.replace` is what
caused that loop. The handoff `authorize` call sits in the same place and has the
same hazard.

### D6 — Session lifetime and revocation on the custom domain

**The session cookie is a Firebase session cookie minted by the existing route.**
`POST /api/auth/session` already does the email-verification gate (AGL-479), the
impersonation exemption (AGL-480), the SSO tenant sidecar (AGL-1101), the device
alert (AGL-665) and the tombstone-clearing repair (AGL-1142). Forking any of that
for custom domains would guarantee drift. Three changes to that route, no more:

1. **A distinct cookie name — `__console_session`, not `__session`.** Different
   scope, different lifetime, different revocation rules; sharing the name across
   the boundary invites exactly the AGL-1259 duplicate-cookie confusion.
2. **Fix `cookieAttributes`.** It currently reads:
   ```ts
   ...(onWorkspaceDomain ? [`Domain=.${WORKSPACE_DOMAIN}`, 'Secure'] : [])
   ```
   Two independent questions collapsed into one ternary: "should this cookie be
   parent-scoped?" and "is this connection HTTPS?". They are not the same
   question, and — measured on production 2026-08-09, not inferred — they
   already disagree:

   ```
   DELETE https://aglyn-console-aglyn.vercel.app/api/auth/session
     set-cookie: __session=signed-out:…; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax
                                                      ↑ no Domain, and no Secure
   ```

   `Secure` must key on the request being HTTPS (or on
   `NODE_ENV === 'production'`), never on the domain. See §5 for why this is
   currently harmless and why that stops being true on a custom domain.
3. **A host gate for custom domains.** `rejectUnknownWorkspaceHost` returns
   `null` for any host that is not `*.aglyn.com` — so a custom domain sails past
   it today. It needs a sibling that resolves `consoleDomains/{host}` and 421s an
   unknown or suspended one, failing open on a Firestore outage exactly as the
   existing guard does (the Vercel allowlist is the boundary; this is defence in
   depth).

**Lifetime: 1 hour, not 14 days.** And the reason it costs nothing is the next
decision.

**In-memory Firebase persistence on custom console domains.** Initialize auth
there with `initializeAuth(app, { persistence: inMemoryPersistence })` and **no
`popupRedirectResolver`**. This one line does four things:

- **Nothing durable is left on an origin someone else may take back.** This is
  the real detach risk, and it is worse than the one AGL-1099 names. If a custom
  domain is detached and its owner re-points the DNS at their own server, that
  server can read the origin's IndexedDB — which under default `local`
  persistence holds a **Firebase refresh token** for every user who signed in
  there. That is a durable account-takeover primitive that no cookie TTL, and no
  server-side revocation short of `revokeRefreshTokens`, can reach. In-memory
  persistence means the only credential that survives a tab close is our
  `HttpOnly` cookie, which we *can* invalidate.
  **This property is not self-enforcing** — a single `setPersistence(auth,
  browserLocalPersistence)` puts the refresh token straight back on disk, no
  error and no warning (PoC §4), and the console already makes that call in six
  places. So the instance is not built with a bare `initializeAuth`: build it
  with `createAuthInstance(app, 'ephemeral')`
  (`libs/tenant/feature/instance/src/lib/hooks/firebase/auth-persistence.ts`),
  which seals `setPersistence` shut on the instance (AGL-1379). Second Firebase
  apps on the same origin — `apps/console/hooks/use-presence.ts` is the one that
  exists — must inherit the class via `useAuthPersistence()` rather than take
  the SDK default.
- **The 1-hour cookie TTL becomes free.** Each page load already bootstraps from
  the cookie via `GET /api/auth/session` → custom token →
  `signInWithCustomToken`, which is the mechanism workspace subdomains have used
  since AGL-236. An expired cookie triggers a silent re-handoff (the user still
  holds a live `.aglyn.com` session, so it is two redirects with no interaction),
  and it cannot interrupt work mid-session because there is no mid-session cookie
  read.
- **Interactive OAuth becomes structurally impossible** on the custom domain
  rather than merely unused. Without a `popupRedirectResolver`,
  `signInWithPopup` / `signInWithRedirect` / `getRedirectResult` throw instead of
  silently trying — so the domain can never need a Firebase authorized-domain
  entry (see §5).
- **The auth helper iframe is never loaded** there, so the custom domain never
  needs to appear in anyone's `frame-ancestors`.

**Cost:** one extra round trip per full page load. The console is an SPA; full
loads are rare.

**And the same for the Firestore cache — the credential was never the only
durable thing on that origin (AGL-1456).** `initializeFirestore` enabled
`persistentLocalCache({ tabManager: persistentMultipleTabManager() })`
**unconditionally, on every host**, and the PoC measured what that puts on the
origin: full document bodies under `firestore/<app>/<project>/main →
remoteDocumentsV14`, plus `firestore_clients_*`, `firestore_online_state_*` and
`firestore_sequence_number_*` in `localStorage` (§5 of the PoC findings). The
reasoning above — *the customer can re-point the DNS and read this origin* — is
exactly as true of every org, host, member and settings document the console
cached there. Hardening the key while leaving the safe open is not a defensible
place to stop.

So the same declaration governs both. `FirebaseServicesProvider`'s
`authPersistence` prop selects the `Auth` persistence class **and** the
Firestore `localCache`, via `localCacheFor()` in
`libs/tenant/feature/instance/src/lib/hooks/firebase/firestore-cache.ts`:
`durable` → `persistentLocalCache`, unchanged on `*.aglyn.com`; `ephemeral` →
`memoryLocalCache`, so nothing reaches disk. **One prop, not two** — a separate
`firestoreCache` prop would let 1099c declare a domain `ephemeral` for auth and
still hand it a persistent cache, which is the exact split that produced this
gap.

The memory cache takes `memoryLruGarbageCollector()` rather than the eager
default. Both are memory-only, so the security property is identical, but the
eager collector drops a document the instant its listener unmounts — the LRU one
keeps the working set in the JS heap and recovers most of the intra-session
saving. **The residual read cost is real and is accepted:** a *cold* page load on
a custom console domain re-reads its working set where a durable origin resumes
from disk, and tabs no longer share one backend connection through
`persistentMultipleTabManager`. Against AGL-1440's ~40–60K reads/day that is a
rounding error at Enterprise volumes, and it is the right trade for an
Enterprise-only feature — but it is a trade, not a free win.

**Hard revocation: an epoch on the domain record.** `consoleDomains/{host}` gets
`sessionEpoch` (epoch ms). Both the redemption endpoint and the `GET` exchange
require `decodedSessionCookie.iat * 1000 >= sessionEpoch`. Bumping the epoch
invalidates every outstanding cookie for that host instantly, at our boundary —
and our boundary is the *only* place a Firebase session cookie has any value,
because it is opaque and can only be cashed by `verifySessionCookie` under our
Admin credentials.

The extra Firestore read is free: resolving `host → orgId` is already required on
every request to a custom domain, and the epoch lives on the same document. Cache
it for 60 s exactly as `middleware.ts` caches slug verdicts — which means up to
60 s of stale acceptance after a bump. That is the stated, accepted bound.

**What revocation still does not cover, stated honestly.** A user signed in on a
custom domain holds a Firebase ID token valid for up to 1 hour, refreshed
directly against Google. Nothing we do to cookies touches it. The only global
lever is `revokeRefreshTokens(uid)`, which signs the user out everywhere. This is
already true of workspace subdomains and this design does not make it worse — but
it does mean the honest bound on "the domain stops working for an already-open
tab" is **≤1 hour**, not "immediately". With in-memory persistence, closing the
tab ends it.

### D7 — Downgrade and detach

Today, downgrade does **nothing** to custom domains. Verified: nothing calls
`/api/domains/detach` or the Vercel `DELETE` on a plan change; the Stripe webhook
(`apps/console/app/api/billing/webhook/route.ts`) writes `plan` and states
explicitly that entitlements resolve at read time so no fan-out is needed. For
tenant custom domains that is *defensible* — the domain keeps serving a site the
customer already published. For a **console** domain it is not, because the domain
is an authentication surface.

The lifecycle, therefore:

| Event | Effect |
| --- | --- |
| **Downgrade** (plan or `resolveEffectivePlan` → `free` on a dead subscription) | `consoleDomains/{host}.status = 'suspended'`, `sessionEpoch = now`. Middleware 308s the host to `{slug}.aglyn.com` with a banner — not a 404. Vercel domain **retained** for a 7-day grace so re-upgrading is instant and the customer's DNS never dangles. |
| **Grace expiry** | Vercel domain removed; `consoleDomains` doc deleted; the reCAPTCHA allowlist entry reclaimed. |
| **Detach** (explicit) | `sessionEpoch = now` **first**, then Vercel `DELETE`, then delete the doc. Order matters: kill the sessions while we still control the host. |
| **Re-registration** by anyone, later | `sessionEpoch = now` on claim, so no cookie minted under a previous owner can ever be redeemed. |

A 308 rather than a 404 on suspension is a deliberate product call: the user
lands somewhere that works and is told why, instead of meeting a dead hostname
that reads as an outage. Challenge the 7-day grace if you think a billing hole
that stays open for a week is worse than a customer whose console vanishes the
moment a card declines.

**Why none of these rows needs a "clear the Firestore cache" step (AGL-1456).**
The obvious other fix for the cache was to have detach instruct the client to
call `clearIndexedDbPersistence`. It does not work, and the reason is worth
recording so nobody re-proposes it: a detach is a **server-side** event, and the
browser that holds the cache may never load that origin again. Clearing on
detach can only reach a client that comes back — and a client that comes back
is not the threat. The threat is the browser profile that already stopped
visiting, sitting on a laptop, holding document bodies for an origin whose DNS
has since moved.

The cache being memory-only from the start is the only version of this that does
not depend on the attacker's victim revisiting. It also makes the whole class of
question moot at **suspension** time, where it would otherwise be sharpest:
AGL-1436 asks how long a lapsed org keeps serving, and every day of grace is a
day a console keeps *caching*. With `memoryLocalCache` the grace window is a
pure billing-and-availability question again — whatever number AGL-1436 lands
on, it does not also decide how much customer data accumulates on a domain the
org may be about to stop paying for. That is a decision made smaller, not a
decision made.

### D8 — What is reused, and the two things worth extracting

**Extend shared libs, never re-implement.** What already exists and is reused
as-is:

| Need | Existing thing |
| --- | --- |
| single-use consume | the transaction shape in `apps/console/app/api/_lib/passkeys.ts` |
| loop breaker | `recordDelegationBounce` / `clearDelegationBounces`, `apps/console/utils/auth-delegation.ts` |
| session mint / exchange / tombstones | `apps/console/app/api/auth/session/route.ts`, unchanged except D6's three items |
| duplicate-cookie robustness | `readCookie`'s reasoning, same file |
| entitlement gate | `checkEntitlement(org, 'whiteLabel')`, `libs/aglyn/src/lib/app-utils/plan-entitlements.ts` |
| DNS ownership proof | `SSO_TXT_PREFIX` + `publishSsoDomains`, `libs/tenant/data/admin/src/lib/server/sso-provisioning.ts` |
| atomic name claim | the `orgSlugs` transaction in `libs/tenant/data/admin/src/lib/server/organizations.ts` |
| Vercel domain attach/detach against the **console** project | `attachWorkspaceDomain` / `detachWorkspaceDomain`, `libs/tenant/data/admin/src/lib/server/workspace-domains.ts` — already uses `VERCEL_CONSOLE_PROJECT_ID`, already has a 5 s deadline, already never throws |
| host-verdict lookup pattern | `/api/orgs/slug-verdict` + the 60 s `slugCache` in `apps/console/middleware.ts` |
| volume control | `consumeRateLimit`, `libs/tenant/data/admin/src/lib/server/rate-limit-store.ts` |

Two extractions this design should pay for, because both are already duplicated
and both are security-critical:

1. **`consumeOnce(firestore, collection, id, validate)`** — the `passkeys.ts`
   transaction is private and lives in an app. Lift it to
   `@aglyn/tenant-data-admin` beside `edit-access-token.ts` and have both callers
   use it.
2. **A shared constant-time `safeEqual`** — the length-check-then-`timingSafeEqual`
   dance is hand-written in at least six files (`media-signing.ts`,
   `edit-access-token.ts`, commerce `download.ts`, `membership.ts`,
   `workflows/server.ts`, `apps/console/utils/cron-auth.ts`). Getting the length
   check wrong throws a 500 where a 401 belongs, on attacker-controlled input.

**Note on the closest prior art.**
`libs/tenant/data/admin/src/lib/server/edit-access-token.ts` solves a
strikingly similar problem — cross-domain, no shared cookie, HMAC-signed with the
shared fail-closed `TOKEN_SIGNING_SECRET`, namespaced by an `edit-bar:` prefix. It
is the right model for *stateless capability* tokens and the wrong model here, and
the distinction is worth stating: a handoff must be **single-use**, single-use
requires a server-side record, and once you have the record the signature buys
nothing. So the handoff token is **opaque random bytes plus a stored SHA-256**,
following `hashApiKey` / `generateApiKeyToken` in
`libs/tenant/data/admin/src/lib/server/api-keys.ts` — not a signed claims blob.
No new signing key, no new secret to keep in step across two Vercel projects.

### D9 — Rate limiting and CSRF posture

The repo's posture is *rate limiting fails soft, CSRF fails closed*, and there is
no CSRF module — it was **deleted** in `11eeed94e` (AGL-919) for having zero
callers, after shipping with a fail-open `CSRF_SECRET || ''` default. Nothing here
argues for bringing it back.

**Where this design needs fail-soft:** `/auth/handoff/start` and
`/api/auth/handoff/authorize` get `consumeRateLimit` keyed on IP and on uid
respectively — volume control only. If Firestore is down and the limiter
degrades, the flow should still work; correctness never rests on it.

**Where this design needs fail-closed:** `/api/auth/handoff/redeem`. It gets
three independent closed gates:

1. `Origin` must equal `https://{targetHost}`, **and** `Sec-Fetch-Site` must be
   `same-origin` when present. Absent or mismatched → reject. (There are no
   `Sec-Fetch-*` checks anywhere in the repo today; this would be the first, and
   it should be written as a small shared helper rather than inline.)
2. The request body must carry `S`, which a cross-site attacker cannot read or
   guess — this is the same reasoning the console already relies on for
   bearer-token routes ("a cross-site caller cannot read or forge the
   Authorization header", `apps/console/app/api/auth/passkeys/register/options/route.ts`).
3. The atomic consume (D2).

A forged cross-site POST to `/redeem` has nothing to put in the body. **CSRF is
not a live risk here and no CSRF module is needed** — but gate 1 must genuinely
reject rather than warn, or the property is only claimed.

---

## 4. Data model

```
consoleDomains/{host}                       # host is the lowercased FQDN
  orgId          string
  status         'pending' | 'verified' | 'active' | 'suspended'
  txtToken       string                     # aglyn-domain-verification=<token>
  verifiedAt     Timestamp | null
  activatedAt    Timestamp | null
  sessionEpoch   number                     # epoch ms; bump to revoke
  vercelState    'attached' | 'pending' | 'detaching'
  createdAt / updatedAt

authHandoffs/{rid}                          # rid = crypto.randomUUID()
  targetHost     string
  orgId          string
  continuePath   string                     # validated: starts '/', not '//'
  verifierHash   string                     # sha256(V), hex
  secretHash     string | null              # sha256(S), written at authorize
  status         'pending' | 'authorized' | 'redeemed'
  uid            string | null              # written at authorize
  tenantId       string | null              # SSO sidecar, AGL-1101
  createdAt      number
  expiresAt      Timestamp                  # TTL policy; 15 min, then 120 s
  authorizedAt   number | null
```

Firestore rules: both collections `allow read, write: if false` — Admin SDK only,
matching `ssoDomains`. Deliberately **not** public-read like `orgSlugs`; nothing
client-side needs them, and `orgSlugs` is public only because it doubles as the
health probe.

Cookies on the custom domain, all host-only (no `Domain` attribute), all
`HttpOnly; Secure; SameSite=Lax; Path=/`:

| Cookie | Lifetime | Contents |
| --- | --- | --- |
| `__aglyn_handoff` | 15 min | `V` — 32 random bytes, base64url |
| `__console_session` | 1 h | Firebase session cookie |
| `__console_session_tenant` | 1 h | GCIP tenant sidecar, mirroring `__session_tenant` |

---

## 5. Grounding — what was verified, and what could not be

### Firebase authorized domains: no documented size limit, **and this design does not need them**

I could not find an authoritative limit. `firebase.google.com/docs/auth/limits`
enumerates account, email, SMS and API-rate quotas and says nothing about
authorized domains. The Identity Platform quotas page states "There is no limit
on the number of identity providers allowed per project or tenant" and makes no
corresponding statement about authorized domains. **Stating plainly: I do not
know whether a limit exists, and neither page implies one either way.** If the
business decision depends on it, it needs a support ticket, not a search.

It matters less than AGL-1099 assumes, because **under this design a custom
console domain never runs interactive OAuth** — sign-in always happens on
`auth.aglyn.com`, and D6's `initializeAuth` without a `popupRedirectResolver`
makes any other path throw. Authorized domains gate OAuth redirect/popup
operations; `signInWithCustomToken` is a direct Identity Toolkit call and is not
gated by them. So item 2 of AGL-1099's requirement list, and most of item 3,
should not be needed at all.

**Both of those claims must be proved by a throwaway proof-of-concept before
1099b starts**, because the whole scope reduction rests on them:

- serve a page on a hostname that is *not* in the authorized-domain list, run
  `initializeAuth(app, { persistence: inMemoryPersistence })` with no resolver,
  call `signInWithCustomToken`, and confirm it succeeds;
- confirm the network log shows **no** request to `auth.aglyn.com/__/auth/iframe`.

> **Both were run — see `docs/design/agl-1099a-poc-findings.md`.** Both pass, and
> the bet holds. Three corrections come back from it and are *not* yet folded
> into the text below: (a) App Check is **enforced on Identity Platform**, so the
> reCAPTCHA allowlist entry is a hard functional prerequisite rather than only a
> commercial ceiling — which makes 1099d a blocker for 1099c; (b) the
> `initializeAuth` config blocks the **federated** family only — password, phone
> and passkey sign-in all still run on the custom domain, and six existing
> `setPersistence(auth, browserLocalPersistence)` calls will silently re-persist
> a refresh token there, so "structural" overstates it; (c) Firestore's
> `persistentLocalCache` writes document bodies to the same origin's IndexedDB,
> so D6's "the only credential that survives a tab close is our `HttpOnly`
> cookie" is true of credentials but not of the origin.
>
> (b) and (c) are now **built**: (b) as the `setPersistence` seal (AGL-1379),
> (c) as the host-conditional `localCache` (AGL-1456) — both folded into D6
> above. (a) remains open and is still 1099d's blocker.

### The allowlist that *is* the real ceiling: App Check's reCAPTCHA key

`libs/shared/util/fbclient/src/lib/firebase-app.ts` initializes App Check with
`ReCaptchaV3Provider`. The console reads Firestore **client-side**, and App Check
gates those reads — and an App Check failure surfaces as a *permission denied*,
not as anything naming App Check. A measurement on 2026-08-03 recorded "Verify
the origin of reCAPTCHA solutions" as **checked**, with **9 entries**:
`aglyn.com`, `localhost`, `vercel.app`, `aglyn.io`, `tenant.aglyn.app`,
`console.aglyn.io`, `app.aglyn.io`, `admin.aglyn.io`, `auth.aglyn.io`.

So **every custom console domain needs an entry on that key**, and this — not
Firebase authorized domains — is the per-customer provisioning step and the
commercial ceiling. Google's documentation for keys managed in Cloud is explicit:
"You can add up to a maximum of 250 domains", with the escape hatch being to
disable domain verification entirely, which the same page calls "a security risk
because there are no restrictions on the site".

#### Can the allowlist be managed by API? Measured 2026-08-09: **no, not today**

Both caveats above are now settled, and the answer is the one that costs money.

**The key is a classic reCAPTCHA v3 key, not a Cloud-managed one.** Read from
App Check's own configuration rather than inferred:

```
GET firebaseappcheck.googleapis.com/v1/projects/aglyn-main/apps/{webAppId}/recaptchaV3Config
→ 200  { siteSecretSet: true, tokenTtl: "86400s", minValidScore: 0.5 }

GET .../recaptchaEnterpriseConfig
→ 200  { tokenTtl: "3600s", riskAnalysis: { minValidScore: 0.5 } }   ← no siteKey
```

`siteSecretSet: true` is the tell: a classic v3 config needs the **site secret**
pasted in, an Enterprise config needs only a site key. The Enterprise resource
exists but carries no `siteKey`, so it is an unconfigured default. The client
agrees — `new ReCaptchaV3Provider(...)` at
`libs/tenant/feature/instance/src/lib/hooks/firebase/firebase-services.tsx:247`
and `apps/console/hooks/use-presence.ts:208`; `ReCaptchaEnterpriseProvider`
appears nowhere in the tree.

**Classic keys have no management API.** Domains are edited only in the
reCAPTCHA admin console UI. The API that *can* do it —
`recaptchaenterprise.googleapis.com` `projects.keys.patch`, writing
`webSettings.allowedDomains` (250 max, or `allowAllDomains` to switch enforcement
off) — addresses keys as `projects/{project}/keys/{key}`, so it can only reach a
key that lives in a project we hold IAM on. Ours does not:

```
gcloud services list --enabled --project aglyn-main | grep recaptcha   → 0 rows
  (same for aglyn-app, aglyn-org)
gcloud recaptcha keys list --project aglyn-main
  → SERVICE_DISABLED  reCAPTCHA Enterprise API has not been used in project aglyn-main
```

**And that is not a switch we can flip.** The 2026-08-03 note is right that the
key was auto-migrated to a Google-created GCP project whose **ownership
invitation is unaccepted**. Google's migration documentation draws exactly this
line: existing v2/v3 keys keep working without accepting the invitation, *"however,
to manage the keys, such as to create, delete, or modify them, you must accept
the project."* That matches what we observed — the admin-console UI still edits
the key (a `vercel.app` entry was removed on 2026-08-09 and sign-in broke on
those hosts as intended), while no API path exists.

**So the per-customer allowlist entry is a manual console click, and that is a
commercial fact, not a scheduling one.** It gates the feature per customer, on
top of the 250 ceiling.

Two routes unblock it, and **both are account actions belonging to the project
owner, not to this codebase**:

1. **Accept the GCP project-ownership invitation** for the migration project.
   The key becomes manageable by `projects.keys.patch` there.
2. **`projects.keys.migrate` the key into `aglyn-main`**, where owner IAM already
   exists. The API requires the caller to be an owner of the reCAPTCHA key *and*
   to hold reCAPTCHA Enterprise Admin in the destination project, and it is a
   write against the live key — so it is a deliberate decision, not a probe.

Either route also changes the *shape* of the automation: once the key is
API-manageable, adding a domain on attach and reclaiming it on detach is a small
mechanism driven off the stored `consoleDomains` claim. Until then, no mechanism
should be built, because a half-built one that records a manual step is the wrong
mechanism the moment the invitation clears.

**250 is a real ceiling for a white-label product and it should be established
before the feature is sold** — that instinct in AGL-1099 is right; it just
pointed at the wrong list. The documented 250 applies to Cloud-managed keys; no
figure is published for classic v3 keys, so the ceiling is unknown for the key we
actually run.

### A third allowlist nobody has named: GCP API-key referrer restrictions

Settled 2026-08-09, from the key's own configuration rather than by probing it.
`aglyn-main` holds exactly one API key — "Browser key (auto created by Firebase)"
— and it carries **an API-target restriction and no referrer restriction at all**:

```
gcloud services api-keys list --project aglyn-main
  restrictions.browserKeyRestrictions.allowedReferrers  → (empty)
  restrictions.apiTargets[].service                     → 50 services, incl.
    identitytoolkit.googleapis.com, securetoken.googleapis.com, firestore, appcheck
```

This agrees with the PoC's black-box result — a hostile `Referer` passed key
validation on `securetoken.googleapis.com`. **There is no third allowlist. A
custom console domain needs nothing here.** The caveat is that a referrer
restriction *could* be added later and would break every custom domain at once
with a generic Identity Toolkit rejection, so this is a constraint to record, not
a step to automate.

### `frame-ancestors` — measured 2026-08-09: **nothing is needed, on either side**

`security-origins.js:48-77` is a static `PRODUCTION_DOMAINS` list with no
wildcards and no database read; `baseCspDirectives()` at `:88-93` turns it into
`object-src 'none'; base-uri 'self'; frame-ancestors {list}`. It is emitted once
per response by `apps/console/middleware.ts:205-208` and once by
`apps/tenant/middleware.ts:294-295`. No `X-Frame-Options` is set anywhere, and no
`frame-src` directive exists, so nothing constrains what either app may frame.

**Console side: no entry, and adding one would be backwards.** `frame-ancestors`
governs who may frame *you*. Putting `console.acme-agency.com` in
`PRODUCTION_DOMAINS` would only make the console framable from that origin. Its
absence is the correct posture.

**Tenant side: the premise is false.** This section previously assumed the
console frames a tenant surface. It does not:

- the besigner canvas is a `div` —
  `libs/besigner/feature/designer/src/lib/components/viewport-frame.component.tsx:58`,
  and `libs/besigner` contains no iframe at all;
- the preview mounts the tenant runtimes in-process, same origin —
  `apps/console/components/document-preview.component.tsx`;
- `apps/console/components/besigner-iframe.component.tsx` — the one component
  that *would* frame a tenant origin — has **no importer** anywhere in the tree,
  and the `AGLYN_SILOED_HOST` it reads is empty;
- marketplace plugin iframes never execute console-side; the resolved
  `listingId`/`version`/`sha256` a `PluginFrame` needs are injected only by the
  tenant compose pass (`libs/tenant/runtime/src/lib/compose-screen-nodes.ts:300`).

Combined with the PoC's measurement of **zero `/__/auth/` requests**, the CSP half
of AGL-1099 item 3 is closed. One latent constraint survives and is worth
recording: `tools/plugin-loader/origin/api/load.mjs:26` hard-codes
`frame-ancestors https://app.aglyn.com https://*.aglyn.app`, widened per-site by
`sanitizeAncestors()` from a *tenant* `hosts/{hostId}.cname`. If a live plugin
ever has to render inside a custom-domain console, that is the one file needing a
`consoleDomains`-keyed entry — a future constraint, not a current blocker.

### Are the two defects in D6 latent or live? Measured 2026-08-09: **live, and currently harmless**

Worth settling, because if a non-`*.aglyn.com` host can reach the cookie path
today then the missing `Secure` is a present exposure rather than a future one.

The `aglyn-console` Vercel project (`prj_gEzxEXc0Lhs81rmaXIg2a1GbsDfl`) carries
fourteen domains, of which three classes are not `*.aglyn.com`. Each was probed:

| Host class | `GET /` | `POST /api/auth/session` | Verdict |
| --- | --- | --- | --- |
| `*.aglyn.io` — incl. apex, `app.`, `auth.`, `console.`, `admin.`, and invented labels | 308/307 → `.aglyn.com` | 308/307 → `.aglyn.com` | **safe** — redirected at the edge, the app never runs on a `.io` host |
| `app-aglyn-io.vercel.app` | 307 → `app.aglyn.com` | — | **safe** |
| `aglyn-console-aglyn.vercel.app`, `aglyn-console-git-production-aglyn.vercel.app` | **200** | **401 `Unauthenticated`** | **reachable — both defects fire** |

On that last pair, `GET /signin` returns `200` with `<title>Sign in · Aglyn</title>`
and `x-matched-path: /signin` — a real console — the `401` proves
`rejectUnknownWorkspaceHost` returned `null` and the request reached the handler,
and the `DELETE` probe above shows `cookieAttributes` omitting `Secure`.

**Note the `*.aglyn.io` wildcard is still attached** and looks like AGL-1135
waiting to repeat. It is not: `billing-security-update.aglyn.io/signin` returns
`308 → https://app.aglyn.com/signin`, so the wildcard resolves to a redirect
rule, not to the app. That is a materially different posture from the
`*.aglyn.com` wildcard AGL-1135 removed, which served the console directly.

**Why the missing `Secure` is not exploitable today, and why that is not
reassuring.** The host sends
`strict-transport-security: max-age=63072000; includeSubDomains; preload`,
`http://` 308s to `https://`, and `hstspreload.org` reports `vercel.app` as
`"status": "preloaded"`. So no browser will ever issue a plaintext request to it,
and `vercel.app` is on the Public Suffix List, so a sibling `*.vercel.app` cannot
set cookies for it either. **Vercel's preload entry is doing the job our flag
should be doing.** That protection is not ours and does not transfer to
`console.acme-agency.com`, where a customer's DNS and TLS posture are outside our
control. Fix the flag before the first custom domain, not after.

The second defect is genuinely inert today for a different reason:
`rejectUnknownWorkspaceHost` waving through a `vercel.app` host harvests nothing,
because a browser will not attach a `.aglyn.com` cookie to a different
registrable domain. The guard's stated purpose is intact. Its gap is only that it
has **no opinion at all** about non-workspace hosts — fine while none of them
route, wrong the moment one does.

**One live-relevant finding that is not mine to fix:**
`aglyn-console-aglyn.vercel.app` is a fully functional second console on a
non-`aglyn.com` hostname — the AGL-1135 shape on a less credible name. It works
end to end because bare `vercel.app` sits in Firebase's authorized-domain list
(**AGL-1344**, already open) *and* in the App Check reCAPTCHA allowlist. If
AGL-1344 is scoped only to the Firebase list, the reCAPTCHA entry is its second
half and should be removed in the same pass.

### Host → org resolution today, which custom domains must mirror

`apps/console/middleware.ts`: lowercase the `Host`, bail unless it ends in
`.aglyn.com`, reject deeper nesting and `APEX_LABELS`, then call
`/api/orgs/slug-verdict` on **this request's own origin** — never a hardcoded
apex, because a preview deployment must not ask production for a verdict — cached
60 s in-process, `degraded` verdicts honoured but never cached. Known slugs get
the path rewritten to `/{slug}/…` unless the first segment is in
`APEX_PATH_SEGMENTS`; unknown slugs redirect to `app.aglyn.com`; a `movedTo`
tombstone 308s.

Two lessons from AGL-1135 that the custom-domain lookup must copy exactly and for
the stated reasons: (a) **do not read Firestore's REST API from the edge** — App
Check is enforced and returns `403 PERMISSION_DENIED` for every document, which
the old code treated as "known", so arming the gate would have made things
*worse*; go through an Admin-SDK verdict route. (b) **Fail open on an outage** —
the Vercel domain allowlist is the boundary, and a customer's console going dark
because a lookup timed out is worse than the residual exposure.

Custom-domain routing is then: `consoleDomains/{host}` → `orgId` → `orgSlug`,
rewrite to `/{orgSlug}/…` with the same `APEX_PATH_SEGMENTS` exemptions. **One
host pins exactly one org**, enforced by the doc being keyed on the host, and the
org switcher must be suppressed there.

### `/api/domains/*` — reusable, but not by pointing them at the console project

- `attach` (`apps/console/app/api/domains/attach/route.ts`): Bearer + email-verified,
  host-admin via `memberRoles[uid] === 'admin'`, `checkEntitlement(org,
  'customDomain')`, a uniqueness transaction over `hosts.where('cname','==',…)`,
  then `POST v10/projects/{VERCEL_TENANT_PROJECT_ID}/domains`.
- `verify`: pure DNS against pinned resolvers `1.1.1.1` / `8.8.8.8`, **no
  entitlement check and no host-admin check** — any verified console user can
  probe any domain.
- `detach`: reads the domain off the host doc, never the body.

They are shaped around `hosts/{hostId}` and a `cname` field, and the whole
identity model is different: a console domain is keyed on the **domain**, owned by
an **org**, and gated on `whiteLabel` rather than `customDomain`. Re-pointing them
at `VERCEL_CONSOLE_PROJECT_ID` would mean parameterising the auth model, the
entitlement, the uniqueness query and the Firestore shape — at which point it is
not reuse. **Reuse `workspace-domains.ts` instead**, which already talks to
`VERCEL_CONSOLE_PROJECT_ID`, already has a timeout, and already never throws.
AGL-1136 proved the token can add domains to the console project
(`400 invalid_domain`, not `403`).

Also note, and it is a live gap in the tenant path that this design must not
copy: attach and detach perform **no cache invalidation**, and DNS is verified
once at connect time and never re-checked.

---

## 6. Endpoints

| Endpoint | Host | Auth | Purpose |
| --- | --- | --- | --- |
| `GET /auth/handoff/start` | custom | none | resolve host→org, create `pending` record, set `__aglyn_handoff`, 303 to auth host |
| `POST /api/auth/handoff/authorize` | auth | Bearer ID token | membership + entitlement + liveness, flip to `authorized`, return the redirect URL |
| `GET /auth/handoff` | custom | none | fragment-reading shell; `no-store`, `no-referrer` |
| `POST /api/auth/handoff/redeem` | custom | `S` + verifier cookie | consume, return `{ token, tenantId }` |
| `POST /api/auth/session` | custom | Bearer ID token | **existing route**, + D6's three changes |
| `GET /api/auth/session` | custom | `__console_session` | **existing route**, + epoch check |
| `GET /api/orgs/console-domain-verdict` | any | none | Admin-SDK host→org for the middleware |

---

## 7. Test plan (the ones that would actually catch a regression)

1. A redeemed `rid` cannot be redeemed twice — **two concurrent redemptions**,
   asserting exactly one custom token and one clean failure. Run against the
   Firestore emulator; a serial test does not exercise the property.
2. Redemption with a valid `S` and **no** verifier cookie fails.
3. Redemption with a valid verifier and a **wrong** `S` fails.
4. Redemption at host B of a record whose `targetHost` is A fails.
5. A shadowing duplicate `__aglyn_handoff` from a sibling apex does **not** break
   redemption (the all-values hash check) — the AGL-1259 regression.
6. `authorize` refuses when the signed-in user is not a member of the owning org.
7. `authorize` refuses when the org fails `checkEntitlement(org, 'whiteLabel')`.
8. Bumping `sessionEpoch` invalidates an outstanding `__console_session`.
9. `cookieAttributes` emits `Secure` on a custom domain and no `Domain`
   attribute — the regression test for the bug in D6.
10. A cross-site POST to `/redeem` is rejected on `Origin` alone.
11. **`setPersistence` is refused on the custom domain's auth instance** —
    AGL-1379. Not "we passed the right argument to `initializeAuth`", which is
    the assertion that does not survive: the PoC measured `setPersistence(auth,
    browserLocalPersistence)` accepted at runtime on an in-memory instance,
    flipping the refresh token from absent to present in IndexedDB. Built as
    `createAuthInstance(app, 'ephemeral')` in
    `libs/tenant/feature/instance/src/lib/hooks/firebase/auth-persistence.ts`,
    which seals `setPersistence` on the instance itself, so all six existing
    call sites and every future one are covered without being touched. Tests in
    `auth-persistence.spec.ts` (the seal) and `auth-persistence-provider.spec.tsx`
    (that `useAuth()` actually hands out the sealed instance), each with a
    `durable` positive control so the guard cannot silently become a behaviour
    change on `*.aglyn.com`.
12. **The Firestore cache is `memory`, not `persistent`, on the custom domain** —
    AGL-1456, and asserted on the settings object `initializeFirestore` is
    actually handed, with the real SDK factories, so `localCache.kind` is
    Firebase's verdict rather than a shape the test invented.
    `firestore-cache-provider.spec.tsx` (the provider reaches the helper) and
    `firestore-cache.spec.ts` (the tab manager and the LRU collector, neither of
    which `kind` can see), each with a `durable` positive control so this cannot
    silently become a read-volume change on `*.aglyn.com`.
13. **Nothing org-identifying in the origin's browser storage after sign-in** on
    a custom domain — no refresh token *and* no cached document bodies. Still
    owed, and it needs a real browser: jsdom has no IndexedDB, so items 11 and
    12 assert the *guard*, not the *storage*. The PoC's dump harness
    (`docs/design/agl-1099a-poc-findings.md` §5) is the shape to reuse when
    1099c has a domain to run it against, and it should enumerate object store
    names and document paths — the same evidence that found the leak. Until it
    runs, the claim "nothing survives on a customer-controlled origin" is
    argued, not measured.

**Not structural, and the design must not say it is.** D6's `initializeAuth`
blocks the **federated** family and nothing else — `signInWithEmailAndPassword`,
`createUserWithEmailAndPassword` and `signInWithPhoneNumber` all still run on an
in-memory instance (PoC §3). The persistence half is now enforced by the seal
above; the *route* half — a custom console domain must not render `(auth)`
routes — is still route-level discipline owed a test, and belongs to 1099c.

`apps/console/middleware.ts` had **no tests at all** before AGL-1135, which is
most of why that gate shipped disabled and stayed that way for its whole life.
Do not repeat it here.

---

## 8. What this design is *not* proposing

Rejected alternatives, with the reason each door is closed:

1. **Widening the session cookie's `Domain`.** Structurally impossible — no
   shared parent — and `rejectUnknownWorkspaceHost` exists precisely to stop a
   `.aglyn.com` cookie reaching an unregistered host. Not weakened here.
2. **Re-adding a `*.aglyn.com` wildcard, in Vercel or anywhere else.** AGL-1135
   removed it after measuring a real sign-in page at
   `https://billing-security-update.aglyn.com/signin` returning `HTTP 200` under a
   valid Aglyn certificate. Not reversed, not partially reversed.
3. **Running interactive OAuth on the custom domain** — per-customer Firebase
   authorized-domain entries plus a dynamic `frame-ancestors`. This is the
   design's biggest bet against AGL-1099's own item list, and it is rejected on
   three grounds: it mutates global auth config per customer; it needs a CSP
   assembled from a database read on every request; and it puts the credential
   prompt on a customer-controlled origin, which is a phishing surface we would
   be building deliberately. Keeping sign-in on `auth.aglyn.com` means the
   password is only ever typed on an origin we control.
4. **Third-party cookies, `SameSite=None`, CHIPS, or the Storage Access API.**
   Blocked by Safari ITP today and by Chrome's direction. A mechanism that
   depends on them is dead on arrival, and the repo has no `SameSite=None`
   cookie anywhere.
5. **A hidden iframe on the custom domain `postMessage`-ing a token from
   `auth.aglyn.com`.** Same partitioning problem, plus it needs every customer
   domain in `frame-ancestors` — the thing we are avoiding — plus `postMessage`
   origin checks are a classic footgun.
6. **`form_post` for the return leg.** Correct in the abstract, unavailable here:
   a cross-site POST does not carry `SameSite=Lax` cookies, so it destroys the
   verifier binding (D1).
7. **The token in a query string with `Referrer-Policy: no-referrer`.**
   Insufficient alone. The leak we own and cannot audit is our own access logs
   and log drains.
8. **A signed, stateless JWT as the handoff token** (the `edit-access-token.ts`
   model). Single use cannot be enforced without a server-side record; once the
   record exists, the signature buys nothing and adds a key to manage.
9. **Putting a Firebase custom token directly in the redirect URL.** A custom
   token is a one-hour bearer credential that grants a full session. Strictly
   worse than an opaque single-use pointer, in every channel.
10. **Enforcing single use with `consumeRateLimit(key, { limit: 1 })`.** It fails
    soft (D2). Single use must fail closed.
11. **A bespoke opaque server-side session store for custom domains**, i.e. a
    random session id pointing at a Firestore record. Genuinely attractive —
    revocation becomes a delete. Rejected because it forks the session model: two
    schemes to keep in step across tombstones, impersonation claims, the SSO
    tenant sidecar and device alerts. Revisit only if the epoch proves
    insufficient.
12. **Local Firebase persistence on the custom domain.** It leaves a refresh
    token in IndexedDB on an origin whose DNS the customer can re-point at
    themselves (D6).
13. **Serving the custom console domain as a reverse proxy to
    `app.aglyn.com`.** Cookies still would not cross, and it would put the
    customer's infrastructure in a full MITM position over their users' sessions.
14. **Per-org Firebase projects or GCIP tenants for isolation.** Enormous, and
    orthogonal.
15. **Staff impersonation over a custom console domain.** Deliberately blocked at
    `authorize`. A staff session on customer-controlled infrastructure is a
    credential sitting on someone else's server; support can use
    `{slug}.aglyn.com`, which works today.
16. **Re-introducing a CSRF module.** AGL-919 deleted it for having zero callers.
    The fail-closed property this design needs comes from the origin check, the
    unguessable body secret, and the atomic consume (D9).

---

## 9. Where I think AGL-1099's analysis is wrong

Recorded because disagreeing with evidence is more useful than elaborating.

1. **"Firebase Auth authorized domains … worth checking whether that list has a
   size limit before selling the feature" is the right instinct pointed at the
   wrong list.** Under a delegation-only design the custom domain never needs an
   authorized-domain entry. The list with a hard, documented ceiling — 250 — and
   a per-customer provisioning step is the **App Check reCAPTCHA key's** domain
   allowlist, which currently has 9 entries and origin verification switched on.
   That is the commercial ceiling, and it is not mentioned in AGL-1099 at all.
2. **Items 2 and 3 of the requirement list are probably not required.** Both
   Firebase authorized domains and the `frame-ancestors` entry exist to support
   OAuth *on* the custom domain. If sign-in never happens there — and D6 makes it
   structurally impossible, not merely conventional — both fall away. What
   survives of item 3 is a different question entirely: whether the **tenant**
   app's `frame-ancestors` needs the custom console domain so the besigner canvas
   and preview can be framed. 1099d should be rescoped to that.
3. **"A session still valid after detach is worse [than a billing hole]" is
   correct, and for a worse reason than the issue gives.** The problem is not
   that the session keeps working — the session grants exactly what the user's
   normal `app.aglyn.com` session grants, since Firestore rules key on
   membership, not host. The problem is that after detach the customer can
   re-point the DNS at their own server and **harvest credentials the browser
   still holds for that origin**: the `HttpOnly` session cookie on every
   subsequent request, and — under default Firebase persistence — the **refresh
   token sitting in IndexedDB**. The second is the serious one, it is durable,
   and no cookie policy reaches it. That is why in-memory persistence is a
   security decision in this design rather than a performance footnote.
4. **"Reuse `/api/domains/attach|verify|detach`, pointed at
   `VERCEL_CONSOLE_PROJECT_ID`" is the wrong reuse target.** Those routes are
   built around `hosts/{hostId}`, a `cname` field, `memberRoles` admin, and the
   `customDomain` entitlement. A console domain is keyed on the domain, owned by
   an org, and gated on `whiteLabel`. `workspace-domains.ts` already speaks to the
   console project, already has a deadline, and already never throws — that is
   the thing to extend.
5. **The issue treats domain *verification* as "the genuinely easy part, and
   mostly already built".** For tenant domains, yes. For
   `customConsoleDomain` there is today **no ownership proof, no uniqueness
   check, no reserved-name blocklist, and a Firestore-rules hole** that lets any
   org admin on any plan write the field directly from the client, bypassing the
   entitlement gate and every validation. Until those four are closed,
   verification is not the easy part — it is the prerequisite, and the rules hole
   is worth fixing this week regardless of whether 1099 ever ships.
6. **A missing sixth requirement: revocation and lifecycle.** The issue's item 6
   says entitlement "must fail closed when a plan lapses". Nothing in the codebase
   reacts to a plan change at all — the Stripe webhook writes `plan` and says so
   explicitly. Read-time entitlement resolution is elegant and it is genuinely
   sufficient for *rendering*; it is not sufficient for a **hostname**, which
   keeps resolving whatever the plan says. Custom console domains need an
   explicit lifecycle (D7). That is a new work item, not a line in 1099c.

---

## 10. Revised split

- **1099a** — this document. Review it before anything else is written.
- **1099a-pre** — the four registration prerequisites from D3: DNS TXT proof,
  atomic uniqueness claim, reserved-name blocklist, and `brandingProfile` added
  to the Firestore rules' denied-key list. The rules fix should not wait for the
  rest.
- **1099b** — verify + attach a console domain, extending
  `workspace-domains.ts`. Still must not ship alone.
- **1099c** — `consoleDomains` host→org routing, the middleware verdict route,
  entitlement enforcement, and the **D7 lifecycle** (suspend, grace, detach,
  epoch).
- **1099d** — rescoped: the App Check reCAPTCHA allowlist provisioning step and
  its 250-domain ceiling, the GCP API-key referrer question, and tenant-side
  `frame-ancestors` for framing the besigner canvas from a custom console domain.
  **Not** Firebase authorized domains. *Scoped 2026-08-09: two of its three parts
  are now closed as "nothing to build" — the API-key referrer allowlist does not
  exist, and neither `frame-ancestors` needs an entry. What remains is the
  reCAPTCHA allowlist, which **cannot be automated today** and is blocked on an
  account action. See §5.*
- **1099e** — the handoff itself, per this document, plus the two extractions in
  D8.

Before 1099b starts, run the proof-of-concept in §5: a page on an unauthorized
hostname doing `signInWithCustomToken` with `inMemoryPersistence` and no
`popupRedirectResolver`, with the network log showing no `/__/auth/iframe`
request. If that fails, D6 collapses and items 2 and 3 of AGL-1099's list come
back — along with the 250-domain ceiling becoming the whole story.

> **Run — and it passed.** `docs/design/agl-1099a-poc-findings.md`. Two
> orderings changed as a result, and both are binding on everything below.

### The ordering the PoC changed: 1099d **blocks** 1099c

App Check — **not** Firebase's authorized-domain list — is the gate. An
unattested `signInWithCustomToken` is refused `401 UNAUTHENTICATED` ("Firebase
App Check token is invalid") *before* token validation, on any origin. So the
App Check reCAPTCHA key's domain allowlist is a **hard functional
prerequisite**, not the commercial ceiling this document called it: a domain
that attaches and routes but cannot attest produces a console that renders and
can never sign anyone in — precisely the "looks finished" failure AGL-1099
warns against. **Resolve 1099d before the first domain is attached, and do not
start 1099c until it is done.**

### 1099b, as built (AGL-1373)

Landed **dark**: mechanism and tests, no domain attached, no user-facing attach
path, no production configuration touched. `1099a-pre` is folded into it, since
its four prerequisites are the same code.

- `libs/tenant/data/admin/src/lib/server/console-domains.ts` — the
  `consoleDomains/{host}` claim, TXT ownership proof (reusing
  `SSO_TXT_PREFIX` / `resolveChallengeTxt` / `recordsProveOwnership`), the
  reserved-name blocklist, and the `whiteLabel` gate read server-side.
- `workspace-domains.ts` grew `attachProjectDomain` / `detachProjectDomain`,
  which take a fully-qualified name; the workspace-subdomain pair is now that
  primitive with `{slug}.aglyn.com` built for it. One implementation, one
  deadline, one never-throws contract.
- **The twin is claimed in the same transaction as its primary.**
  `attachProjectDomain` tolerating `domain_already_in_use` is only safe while
  the Firestore claim indexes every name Vercel holds; a twin claimed in a
  follow-up write is the AGL-743 hole, and there it meant one org served on
  another org's domain. `consoleDomainNames` derives the set, the transaction
  claims all of it or none, and activation attaches exactly what was claimed.
- `customConsoleDomain` in `/api/orgs/settings` now runs the blocklist and
  takes the reservation, so the field cannot name `aglyn.com` and two orgs
  cannot hold the same value. `brandingProfile` is denied to client writes as
  of AGL-1354, so that route is the only writer and the gate is real.

Still open, and deliberately not built here: everything in D6/D7 that needs the
handoff. The `setPersistence` guard the PoC's §4 asks for has since been built
(AGL-1379), and so has the Firestore cache decision in its §5 (AGL-1456) — both
are wired to the same `authPersistence` declaration, so 1099c switches them
together by passing `ephemeral`, and cannot get one without the other.

### 1099d, as scoped — **nothing was built, and that is the finding**

Scoped 2026-08-09 against the question 1099b left blocking: *can the App Check
reCAPTCHA allowlist be driven by API?* All three parts of 1099d were taken to an
answer, and none of them produced code.

| Part | Answer | Evidence |
| --- | --- | --- |
| App Check reCAPTCHA allowlist | **Cannot be automated today.** The key is classic v3; classic keys have no management API; the Enterprise API cannot reach a key in a project we hold no IAM on | §5 above |
| GCP API-key referrer allowlist | **Does not exist.** No entry is ever needed | §5 above |
| `frame-ancestors`, console and tenant | **No entry needed on either side.** The console frames no cross-origin surface | §5 above |

The consequence is commercial, and it should be stated before the feature is
sold: **each custom console domain requires a manual click in the reCAPTCHA admin
console**, and it is a click no one can delegate to the product. A domain that
attaches and routes without it renders a console that can never sign anyone in.

**No mechanism was built on purpose.** Both routes that unblock automation are
owner account actions, and each one changes what the mechanism should be — an
API-manageable key wants add-on-attach/reclaim-on-detach driven off the stored
`consoleDomains` claim (never re-derived, per 1099b), while a permanently manual
key wants an operator checklist and a refusal to mark a domain `active` before
someone confirms the entry. Building either before the question is settled builds
the wrong one.

**Precondition for resuming 1099d:** the key is manageable by
`recaptchaenterprise.googleapis.com` from a project we own — provable by
`gcloud recaptcha keys list` returning the key. Until that command works, 1099d
has nothing to build, and it still blocks 1099c.

### 1099c, as built (AGL-1099)

Host → org resolution and entitlement enforcement. Lands **dark for the same
reason 1099b did**, and the reason is structural rather than a promise: routing
fires only for a claim in `status: 'active'`, and the only thing that sets that
status is `activateConsoleDomain`, which still has no caller. Until 1099d
clears, no domain can reach the state this code serves.

- `resolveConsoleDomain(host)` in `console-domains.ts` — the single reader.
  Returns `{ known, servable, orgSlug, reason, degraded }`, never the `orgId`.
- `GET /api/orgs/console-domain-verdict` — the Admin-SDK verdict route, sibling
  of `slug-verdict` and unauthenticated for the same reason: the middleware runs
  on the edge, where an App Check-enforced Firestore read returns `403` for
  everything, and AGL-1135 proved a gate that scores `403` as "known" is worse
  than no gate.
- `apps/console/middleware.ts` — the custom-domain branch, 60 s cache, degraded
  verdicts honoured and never cached, and `orgScopedPath` now shared with the
  workspace branch so the two gates cannot drift in how they rewrite.
- `rejectUnknownConsoleHost` in `/api/auth/session` — the D6 item 3 sibling.
  `/api/*` is outside the middleware matcher, so a host the middleware refuses
  to render a console for can still call the route that mints sessions.
- D6 item 2 is fixed: `cookieAttributes` no longer answers "parent-scoped?" and
  "HTTPS?" with one ternary.

**Three answers where a boolean would have been wrong.** `unknown` (no claim)
and `degraded` (Firestore unreachable) both pass the request through, for
opposite causes; every other reason refuses. `unknown` must pass because
localhost, preview deployments and self-hosted installs are indistinguishable
from an unclaimed host — and it is *safe* to pass only because of the
correspondence `releaseConsoleDomain` maintains: Vercel first, documents second,
claim kept if the detach fails. A name the console project answers for always
has a document. **AGL-1430 must not break that**, and neither must a twin.

**Fail closed on downgrade is a write, not a verdict.** Nothing in the codebase
reacts to a plan change — the Stripe webhook writes `plan` and says outright
that entitlements resolve at read time, which is sufficient for rendering and
insufficient for a hostname (D7). So the first request after a downgrade
converts the read-time answer into stored state: `status: 'suspended'` and a
`sessionEpoch` bump across every name the claim covers, so the twin cannot
outlive its primary. A read-time refusal alone would leave already-minted
cookies valid; the epoch is the lever that reaches them. Deliberately not the
inverse — re-upgrading does **not** re-activate, because activation attaches
names to Vercel and, until AGL-1378 clears, includes a manual App Check
allowlist entry.

Two guards against the loading-default class this repo keeps hitting:
`checkEntitlement(undefined)` resolves to the free plan, so a claim whose org
document is *missing* refuses but is **not** suspended — that would be recording
an answer to a question never asked — and a Firestore failure is `degraded`
rather than "not entitled".

**Departure from D7, deliberate: a suspended domain gets a 307, not a 308.**
Suspension is reversible by design and a 308 is cacheable by default and
effectively irreversible in a browser. Committing every visitor's browser to a
permanent redirect off a customer's own domain because a card declined for a day
is a state we could not get back out of — the same property AGL-1430 argues from
in the other direction.

**The route half of "sign-in never happens on the custom domain" is now
enforced**, which §7 item 11 flagged as owed to 1099c: `signin`, `signup`,
`verify-email` and `account-recovery` are 307'd to `app.aglyn.com` on a custom
domain. `signout`, `manage` and `admin` still serve — ending a session on the
host that holds it can never be the wrong answer. When 1099e lands, that
redirect becomes the handoff start rather than a new mechanism.

**Left for a decision, not guessed:**

- **The 7-day Vercel grace and its expiry job.** D7 states the window and then
  invites the challenge — "a billing hole that stays open for a week" versus "a
  console that vanishes the moment a card declines" — which is a commercial
  call, not an engineering one. Suspension (the fail-closed half) is built and
  is what actually stops the domain serving; the reaper that detaches from
  Vercel and deletes the documents is not, because its schedule *is* the
  decision.
- **The org switcher's suppression on a custom domain.** The path rewrite pins
  the org for every route; suppressing the switcher UI is unreachable until a
  session can exist there at all (1099e).
- **The `sessionEpoch` check on the session cookie.** It has nothing to check
  yet: `__console_session` is 1099e's, and no cookie can reach a custom domain
  before the handoff exists. The epoch is written on suspension so it is correct
  the day that check is added.
