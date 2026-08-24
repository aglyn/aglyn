/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * First-party origins and the CSP directives built from them (AGL-523).
 *
 * Extracted from `with-aglyn.nextjs.config.js` so the **middleware** can build
 * the same policy the config used to emit. That move is the fix for a real
 * production bug, and the reason is worth keeping:
 *
 * The config emitted a static `Content-Security-Policy` response header, and on
 * Vercel that value also lands on the REQUEST the renderer sees. Next resolves
 * the nonce with
 *
 *     headers['content-security-policy'] || headers['content-security-policy-report-only']
 *
 * so a 632-character policy with **no `script-src`** short-circuited the `||`
 * and shadowed the middleware's 75-character nonce policy — which arrived
 * intact under the report-only name and was never read. Result: every script
 * rendered with `nonce="$undefined"`, and enforcing would have served zero
 * JavaScript platform-wide.
 *
 * Measured, not inferred: `/csp-check` on production reported the enforcing
 * header present at 632 chars with `hasScriptSrc: false`, alongside the
 * report-only header at 75 chars with the nonce parsing cleanly.
 *
 * So there must be exactly ONE `Content-Security-Policy` per response, owned by
 * the middleware, and it must carry `script-src`. Plain CommonJS with no
 * imports so the edge runtime can bundle it and `next.config.js` can `require`
 * it.
 */

/** Origins allowed to frame us, and the first-party set generally. */
const PRODUCTION_DOMAINS = [
  'aglyn.io',
  'admin.aglyn.com',
  'admin.aglyn.io',
  'aglyn.com',
  'app.aglyn.com',
  'app.aglyn.io',
  // Dedicated OAuth origin (AGL-462/465): the Firebase auth helper iframe
  // is served here, so it must be able to frame itself (frame-ancestors).
  'auth.aglyn.com',
  'auth.aglyn.io',
  'cdn.aglyn.com',
  'cdn.aglyn.io',
  'cname.aglyn.com',
  'cname.aglyn.io',
  'console.aglyn.com',
  'console.aglyn.io',
  'demo.aglyn.com',
  'demo.aglyn.io',
  'host.aglyn.com',
  'host.aglyn.io',
  'io.aglyn.com',
  'io.aglyn.io',
  'proxy.aglyn.com',
  'proxy.aglyn.io',
  'tenant.aglyn.com',
  'tenant.aglyn.io',
  'www.aglyn.com',
  'www.aglyn.io',
]

/**
 * The hosts THIS DEPLOYMENT serves, beyond Aglyn's own (AGL-2198).
 *
 * `PRODUCTION_DOMAINS` above is a list of our hostnames, and it feeds
 * `frame-ancestors` and `img-src` in BOTH middlewares. On a self-host install
 * that made the policy exactly backwards: 26 origins Aglyn controls were
 * permanently allowed, and not one origin the operator controls was — so
 * their own console could not be framed by their own surfaces, and images
 * served from their own CDN were reported (and, for frame-ancestors,
 * refused).
 *
 * The merge, not a replacement: our list is harmless on their deployment
 * because nothing there resolves to it, while dropping it would break ours.
 * `libs/aglyn/src/lib/app-utils/media-ref.ts` solved the identical problem
 * with `operatorFirstPartyApexes()`; this is the same shape, kept here in
 * plain CommonJS because the edge runtime bundles this file and it may not
 * import.
 *
 * A function rather than a spread of constants so an unset or malformed value
 * contributes NOTHING. An empty string in this list becomes `https://` in a
 * CSP source list, which is a scheme-only source matching every https origin
 * on the internet — the one outcome worse than a missing entry.
 */
function operatorDomains() {
  const hostOf = (raw) => {
    const value = String(raw || '').trim()
    if (!value) return undefined
    try {
      // Accept a bare hostname as well as a URL: NEXT_PUBLIC_CONSOLE_URL
      // carries a scheme, NEXT_PUBLIC_WORKSPACE_DOMAIN does not.
      return new URL(value.includes('://') ? value : `https://${value}`)
        .hostname
        .toLowerCase()
    } catch {
      return undefined
    }
  }
  const candidates = [
    hostOf(process.env.NEXT_PUBLIC_CONSOLE_URL),
    hostOf(process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN),
    hostOf(process.env.NEXT_PUBLIC_TENANT_DOMAIN),
    hostOf(process.env.NEXT_PUBLIC_AGLYN_TENANT_HOST_CNAME),
  ]
  // At least two labels, no wildcard, no path — anything else is a value that
  // would widen the policy rather than extend it.
  return candidates.filter(
    (name, index) =>
      name &&
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(
        name,
      ) &&
      candidates.indexOf(name) === index,
  )
}

