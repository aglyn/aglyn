# AGL-1311 — Primary-domain model: apex vs `www`

**Status:** decision memo. Nothing here has been executed; no DNS, Vercel domain
or host configuration was changed while writing it.
**Written:** 2026-08-09. All state below is measured against production on that
date, not inferred from code or from the issue text.

---

## 0. The short version

For **aglyn.com itself the decision is already made and already shipped.** The
apex serves; `www.aglyn.com`, `aglyn.app`, `www.aglyn.app` and `aglyn.io` are all
Vercel project domains configured as `redirect → aglyn.com` with
`redirectStatusCode: 308`. That is a primary-domain model, in production, working,
query-string-preserving. The only thing missing was a written decision saying so.

**Recommendation: ratify apex-primary. Do not switch to `www`.** The argument is
not aesthetic — it is that the `308` already in visitors' browser caches makes a
later reversal the most expensive item on this entire list, and nothing about
`www` buys anything back.

What is genuinely **undecided** is the *customer* case: a customer who connects
`example.com` cannot also serve `www.example.com`. That is the real content of
AGL-1311, and §4 recommends a **derived redirect twin** — reusing the exact
mechanism already proven on `www.aglyn.com` — rather than the data-model change
the issue describes.

Zach's actual decisions are in §7. Two of them are one-line confirmations.

---

## 1. What is true today (measured)

### 1.1 The platform's own hostnames

Vercel project `aglyn-tenant` (`QmVstR8xiYtabTkVo2t9NNsiYY72nSTbNr1MGDLffzZeLn`),
queried through the Vercel API:

| Domain | `redirect` | `redirectStatusCode` | Measured response |
| --- | --- | --- | --- |
| `aglyn.com` | *(none — serves)* | — | `200`, `x-matched-path: /[host]/[[...slug]]` |
| `www.aglyn.com` | `aglyn.com` | `308` | `308 → https://aglyn.com/` |
| `aglyn.app` | `aglyn.com` | `308` | `308 → https://aglyn.com/` |
| `www.aglyn.app` | `aglyn.com` | `308` | `308 → https://aglyn.com/` |
| `aglyn.io` | `aglyn.com` | `308` | `308 → https://aglyn.com/` |
| `*.aglyn.app` | *(none — serves)* | — | tenant subdomains render |
| `demo.aglyn.app` | *(none — serves)* | — | `200` |
| `demo.aglyn.com` | *(none)* | — | `404` (no host doc named `demo`) |

The `www` redirect **preserves path and query**: `https://www.aglyn.com/pricing?utm_source=x&a=1`
→ `Location: https://aglyn.com/pricing?utm_source=x&a=1`. Plain HTTP on either
name upgrades to HTTPS on the *same* name first, then redirects — so `http://www`
costs two hops, which is normal and not worth fixing.

Other platform hosts, unaffected by this decision but worth having in one place:
`app.aglyn.com` (console, `200`), `auth.aglyn.com` (Firebase auth helper, `200`),
`docs.aglyn.com` (docs, `200`).

### 1.2 DNS

`aglyn.com` and `aglyn.app` are both delegated to `ns1/ns2.vercel-dns.com`, and
all four public resolvers checked (8.8.8.8, 1.1.1.1, 9.9.9.9, 208.67.222.222)
agree on that delegation. The apex is served as A records out of Vercel's pool
(`64.29.17.1`, `216.198.79.1`); `www.aglyn.com` is a Vercel-managed CNAME to
`c1a4ad77a8df2c73.vercel-dns-017.com`, which different resolvers flatten to
different pool members (8.8.8.8 returned the `.65` pair, the rest the `.1` pair).
That variance is anycast pool selection, not divergence — both pairs serve:
requests forced to `216.198.79.65` **and** to the legacy `76.76.21.21` both return
`200` for `Host: aglyn.com`.

### 1.3 What the code believes

