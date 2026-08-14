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
 * The non-script half of the policy, unchanged in meaning from what the config
 * used to send: `frame-ancestors` is the clickjacking allowlist, `object-src
 * 'none'` kills `<object>`/`<embed>` plugin-XSS, and `base-uri 'self'` blocks
 * `<base>`-tag hijacking of relative URLs (AGL-518).
 *
 * `isProduction` mirrors the config's own behaviour of also allowing the
 * `http://` forms off production, so local development keeps working.
 */
function baseCspDirectives(isProduction) {
  const remote = PRODUCTION_DOMAINS.map((domain) => `https://${domain}`)
  const local = PRODUCTION_DOMAINS.map((domain) => `http://${domain}`)
  const safe = isProduction ? remote : remote.concat(local)
  return `object-src 'none'; base-uri 'self'; frame-ancestors ${safe.join(' ')}`
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
  const remote = PRODUCTION_DOMAINS.map((domain) => `https://${domain}`)
  const local = PRODUCTION_DOMAINS.map((domain) => `http://${domain}`)
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
 * `'self'` genuinely covers the CDN form: `serveMediaCdn` streams the bytes
 * server-side out of the bucket and never redirects to the storage host, so a
 * `/api/media/cdn/…` image is same-origin all the way down.
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

module.exports = {
  PRODUCTION_DOMAINS,
  IMAGE_ORIGINS,
  TENANT_IMAGE_ORIGINS,
  baseCspDirectives,
  imgSrcDirective,
  tenantImgSrcDirective,
}