/**
 * Our hostnames plus the operator's, de-duplicated — except on a self-host
 * container, which gets only its own (AGL-2446).
 *
 * AGL-2198 merged the operator's domains in and kept ours, on the reasoning
 * that ours are "harmless on their deployment because nothing there resolves to
 * it". That holds for `img-src`, where the entries name hosts a page might load
 * FROM. It does not hold for `frame-ancestors`, which names hosts allowed to
 * frame the page — and Aglyn's 26 origins are live servers we operate. Measured
 * on a real self-host container: every published page answered with
 * `frame-ancestors https://aglyn.io https://admin.aglyn.com … https://www.aglyn.io`
 * plus the operator's three. An operator's pages were telling browsers that
 * Aglyn may frame them, and there was no configuration that removed it.
 *
 * Gated on `AGLYN_STANDALONE` rather than on the presence of operator config,
 * and the difference matters: Aglyn's own deployment DOES set the
 * `NEXT_PUBLIC_*` values, so a "seed ours only when theirs is empty" rule —
 * the AGL-2176 shape — would have dropped our 26 origins from our OWN policy
 * and broken the `auth.aglyn.com` helper iframe. Keyed on the deployment shape
 * this is provably a no-op everywhere except a container.
 */
function firstPartyDomains() {
  const operator = operatorDomains().filter(
    (name) => !PRODUCTION_DOMAINS.includes(name),
  )
  if (process.env.AGLYN_STANDALONE === '1') return operator
  return PRODUCTION_DOMAINS.concat(operator)
}

/**
 * The non-script half of the policy, unchanged in meaning from what the config
 * used to send: `frame-ancestors` is the clickjacking allowlist, `object-src
 * 'none'` kills `<object>`/`<embed>` plugin-XSS, and `base-uri 'self'` blocks
 * `<base>`-tag hijacking of relative URLs (AGL-518).
 *
 * `isProduction` mirrors the config's own behaviour of also allowing the
 * `http://` forms off production, so local development keeps working.
 */
function baseCspDirectives(isProduction) {
  const domains = firstPartyDomains()
  const remote = domains.map((domain) => `https://${domain}`)
  const local = domains.map((domain) => `http://${domain}`)
  const safe = isProduction ? remote : remote.concat(local)
  // A container that configured NO domains would otherwise emit
  // `frame-ancestors ` with an empty source list. That is not a strict policy —
  // it is an INVALID directive, which browsers drop, leaving the page framable
  // by anyone. `'self'` is the strict reading of an empty allowlist and is
  // never wrong: a page may always frame itself (AGL-2446).
  const ancestors = safe.length ? safe.join(' ') : "'self'"
  return `object-src 'none'; base-uri 'self'; frame-ancestors ${ancestors}`
}

/**
 * Third-party hosts the console legitimately loads IMAGES from (AGL-1685).
 *
 * Deliberately short, and deliberately not a guess. Every entry below was read
 * out of the code that builds the URL; anything that merely *might* load an
 * image is left out on purpose, because the point of shipping this report-only
 * first is that the browser names the rest. An origin added here because it
 * seemed likely would be indistinguishable, in the reports, from one that is
 * actually needed — and the allowlist would then be documenting our guesses.
 */
const IMAGE_ORIGINS = [
  // Raw DAM download URLs. `mediaSrc()` prefers the same-origin `cdnPath`, but
  // that is a paid `mediaCdn` entitlement — free-tier orgs and every upload
  // that predates AGL-1215 fall back to `media.url`, which is the
  // `firebasestorage.googleapis.com/v0/b/<bucket>/o/…` form minted by
  // `app/api/media/{upload,upload-url,replace,folders}/route.ts`.
  // See `apps/console/utils/media-src.ts:39-44`.
  'https://firebasestorage.googleapis.com',
  // NOT `storage.googleapis.com`, and the omission is deliberate rather than an
  // oversight: an audit of every producer found the only one to be
  // `getSignedUrl({ action: 'write' })` in `app/api/media/upload-url/route.ts`,
  // which is a PUT and therefore `connect-src`, not an image. What could not be
  // proved from source is whether a legacy Firestore document holds a
  // `storage.googleapis.com` READ url that reaches `<img>` through
  // `resolveMediaSrc`'s pass-through branch — and that is a question about
  // DATA, which only the reports can answer. Allowlisting it pre-emptively
  // would guarantee they never do.
  // Account and member avatars. `upsertOrgMember` mirrors the identity
  // provider's `photoURL` onto the roster (AGL-1126) and `MemberAvatar` renders
  // it directly; Google is the only social provider wired
  // (`utils/oauth-providers.ts`), and it serves photos from `lh3`.
  'https://lh3.googleusercontent.com',
]