- **Host resolution** — `apps/tenant/utils/get-host.ts`. Unknown hostnames arrive
  from `apps/tenant/middleware.ts` as a `cname--{hostname}` sentinel (the edge
  runtime cannot reach Firestore) and are resolved with
  `where('cname', '==', …)`. `cname` is a scalar.
- **Canonical origin** — `libs/aglyn/src/lib/app-utils/host-naming.ts`.
  `hostPublicOrigin` prefers `cname`, falls back to `{subdomain}.aglyn.app`.
- **Canonical redirect (AGL-1272, Done)** —
  `apps/tenant/app/[host]/[[...slug]]/load-page-data.ts` emits a **307** from
  `{sub}.aglyn.app` to the live custom domain, guarded by `liveCustomDomain`.
  Verified live: `https://aglyn-marketing.aglyn.app/pricing` → `307
  → https://aglyn.com/pricing`.
- The rendered apex emits `<link rel="canonical" href="https://aglyn.com/"/>` and
  `<meta property="og:url" content="https://aglyn.com/"/>`. **The apex is already
  what the site calls itself**, everywhere it names itself.

**AGL-1272 is half the answer, and it is the *harder* half.** It settled
"platform subdomain vs custom domain" — which of two *serving* names wins. What it
did not settle, and could not, is `www` vs apex *within* the customer's own
domain, because that pair never both reach the app.

### 1.4 How many site-origin reimplementations there really are

AGL-1311 (quoting AGL-1275) says **five** `cname || subdomain` reimplementations,
two drift-tested. The count is **eleven**:

`libs/aglyn/src/lib/app-utils/host-naming.ts:145` · `libs/aglyn/src/lib/app-utils/host-tokens.ts:127` ·
`libs/shared/util/email/src/lib/email-media-src.ts:93` · `apps/console/constants/tenant-links.ts:56` ·
`apps/console/constants/tenant-links.ts:184` · `apps/console/app/(app)/[orgSlug]/hosts/page.tsx:216` ·
`apps/console/app/(app)/[orgSlug]/hosts/[host]/content/page.tsx:179` ·
`apps/console/app/(app)/admin/orgs/[orgId]/host/[hostId]/page.tsx:100` ·
`apps/console/components/media/media-library.component.tsx:367` ·
`libs/plugins/workflows/src/lib/components/host-webhooks-card.component.tsx:108` ·
`apps/tenant/app/[host]/[[...slug]]/page.tsx:365`

Drift tests: `apps/tenant/specs/seo-origin.spec.ts`,
`apps/tenant/specs/canonical-domain-redirect.spec.ts`,
`apps/console/specs/email-media-src-drift.spec.ts` — three, covering three of the
eleven.

This is the single strongest reason to prefer the redirect model in §4: **a
redirect twin requires changing none of the eleven**, because the twin is never a
site origin. The scalar-`cname`-plus-primary-domain model in the issue requires
sweeping all eleven and extending the drift tests first — a materially larger job
than the issue estimated, on a count the issue understated by half.

### 1.5 Customers affected, actually counted

Queried production Firestore (`aglyn-main`) with the Admin SDK:

```
total hosts:        5
hosts with cname:   1
  DXnRbPH4CQ  { subdomain: "aglyn-marketing", cname: "aglyn.com",
                cnameAttachmentPending: null, cnameDetachmentPending: null }
```

**Zero external customers are on a custom domain.** The only custom domain in the
system is our own marketing site. The blast radius of changing the instructions
today is exactly one host, which we control.

---

## 2. The landmines, checked against current state

### 2.1 The legacy A record shadowing the apex ALIAS — *still live, and it argues for apex*

`ns-cloud-b1.googledomains.com` **still answers authoritatively for `aglyn.com`**
(SOA serial 44), 17 days after the 2026-07-23 nameserver switch. AGL-734 is open
and its zone was never deleted. What that zone serves:

| Name | Old Google zone | Vercel zone |
| --- | --- | --- |
| `aglyn.com` | `A 76.76.21.21` (legacy, still served → `200`) | `A 64.29.17.1 / 216.198.79.1` |
| `www.aglyn.com` | **nothing** | CNAME → Vercel |
| `app.aglyn.com` | **nothing** | CNAME → Vercel |
| `auth.aglyn.com` | **nothing** | CNAME → Vercel |

The 48-hour delegation TTL expired around 2026-07-25 and every public resolver
checked has refreshed, so nothing is being served from it today. But note what it
implies for this decision: **the stale zone can still answer the apex correctly
and cannot answer `www` at all.** If `www` were primary and anything ever fell
back to that zone, the site would be unreachable rather than merely slow. That is
a small argument, but it points the same way as every other one.

### 2.2 AGL-1327 (ALIAS-first apex instructions) — consistent, and already committed

AGL-1327 is In Review, but its code has **already landed on main** as
`1c7ec09c1`. `apps/console/utils/tenant-dns.ts` now leads a bare apex with
`ALIAS → sites.aglyn.app`, keeps `A → 216.198.79.1` as an explicitly-labelled
fallback, and `apps/docs/docs/building-sites/custom-domains/connect-a-domain.md`
quotes it.

Nothing in this memo supersedes AGL-1327 — this memo **depends** on it. An
apex-primary recommendation is only comfortable to give because the apex
instruction is now an ALIAS that follows `sites.aglyn.app` rather than a pinned
edge address. Confirming AGL-1327 is a precondition of §7's decision 1, not a
competing choice. (`sites.aglyn.app` currently resolves to `64.29.17.65 /
216.198.79.65`; the verify route accepts the whole pool plus the legacy address,
so ALIAS and A both verify.)

### 2.3 `Disallow: /` and the empty sitemap — untouched

Measured: `https://aglyn.com/robots.txt` returns `User-agent: * / Disallow: /`
and `sitemap.xml` returns an empty `<urlset>`. **This memo proposes no change to
either.** They are one flag and they are the launch gate (AGL-1300, AGL-1263).

They do, however, change the *urgency* of everything SEO-shaped below: while
`Disallow: /` stands, no consolidation signal is being read by anyone, so the
redirect-status-code question in §3 is free to get right now and expensive to get
wrong after launch. Sequencing in §6 is built around that.

### 2.4 The org cutover model — holds

`aglyn.com` for marketing, `aglyn.app` for tenant sites: confirmed. The marketing
site is host `aglyn-marketing` served by the tenant app on `cname: aglyn.com`, and
`{sub}.aglyn.app` is the tenant space. One wrinkle worth naming: **`aglyn.app` and
`www.aglyn.app` are themselves 308-redirected to `aglyn.com`**, so the tenant apex
is not a landing page — deliberate, and consistent with the model.

---

## 3. Decision 1 — which form is primary

### Recommendation: **the apex, `aglyn.com`. Ratify what is already running.**

Not because apexes are nicer. Because of the asymmetry in what it costs to change
your mind later:

**Switching apex → `www` later** means reversing a `308` that browsers have
already cached. `308` is cacheable by default (RFC 9110 §15.4.9) and Chrome
caches it aggressively and indefinitely. A visitor holding `www → apex` who then
meets a new `apex → www` **loops forever**, with no cache-busting move available
to us — we cannot reach into their browser. The escape is to first change the
`www` redirect to something non-permanent, wait out an unbounded cache horizon,
and only then flip. That is weeks of degraded state, and the failure mode during
it is a hard outage for the affected visitor, not a slow page.

**Switching `www` → apex later** is the same trap in the other direction. There is
no cheap direction. The cheap move is to *not move*, and we are already on the
apex.

Everything else already names the apex and would have to be swept in lockstep:
the Firestore host doc (`cname: "aglyn.com"`), every emitted
`<link rel="canonical">` and `og:url`, the AGL-1272 `307` out of
`aglyn-marketing.aglyn.app`, `security-origins.js` `PRODUCTION_DOMAINS`, the CSP
`frame-ancestors` list served on every tenant response, and — if `www` ever had to
*serve* rather than redirect — the Firebase authorized-domain list and the App
Check reCAPTCHA domain allowlist. None of that is hard individually; all of it is
avoidable by not moving.