/**
 * `img-src` for the console — REPORT-ONLY for now (AGL-1685).
 *
 * ## Why this directive exists at all
 *
 * The policy carries no `default-src`, so before this every directive it does
 * not name fell back to "anything". Two third-party image egresses shipped and
 * ran completely unconstrained on that basis: a live Stripe payment URL handed
 * to `api.qrserver.com` on every POS card sale (AGL-1671), and an MD5 of every
 * member's email address handed to `gravatar.com` on every member row
 * (AGL-1683). Both are fixed at the source and `aglyn/no-remote-image-service`
 * now catches the *shape* — but that rule only reads our own source, and the
 * gravatar URL was assembled inside a dependency, where no host literal of ours
 * ever appeared. A CSP is the control that catches the class instead of the
 * instances, and it is the only one of the two that can see a dependency.
 *
 * ## Why it is not enforcing yet, and why that is not timidity
 *
 * Because the list above is not merely unfinished — it is **unfinishable as
 * written**. An audit of every `<img>` sink the console renders (AGL-1685)
 * found EIGHT independent paths on which an arbitrary `https://` host reaches
 * one, none of them constrained to a host we choose:
 *
 * 1. SSO/OIDC `photoURL` — `idp-profile.ts` validates the SCHEME only, so any
 *    enterprise IdP can put any host on a member's avatar.
 * 2. White-label console branding — `logoUrl`, `faviconUrl`, `emailLogoUrl` are
 *    free-text fields on `MediaUrlField`.
 * 3. Org logo, in settings and the org switcher.
 * 4. Marketplace listing `logoUrl` and `screenshots` — publisher-supplied,
 *    validated against `/^https:\/\/[^\s]+$/` and nothing more.
 * 5. Published marketplace node `src`, which also permits `http:` and
 *    `data:image/`.
 * 6. Markdown images in listing READMEs, blog and docs — `safeImageUrl` is
 *    another scheme-only check, `http:` included.
 * 7. Besigner canvas image nodes — an author-typed hotlink passes through by
 *    design, including into `background-image: url(…)`.
 * 8. The staff "Photo URL" field on the admin user page.
 *
 * So enforcing this list today would not tighten a nearly-complete policy; it
 * would break eight product features, and it would break them the quiet way —
 * an avatar or a customer's own logo that stops rendering for one org and
 * throws nothing. AGL-523 paid for the general version of this lesson already:
 * `strict-dynamic` looked obviously right and went from 1 violation to 70 the
 * moment anyone counted.
 *
 * The follow-up is therefore NOT "flip this on". It is: decide, per field
 * above, between constraining it to first-party media and accepting the egress
 * — and only then flip. That decision wants numbers, which is what this
 * produces.
 *
 * So this ships as `Content-Security-Policy-Report-Only` carrying the
 * *candidate* enforcing policy. A report is then exactly one thing — an image
 * this list would have blocked — and the eight paths above stop being a
 * theoretical list and become a counted one.
 *
 * ## Why `img-src` and not `default-src`
 *
 * `default-src` is the better eventual lever and the wrong one to reach for
 * here, for a mechanical reason rather than a cautious one: the collector caps
 * a single POST at `MAX_REPORTS_PER_REQUEST = 10`
 * (`app/api/csp-report/route.ts`). A console page holds Firestore listeners,
 * App Check, Stripe and GA connections, so a report-only `default-src` would
 * spend that entire budget on `connect-src` before the first image was
 * reported, and the img-src signal this is built to collect would be truncated
 * away. Narrow is not timid here — it is what makes the measurement legible.
 *
 * `data:` and `blob:` are in the candidate policy rather than pending
 * measurement because they are not egress: neither can leave the machine, so
 * neither can carry a payment URL or an email hash anywhere. They cover upload
 * previews, canvas exports and inline icons.
 *
 * ## Reading the reports, when they arrive
 *
 * They land in the runtime log via `/api/csp-report` tagged
 * `AGL-523:csp-violation`; the img-src ones are the entries with
 * `"directive":"img-src"` and `"disposition":"report"`, which separates them
 * from the enforcing script-src stream without a second endpoint.
 *
 * ONE report is expected and must not be waved through: the console runs
 * Firebase Analytics (`components/layouts/firebase-app.layout.tsx`), and gtag
 * has historically fallen back to an `<img>` beacon, with Google Signals able
 * to add pixels to `stats.g.doubleclick.net` and `www.google.com/ads/
 * ga-audiences`. Whether ours does could not be determined from source — it is
 * inside the bundled SDK, which is exactly the blind spot this directive exists
 * to cover. If those hosts appear, the answer is a decision about whether we
 * ship ad-network pixels in a logged-in console, NOT a new allowlist entry.
 * Adding a tracking host to silence its own report is the AGL-1671 mistake
 * played backwards.
 *
 * `isProduction` follows `baseCspDirectives` above in also allowing the
 * `http://` forms off production, plus the Storage emulator on
 * `127.0.0.1:9199` (`cloud/firebase.json`), so local development keeps working.
 */
function imgSrcDirective(isProduction) {
  const domains = firstPartyDomains()
  const remote = domains.map((domain) => `https://${domain}`)
  const local = domains.map((domain) => `http://${domain}`)
  const firstParty = isProduction ? remote : remote.concat(local)
  const development = isProduction
    ? []
    : ['http://localhost:*', 'http://127.0.0.1:*']
  const sources = ["'self'", 'data:', 'blob:']
    .concat(firstParty)
    .concat(IMAGE_ORIGINS)
    .concat(development)
  return `img-src ${sources.join(' ')}`
}

/**
 * Third-party hosts the console legitimately loads SCRIPTS from (AGL-1785).
 *
 * Read out of the code that injects each one, on the same rule `IMAGE_ORIGINS`
 * follows: anything that merely *might* load a script is left out, because an
 * entry added on a hunch is indistinguishable in the reports from one that is
 * needed, and the allowlist would then be documenting our guesses.
 *
 * Two are path-scoped. `www.google.com` and `www.gstatic.com` are shared
 * Google hosts serving far more than reCAPTCHA, and a bare host entry for
 * either would authorise all of it — which is the `https:` mistake in
 * miniature. A source expression with a path matches by path PREFIX, so
 * `/recaptcha/` admits the loader and its versioned release bundle and nothing
 * else on those hosts. The known limitation is that CSP drops the path
 * component across a redirect; neither URL redirects today, and a redirect
 * would loosen this to the bare host rather than break the page.
 */
const SCRIPT_ORIGINS = [
  // Stripe Checkout. `loadStripe` injects the tag at module scope in
  // `apps/console/components/embedded-checkout-dialog.component.tsx:61`.
  // Not path-scoped: `js.stripe.com` is a dedicated host, and Stripe moves the
  // bundle path between versions (`/v3/`, `/basil/`) without notice — a path
  // here would break checkout on their schedule, in the enforcing follow-up.
  'https://js.stripe.com',
  // App Check. `firebase-app.ts:55` constructs a `ReCaptchaV3Provider`, and the
  // SDK loads `https://www.google.com/recaptcha/api.js` from it, which then
  // pulls its implementation from `www.gstatic.com/recaptcha/releases/…`.
  'https://www.google.com/recaptcha/',
  'https://www.gstatic.com/recaptcha/',
  // Firebase Analytics. `components/layouts/firebase-app.layout.tsx` imports
  // `firebase/analytics` and calls `useAnalytics()`, and the GA4 SDK loads the
  // gtag script from here. This is a script we deliberately ship, so it belongs
  // in the candidate policy — unlike a gtag *pixel*, which would arrive as an
  // `img-src` report and is a question about ad-network beacons in a logged-in
  // console rather than an allowlist entry (see `imgSrcDirective`).
  'https://www.googletagmanager.com',
]

/**
 * `script-src` for the console — a REPORT-ONLY twin of the enforcing directive,
 * built to measure the one source the enforcing policy cannot (AGL-1785).
 *
 * ## The hole this measures
 *
 * The enforcing policy is `script-src 'self' https: blob: 'nonce-…'`. The bare
 * `https:` admits a script from ANY https origin, so a dependency that assembles
 * a CDN URL and appends a `<script>` is permitted — not merely unreported.
 * That is not hypothetical: `@monaco-editor/loader` did exactly this, pulling
 * several MB of unpinned, un-SRI'd Monaco from `cdn.jsdelivr.net` into the
 * `app.aglyn.com` origin on every besigner "Raw JSON" open (AGL-1779). It was
 * found by reading `node_modules`, because nothing at runtime could see it.
 *
 * `strict-dynamic` is NOT the fix and must not be reached for here — the note
 * above `scriptSrc` in `apps/console/middleware.ts` records the measurement:
 * 1 violation became 70, because `strict-dynamic` makes `'self'` inert and
 * Next's chunk loads are not nonce-propagated. Nothing in this directive
 * implies it, and adding it would make this header report the entire bundle.
 *
 * ## Why this is not `default-src` or `connect-src`
 *
 * A `<script src>` is governed by `script-src`, and `default-src` never applies
 * where a specific directive is present — so neither would have reported
 * AGL-1779. The directive that permits the load is the directive that has to
 * measure it.
 *
 * ## Why this is a CANDIDATE policy, not "the enforcing one minus `https:`"
 *
 * AGL-1785 proposed the latter, and it is the wrong trade for a mechanical
 * reason. The collector caps one POST at `MAX_REPORTS_PER_REQUEST = 10`, shared
 * with the `img-src` report-only stream that AGL-1702 is waiting on. A policy
 * with no third-party entries reports gtag, reCAPTCHA and gstatic on EVERY page
 * load — a steady stream of things we already know, which both buries the
 * img-src signal and trains everyone to ignore this one. Listing what we
 * provably load makes a report mean exactly one thing: **a script origin nobody
 * wrote down**, which is the AGL-1779 class and nothing else.
 *
 * The cost is real and worth stating: this cannot tell us that gtag loads. We
 * already know that from source, and the enforcing follow-up needs these
 * entries regardless.
 *
 * ## Why a per-request nonce is safe HERE and was not on the tenant
 *
 * AGL-1228 removed a report-only `script-src` from the tenant because tenant
 * pages are ISR-cached: the header carries a fresh nonce while the cached bytes
 * carry an old one, so all 33 scripts violated on every load. That cannot
 * happen here, and the proof is the ENFORCING policy rather than an argument
 * about caching. Console responses carry the same per-request nonce in an
 * enforcing `script-src`, and an inline script can be authorised by nothing but
 * its nonce — so any drift between header and bytes would already be a total
 * console outage, not a report flood. This directive reuses that same `nonce`
 * string, so it is exactly as correct as the policy already load-bearing.
 *
 * That is also why the nonce is a PARAMETER. Building a second nonce here would
 * reintroduce the AGL-1228 mismatch deliberately: every inline Next script
 * would carry the enforcing nonce, match nothing in this policy, and report.
 *
 * `'unsafe-eval'` follows the enforcing policy off production for the same
 * reason it is there — React's dev build evals, and a directive violated on
 * every dev page load is one nobody reads.
 */