The one honest argument for `www` is that a `www` host can carry a CNAME and so
survives an edge-address change without customer action. **AGL-1327 already
neutralises it** — an apex ALIAS to `sites.aglyn.app` follows the pool exactly as
a CNAME would.

**Cost of ratifying: zero.** It is already the configuration. This is a
one-line confirmation, not a project.

---

## 4. Decision 2 — what happens to the other name

### 4.1 For `aglyn.com` — keep the `308`, do not serve both

Three options, and what each does:

| | SEO | Session cookie | A customer CNAME'd at the wrong name |
| --- | --- | --- | --- |
| **Serve both** | Duplicate content. Split ranking; the engine, not us, elects canonical. Exactly the defect AGL-1272 was filed to fix, re-introduced one level down. | No difference (§4.2) | Works, and quietly builds authority on the name we do not want |
| **301/302/307** | `307` consolidates weakly and is revocable. Correct for the *tenant subdomain* case, where the destination can vanish (AGL-742) | No difference | Works |
| **308 (current)** | Strongest consolidation, and permanent. Correct where the destination cannot vanish | No difference | Works; permanently re-homed |

For `www.aglyn.com` the destination is **our own apex, which cannot be
disconnected** — so the entire reason AGL-1272 chose `307` (a custom domain can
lapse or be disconnected, and a cached permanent redirect would strand visitors on
a name a stranger may now own) simply does not apply. `308` is right here and
`307` would be right there. That the two differ is correct, not an inconsistency.
Worth writing down precisely because it looks like one.

**Note on `308` vs `301`:** `308` preserves the request method; `301` historically
degrades `POST` to `GET`. Nothing on the marketing site POSTs to `www`, so this is
theoretical — but `308` is the strictly safer of the two and is what is already
configured. No change.

### 4.2 Session cookie scope — this question has no bite, and it is worth saying why

The console session cookie is minted `Domain=.aglyn.com`
(`apps/console/app/api/auth/session/route.ts`, `cookieAttributes`). `.aglyn.com`
covers the apex **and** `www` **and** every workspace subdomain, so **apex-vs-`www`
changes cookie scope not at all.**

For customer custom domains it has even less bite: `example.com` and
`www.example.com` are outside `.aglyn.com` entirely, and the tenant app sets no
cookies on the marketing site (measured: no `Set-Cookie` on `https://aglyn.com/`).

One adjacent fact this surfaced, out of scope here but recorded so it is not
re-discovered: because the marketing site lives at `aglyn.com` and the cookie is
`Domain=.aglyn.com`, a signed-in console user's `__session` is transmitted to the
*tenant* app on every marketing-site request. It is `HttpOnly`, the tenant never
reads it, and responses are ISR-cached identically for everyone — so there is no
leak — but it is a cross-app cookie reach that nobody chose deliberately, and it
is a consequence of the org cutover rather than of this decision.

### 4.3 What a customer whose CNAME points at the wrong name experiences

Today, precisely: **the site 404s.** There is no `www`↔apex redirect anywhere in
the codebase — confirmed. A customer who connects `example.com` and whose visitors
type `www.example.com` gets whatever their registrar does, which by default is
nothing. The middleware's default branch would rewrite `www.example.com` to
`cname--www.example.com`, `get-host.ts` would find no host with that `cname`, and
`load-page-data` returns `notFound: true`. A `404`, cached for 60s.

That is the customer-visible bug AGL-1311 exists for, and the honest current
mitigation is the docs tip: *"Aglyn serves one connected domain per site. Connect
the one you want as your canonical address, then have your registrar redirect the
other to it."*

---

## 5. Decision 3 — the customer `www`↔apex twin

### 5.1 Recommendation: a **derived redirect twin**, not a second serving domain