function scriptSrcReportOnlyDirective(nonce, isProduction) {
  const sources = ["'self'", 'blob:', `'nonce-${nonce}'`]
    .concat(SCRIPT_ORIGINS)
    .concat(isProduction ? [] : ["'unsafe-eval'"])
  return `script-src ${sources.join(' ')}`
}

/**
 * Third-party hosts a PUBLISHED CUSTOMER SITE legitimately loads images from
 * (AGL-1703).
 *
 * One entry, and the shortness is the finding rather than an omission. A swept
 * inventory of every image sink on the tenant render path — `<img>`, the
 * favicon `<link>`, PWA manifest icons, `og:image`/`twitter:image`, canvas
 * `background-image` — found exactly one hardcoded third-party image host in
 * the whole path, and it is ours:
 *
 * `firebasestorage.googleapis.com` is where the DAM stores bytes, and it is
 * needed for a reason sharper than back-compat: `mediaNodeSrc` mints a `media:`
 * reference from `cdnPath`, and `cdnPath` is only written for orgs holding the
 * PAID `mediaCdn` entitlement. Everyone else stores the absolute
 * `firebasestorage.googleapis.com/v0/b/<bucket>/o/…` download URL, so dropping
 * this entry would blank the images on every FREE-TIER customer's website
 * while leaving paying customers' sites intact — the worst possible shape for
 * a bug to have. `storage.googleapis.com` stays out for the AGL-1685 reason.
 *
 * `'self'` covers the CDN form only when the src is SITE-RELATIVE:
 * `serveMediaCdn` streams the bytes server-side out of the bucket and never
 * redirects to the storage host, so a `/api/media/cdn/…` image is same-origin
 * all the way down.
 *
 * ⚠️ **That qualifier is load-bearing and this comment used to omit it**
 * (AGL-1726, measured 2026-08-24). `'self'` is resolved against the DOCUMENT,
 * so it covers a `/api/media/cdn/…` path but NOT an absolute URL naming the
 * host the media belongs to — and commerce stores the absolute form. Read out
 * of the production `products` collection group, both stored image URLs are
 * `https://northwind-coffee.aglyn.app/api/media/cdn/<scope>/<mediaId>`, and
 * `product-detail.tsx` puts that string in `src` unresolved.
 *
 * On `northwind-coffee.aglyn.app` those are same-origin and `'self'` admits
 * them. On a CUSTOM DOMAIN the document origin is the customer's own name
 * while the stored URL still says `*.aglyn.app`, so the identical image is
 * cross-origin and an ENFORCING policy would block it. Attaching a custom
 * domain is exactly what a paying customer does, so the break is latent today
 * (no storefront has one) and arms itself at launch — the free-tier/paying
 * inversion two paragraphs up, rebuilt from the other side.
 *
 * Not inferred: `cspViolationDaily` holds
 * `2026-08-23|tenant|img-src|report|northwind-coffee.aglyn.app`, minted when
 * that product page was served from a different origin than the one baked into
 * its stored URL. Fixing this belongs to the commerce sinks (AGL-1725), not to
 * a new entry here — an `*.aglyn.app` wildcard would let one customer's site
 * authorise another's.
 */