The issue frames this as a data-model change: make `cname` non-scalar, add a
"primary domain" concept, sweep every site-origin reimplementation. **That is the
expensive way to build it, and it is not necessary.**

The mechanism already exists and is proven in production twice over:

- `www.aglyn.com` **is** a Vercel project domain whose entire configuration is
  `redirect: "aglyn.com", redirectStatusCode: 308`. It never reaches our app.
- `apps/console/app/api/domains/attach/route.ts` already contains
  `upsertSubdomainRedirect({ token, projectId, teamId, subdomain, target })`,
  which PATCHes-or-POSTs a Vercel project domain configured as a redirect. It was
  written for AGL-1273 to redirect `{sub}.aglyn.app`. **Pointing it at
  `www.{domain}` instead of `{sub}.aglyn.app` is a parameter, not a redesign.**

So the model is:

> The customer connects exactly one **primary** domain — unchanged, still the
> scalar `cname`. The platform additionally attaches its **derived twin** as a
> redirect-only Vercel domain: the `www.` sibling of a bare apex, or the bare
> apex of a `www.` name. Deeper subdomains (`shop.example.com`) get no twin,
> because there is no non-guessed sibling to derive.

Why derived rather than a second stored, customer-chosen field:

1. **It changes none of the eleven site-origin reimplementations** (§1.4). The
   twin is never an origin; it is an edge artifact that no render ever sees.
2. **`get-host.ts` is untouched.** `where('cname','==',…)` still resolves one
   hostname to one host, because the twin never arrives at the app.
3. **AGL-642's rules constraint is satisfied for free.** No new client-writable
   field — nothing new is stored at all beyond a pending flag, and that is written
   server-side like `cnameAttachmentPending` and `subdomainRedirectPending`
   already are.
4. **The twin lives inside the registrable domain the customer already proved
   control of** by creating the primary's DNS record, so it needs no separate
   ownership story.
5. **AGL-1272's loop guard is unaffected.** The redirect fires at Vercel's edge
   before middleware runs, so the `cname--` sentinel logic never sees the twin and
   cannot disagree with itself.

**Cost the customer still pays:** a second DNS record. A redirect-only Vercel
domain still needs DNS pointing at Vercel and still provisions a certificate.
There is no such thing as a free twin — the wizard must ask for `CNAME www →
sites.aglyn.app` (or `ALIAS @ → sites.aglyn.app` when the primary is `www`). If
they do not create it, the Vercel domain sits unverified and nothing serves;
harmless, and the correct failure mode.

**Cost we pay:** project-domain count. A customer on a custom domain with a twin
holds three Vercel project domains — primary (serving), twin (redirect),
`{sub}.aglyn.app` (redirect, AGL-1273). Fine at current scale; worth a note
before it is thousands.

### 5.2 The landmine this creates, and it is sharp

`attach/route.ts` line ~199 tolerates Vercel's `domain_already_in_use`:

```ts
if (!response.ok && payload?.error?.code !== 'domain_already_in_use') { … fail … }
```

That tolerance is safe **today** because the Firestore claim transaction is the
real guard: `where('cname','==', domain)` inside `runTransaction` rejects a second
org claiming a name any host already holds (AGL-743). Every name Vercel holds is
also a name Firestore indexes.

**A twin breaks that correspondence.** Consider:

1. Org A connects `example.com`. Twin `www.example.com` is attached to the shared
   `aglyn-tenant` project as `redirect → example.com`.
2. Org B types `www.example.com` into their wizard. Verification passes — it
   checks DNS, not ownership, and org A's DNS points it at us.
3. The Firestore claim searches `cname == "www.example.com"`. Org A's doc holds
   `cname: "example.com"`. **No duplicate.** Org B claims it.
4. Vercel returns `domain_already_in_use` → **tolerated** → treated as success →
   `cnameAttachmentPending` cleared.
5. Org B's console shows the domain connected and healthy. Visitors to
   `www.example.com` are redirected to a stranger's site. Org B's own site is
   never served there.

Org A is unharmed; org B is silently sold a domain that points at someone else.
**Any twin implementation must put the twin's name into the same uniqueness index
the primary is in** — either a server-written `cnameAliases` array checked with
`array-contains` inside the same transaction, or a derivation check that also
queries for the twin relationship. Whichever, it belongs in the transaction, not
after it. This is a prerequisite of building the twin, not a follow-up.

### 5.3 Blast radius on existing customers

**One host, ours.** Zero external customers (§1.5). Existing setups keep working
under every option in this memo, because the twin is purely additive: a customer
who created only the primary record continues to be served exactly as today, and
the twin's absence is indistinguishable from the present state.

If the instructions change, the change is *additive copy* — "optionally add this
second record for `www`" — in `apps/console/utils/tenant-dns.ts` (which both the
card and the docs read, per AGL-1275's single-source fix) plus the three docs
pages that quote it verbatim, including the existing `:::tip Want both www and the
apex?` block in `connect-a-domain.md`, which would be replaced rather than deleted.

---

## 6. Sequencing

### Before launch (safe now, cheap now, expensive later)

1. **Ratify apex-primary** (§3). No action; it is already configured. One line in
   Linear.
2. **Confirm AGL-1327** and move it to Done. It is committed as `1c7ec09c1` and
   this memo depends on it. It is not competing with anything here.
3. ~~**Run the AGL-1273 backfill.**~~ **Done — AGL-1365, `9fba8a8f2`.** The
   measured gap was real (`aglyn-marketing.aglyn.app/pricing?q=1` →
   `Location: https://aglyn.com/pricing`, query dropped), but this memo's
   diagnosis of it was wrong in a way worth recording: **the backfill going
   unrun was not the cause.** Running it failed, which is how the real fault
   surfaced — every edge write AGL-1273 shipped was malformed. Vercel's
   per-domain `redirect` takes a **bare hostname** (`aglyn.com`); the code sent
   `https://aglyn.com` and got `bad_request: Unable to redirect to
   "https://aglyn.com", because that domain is not added to the project` — a
   message that blames the target for being absent when the target was present
   and the *format* was wrong.

   So "one `upsertSubdomainRedirect` call fixes it" was false: that call was
   itself the bug, and hand-attaching the domain would have masked a live defect
   in the attach route that the first real customer would have hit. Now measured:
   `307 → https://aglyn.com/pricing?q=1`, path and query intact.
4. **Decide the twin** (§7 decision 3). Building it is optional; deciding it is
   not, because the wizard copy is what customers act on and copy is expensive to
   retract once people have followed it.

### Must NOT happen before launch

- **Nothing about `robots.txt` or the sitemap.** They are the launch gate
  (§2.3). No item in this memo touches them, and none should be bundled with one.
- **Do not delete the stale Google Cloud DNS zone as part of this work.** It is
  AGL-734's call, it is currently harmless (§2.1), and mixing a zone deletion into
  a domain-model change makes any resulting failure impossible to attribute.

### Becomes irreversible

- **The `308` on `www.aglyn.com` is already effectively irreversible** for any
  browser that has seen it. This is not a future risk to manage; it is a decision
  that has already been made by the configuration and is being ratified after the
  fact. That is the honest framing, and it is fine — the direction is the one we
  want.
- **A twin's redirect status code.** If a twin ships as `308`, reversing which of
  `www`/apex serves for that customer inherits the same loop trap as §3. Twins
  should ship **`307`**, matching `upsertSubdomainRedirect`'s existing choice and
  its reasoning: a customer *can* change their mind about which name is canonical,
  and a customer domain *can* lapse. Our own `www.aglyn.com` is the exception that
  earns `308`, because its destination is us.
- **Wizard copy the customer has acted on.** Once someone has created DNS records
  from an instruction, changing the instruction does not change their zone.

### Ordering constraint