const TENANT_IMAGE_ORIGINS = ['https://firebasestorage.googleapis.com']

/**
 * `img-src` for a published tenant site — REPORT-ONLY (AGL-1703).
 *
 * ## Why this is not `imgSrcDirective` with a different list
 *
 * The console's directive was the obvious thing to reuse and it is the wrong
 * shape here, in both directions:
 *
 * - It allowlists all 26 `PRODUCTION_DOMAINS`. A customer's website does not
 *   load images from `console.aglyn.com` or `admin.aglyn.io`, and every entry
 *   that is not needed is an entry the reports cannot tell apart from one that
 *   is. Granting 26 origins to a policy built to find out which origins are
 *   used defeats the exercise.
 * - It would still not cover the site itself. `aglyn.app` — the domain every
 *   tenant subdomain is served on — appears nowhere in `PRODUCTION_DOMAINS`,
 *   and a customer's own custom domain could not appear there even in
 *   principle.
 *
 * `'self'` is the primitive that handles both, and it handles them exactly:
 * the browser resolves it against the document, so it means `acme.com` on the
 * custom domain and `acme.aglyn.app` on the subdomain, with no list to
 * maintain and no way for one customer's origin to authorise another's.
 *
 * ## What this will report, and what must NOT be done about it
 *
 * Two things are expected, and neither is an allowlist entry:
 *
 * 1. **Analytics pixels.** Published sites load gtag from
 *    `googletagmanager.com` (`site-analytics.tsx`), and gtag has historically
 *    fallen back to an `<img>` beacon, with Google Signals able to add pixels
 *    on `stats.g.doubleclick.net` and `www.google.com/ads/ga-audiences`.
 *    Whether ours does cannot be read out of source — it is inside the bundled
 *    SDK, which is the blind spot this directive exists to cover. If those
 *    hosts appear, the question is whether we ship ad-network pixels on
 *    customers' websites and whether `/legal/subprocessors` names them, NOT
 *    whether to add a line here.
 * 2. **Author hotlinks, in volume.** `resolveMediaSrc` passes any non-`media:`
 *    string through untouched — no scheme check, no host check — and the Image
 *    component's own field help tells authors to paste a URL from elsewhere.
 *    An inventory of the render path found 28 image sinks; the ones reachable
 *    with an arbitrary host are not a corner: markdown and collection images
 *    (scheme-only, `http:` included), the collection cover
 *    `background-image`, every commerce and events sink, which bypass
 *    `resolveMediaSrc` and emit the raw Firestore string, and two open-ended
 *    CSS surfaces — the unsanitized author `<style>` block in
 *    `custom-html.tsx` and `backgroundImage` typed into the Styles panel,
 *    neither of which any source-level guard can see. Every one is a
 *    third-party host learning a visitor's IP and a `Referer` naming the
 *    customer's site. That is the number this exists to produce, and adding
 *    the hosts it names would erase it.
 *
 * ## What it will NOT report, which matters when reading the total
 *
 * Marketplace plugins render inside an iframe on a dedicated cross-origin
 * (`NEXT_PUBLIC_PLUGIN_ORIGIN`) carrying its OWN policy, and that policy is
 * `img-src data: blob: https:` — any host at all. A document policy does not
 * reach into a cross-origin frame, so plugin images will never appear in these
 * reports and a count of zero from them means nothing. The tenant also sets no
 * `frame-src`, so nothing at this layer constrains where a frame may point;
 * both are separate directives and separate work.
 *
 * ## Why report-only is not caution here
 *
 * The blast radius is our customers' businesses. An enforced `img-src` that is
 * wrong takes images off a published website — a stranger's shopfront — and
 * throws nothing anyone will see — and the visitor harmed is not our user and
 * has no channel to tell us. AGL-1726 records the flip conditions, stricter
 * than the console's (AGL-1702) for exactly that reason; AGL-1725 is the
 * inventory of arbitrary-host sinks that blocks it.
 *
 * ## The first reading, and why it does NOT license the flip (AGL-1726)
 *
 * Read on 2026-08-20 from `cspViolationDaily`, the durable counters AGL-1799
 * added after establishing that the runtime log forgets in an hour. The whole
 * collection held ten documents, all of them `app: 'console'`. **Tenant rows:
 * zero**, across the four days the aggregation had been live.
 *
 * That zero is real, not a broken pipe — which had to be established before it
 * could be read at all, because a collector that never writes and a policy
 * that is never violated produce byte-identical evidence (the AGL-518 shape,
 * and the reason AGL-1799 exists). Verified end to end against production: the
 * report-only header is served on live sites, and a synthetic report POSTed to
 * a real site's `/api/csp-report` minted its counter with the right site,
 * path and origin. The pipeline works.
 *
 * **A real zero here is still not evidence of safety, because the population
 * is empty.** Production carries six hosts, every one of them ours — a demo, a
 * marketing site, and four test sites — with no custom domain attached to any
 * of them and no paying customer behind them. AGL-1726 condition 3 asks for a
 * business week of real visitor traffic across five site shapes (free-tier,
 * paid `mediaCdn`, a commerce storefront, a collection/blog, and a site using
 * Custom HTML or Styles-panel `backgroundImage`). Those sites do not exist
 * yet. Zero violations from nobody visiting is zero information, and enforcing
 * on it would be reading an empty room as a quiet one.
 *
 * The condition that actually decides it is condition 2, and it is already
 * answered in the other direction: AGL-1725 settled the hotlink question as
 * **scheme, never host** — an author's `https` hotlink to any host is accepted
 * and disclosed, because the site owner is the controller for their own
 * visitors and hotlinking is an advertised feature. AGL-1726's own text draws
 * the consequence: if the answer is accept-and-document, then `img-src` cannot
 * be the enforcement point at all. A first-party-only enforced `img-src`
 * would silently revoke a documented capability from every published site.
 *
 * So this stays report-only, and the next person does not need to re-run the
 * probe: the blocker is a product decision that has already been made, not a
 * measurement still pending.
 *
 * ## Condition 4 is now ANSWERED, and the answer is not an allowlist entry
 *
 * Re-read 2026-08-24. The collection has moved: 18 documents, and **three of
 * them are `app: 'tenant'`** where the 08-20 reading found none. One is the
 * 08-20 synthetic probe (`agl1726-probe.invalid` — still present, still not a
 * real violation, TTLs out on its own). The other two are real, and each
 * settles a question this file was waiting on.
 *
 * `2026-08-24|tenant|img-src|report|www.google.com.vn`, site `aglyn.com`,
 * path `/`, count 2 — a **Google ad-network pixel**, on a tenant-served site,
 * over real production https traffic. That is the beacon predicted two
 * paragraphs above, arriving on a country ccTLD rather than the
 * `stats.g.doubleclick.net` / `www.google.com/ads/ga-audiences` forms guessed
 * at. So gtag on a published site DOES emit an image beacon.
 *
 * The guidance above applies unchanged, and the ccTLD makes it sharper: the
 * question is whether we ship ad-network pixels on customers' websites and
 * whether `/legal/subprocessors` names the recipient — NOT whether to add a
 * line here. There is no line to add. `www.google.<cctld>` is a per-visitor
 * country domain, so allowlisting the observed host silences one visitor's
 * pixel and no one else's, and allowlisting the SHAPE means a wildcard across
 * Google's entire ccTLD space. Adding a tracking host to silence its own
 * report is the AGL-1671 mistake played backwards; adding a wildcard for one
 * is that mistake with the evidence deleted too.
 *
 * The second row is the commerce absolute-URL break, recorded with
 * `TENANT_IMAGE_ORIGINS` above.
 *
 * ## What the counters now prove about the pipeline itself
 *
 * These two rows retire the 08-20 caveat that a real zero and a broken
 * collector are byte-identical (the AGL-518 shape). They are unsolicited, from
 * traffic nobody generated on purpose, carrying a site and path nobody typed
 * into a probe — so the tenant collector, the aggregator and the reporting
 * tail are all live in production, demonstrated by output rather than by
 * reading the header back. A future zero on this surface can now be read as a
 * zero. It still cannot be read as SAFETY while the population is six hosts we
 * own (condition 3).
 *
 * ## Why this one is compatible with ISR and `script-src` was not
 *
 * AGL-1228 removed a report-only `script-src` because a per-request nonce
 * cannot match ISR-cached bytes — two requests to one cached page returned
 * BYTE-IDENTICAL HTML with a different nonce in each response header. Nothing
 * in this directive is per-request: it is the same string on every response,
 * so the cached bytes and the header agree by construction. That difference is
 * the whole reason this is shippable where that one was not, and it is worth
 * stating because the two look alike from the outside.
 *
 * `data:` and `blob:` are in the candidate policy rather than pending
 * measurement because neither can leave the machine, so neither can carry a
 * visitor's IP anywhere. They cover inline icons and canvas exports.
 */
function tenantImgSrcDirective(isProduction) {
  const development = isProduction
    ? []
    : ['http://localhost:*', 'http://127.0.0.1:*']
  const sources = ["'self'", 'data:', 'blob:']
    .concat(TENANT_IMAGE_ORIGINS)
    .concat(development)
  return `img-src ${sources.join(' ')}`
}

/**
 * Where violations are posted (AGL-523).
 *
 * Relative on purpose: it resolves against the document, so a tenant report
 * lands on the customer's own domain rather than ours. Same-origin and outside
 * both middlewares' matchers, so reporting cannot recurse through them.
 */
const CSP_REPORT_PATH = '/api/csp-report'

/** The `Reporting-Endpoints` group name `report-to` resolves against. */
const CSP_REPORT_GROUP = 'csp'

/**
 * The `report-uri` / `report-to` tail every policy in the repo ends with.
 *
 * ## `report-to` is NOT a fallback for `report-uri` — it REPLACES it
 *
 * The comment this replaces claimed the pair covered two browser families by
 * redundancy, so that if one channel failed the other still delivered. That is
 * not what browsers do, and the difference is the whole reason this function
 * exists (AGL-1788). Measured in real browsers against real responses, one
 * violation per case, a report-only `img-src 'self'` plus the reporting tail
 * under test:
 *
 * | policy tail                                     | Chrome 152 | Safari 26 |
 * | ----------------------------------------------- | ---------- | --------- |
 * | `report-uri` alone                              | delivered  | delivered |
 * | `report-uri` + `report-to`, over **https**      | delivered  | delivered |
 * | `report-uri` + `report-to`, over **plain http** | **NOTHING**| delivered |
 * | `report-to` with no `Reporting-Endpoints`       | **NOTHING**| **NOTHING**|
 *
 * Row four is the proof: adding `report-to` switches `report-uri` OFF even
 * when the group resolves to nothing, so there is no second channel to fall
 * back to. Row three is that rule biting — Chrome refuses a
 * `Reporting-Endpoints` header on a non-secure transport, which leaves the
 * group unresolvable and `report-uri` already suppressed.
 *
 * So the pair does cover both families, but only over https, and for a reason
 * the old comment had backwards: Chrome delivers through the Reporting API
 * (batched, `application/reports+json`) while Safari posts a single report to
 * the `report-uri` path. Both shapes reach `parseCspReports`.
 *
 * ## Why the http branch is not merely a dev nicety
 *
 * Production is https, so production has always delivered — this does not fix
 * a production outage. What it fixes is that on `http://localhost` the policy
 * we ship reports NOTHING to anyone, so nobody can see a CSP report while
 * developing, and "no reports" reads as "no violations". That is the AGL-518
 * failure at desk scale, and it is what made this defect survivable long
 * enough to be mistaken for a production one.
 *
 * The failure mode if `isSecureTransport` is ever computed wrong is benign in
 * the direction that matters: guessing http on an https response emits
 * `report-uri` alone, which row two shows still delivers in both browsers.
 * Guessing https on an http response restores today's behaviour.
 *
 * @param {boolean} isSecureTransport Whether the RESPONSE goes out over https.
 */