If the twin is built, **§5.2's uniqueness fix lands first**, in the same change or
before it. A twin shipped without it is a cross-org mis-routing bug that will not
show up in any test that exercises one org.

---

## 7. What Zach actually has to decide

| # | Decision | Weight |
| --- | --- | --- |
| 1 | **Apex (`aglyn.com`) is primary; `www` 308-redirects to it.** | **One-line confirmation.** Already the running configuration. Ratifying costs nothing; the memo exists so it stops being undecided. |
| 2 | **AGL-1327 (ALIAS-first apex) stands, and this memo depends on it.** | **One-line confirmation.** Code already on main as `1c7ec09c1`. |
| 3 | **Do customers get an automatic `www`↔apex twin, and when?** | **Genuine judgement.** Product-shaped: it changes the wizard, adds a second DNS record to the customer's task, and doubles project-domain count. Options: (a) build the derived twin now while there are zero customers to migrate; (b) keep the registrar-forwarding story and revisit at GA, as AGL-1311 originally proposed; (c) build it but keep it opt-in behind a checkbox. |
| 4 | ~~**Run the AGL-1273 backfill for `aglyn-marketing.aglyn.app` now?**~~ | **Closed by AGL-1365.** It was indeed a bug report — but a deeper one than "unrun migration": the shipped write was malformed and had never succeeded anywhere. Fixed and applied. |

Decision 3 is the only one that is genuinely open. Decisions 1, 2 and 4 are
confirmations of things already true or already built.

---

## 8. What AGL-1311 asserts that measurement contradicts

1. **"`www` and the apex cannot both serve."** True as stated, but it reads as a
   defect. It is the *intended* design: one serves, the other redirects, and for
   `aglyn.com` that has been correctly configured all along.
2. **"A primary-domain model is undecided."** Undecided in writing. Decided in
   production, in five project-domain configurations, since before the issue was
   filed.
3. **"AGL-1273's edge-redirect work means the platform subdomain now redirects
   query-preserving."** **Was false in production; true as of AGL-1365
   (`9fba8a8f2`).** The code was committed (`e304384d8`) and the backfill had
   never run — but the backfill was not the blocker. Its writes, and the attach
   route's, sent a scheme-prefixed `redirect` where Vercel wants a bare
   hostname, so the feature had never worked anywhere and would have failed for
   the first customer too. Format fixed, backfill applied, measured
   `307 → https://aglyn.com/pricing?q=1`. **The general lesson: an unrun
   migration is a satisfying diagnosis, and it can be a decoy — running it is
   also how you test it.**
4. **"There are five `cname || subdomain` site-origin reimplementations, two
   drift-tested."** There are **eleven**, three drift-tested (§1.4). The estimate
   for the data-model route was roughly half the real size — which strengthens the
   case for the redirect route that needs none of them.
5. **"This is a data-model change plus a primary-domain concept."** Only if built
   as two serving names. Built as a derived redirect twin it is neither: `cname`
   stays scalar, `get-host.ts` is untouched, and the mechanism is a function that
   already exists.

---

## 9. Related

- AGL-1272 (Done) — canonical redirect from `{sub}.aglyn.app`; the `307` reasoning
  in `load-page-data.ts` is the reference for §4.1's status-code table.
- AGL-1273 (In Review) — edge redirect; backfill applied and verified by AGL-1365 (§6).
- AGL-1365 (In Review) — the malformed `redirect` field that made AGL-1273 a
  no-op; the correction this memo's §6.3 and §8.3 now reflect.
- AGL-1275 (In Review) — apex docs and wizard; single DNS source of truth.
- AGL-1327 (In Review) — ALIAS-first apex instructions; precondition of §3.
- AGL-743 / AGL-642 — the uniqueness transaction and the Admin-SDK-only `cname`
  constraint that §5.2 depends on.
- AGL-734 (Backlog) — the stale Google Cloud DNS zone, still answering (§2.1).
- AGL-1300 / AGL-1263 — the `Disallow: /` launch gate. Not touched here.