function reportingDirectives(isSecureTransport) {
  return isSecureTransport
    ? `report-uri ${CSP_REPORT_PATH}; report-to ${CSP_REPORT_GROUP}`
    : `report-uri ${CSP_REPORT_PATH}`
}

/**
 * The `Reporting-Endpoints` header value, or `null` when the transport cannot
 * carry the Reporting API at all.
 *
 * Returning `null` rather than the header on http keeps the two in step: a
 * `Reporting-Endpoints` header without `report-to` is inert, and `report-to`
 * without the header is row four above — silence.
 *
 * @param {boolean} isSecureTransport Whether the RESPONSE goes out over https.
 */
function reportingEndpointsHeader(isSecureTransport) {
  return isSecureTransport ? `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"` : null
}

/**
 * Is this request going to be answered over https?
 *
 * `x-forwarded-proto` first because the proxy is the only thing that knows:
 * Vercel terminates TLS ahead of the function, so `nextUrl.protocol` can read
 * `http:` on a request the browser made over https. It is a comma-separated
 * list when proxies chain, and the FIRST entry is the client-facing hop.
 *
 * @param {Headers} headers Request headers.
 * @param {string} protocol `nextUrl.protocol`, e.g. `https:`.
 */
function isSecureTransport(headers, protocol) {
  const forwarded = headers.get('x-forwarded-proto')
  const scheme = forwarded ? forwarded.split(',')[0] : protocol
  return scheme.trim().toLowerCase().replace(/:$/, '') === 'https'
}

module.exports = {
  PRODUCTION_DOMAINS,
  firstPartyDomains,
  IMAGE_ORIGINS,
  SCRIPT_ORIGINS,
  TENANT_IMAGE_ORIGINS,
  CSP_REPORT_PATH,
  CSP_REPORT_GROUP,
  baseCspDirectives,
  imgSrcDirective,
  isSecureTransport,
  reportingDirectives,
  reportingEndpointsHeader,
  scriptSrcReportOnlyDirective,
  tenantImgSrcDirective,
}
