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
 *
 * ## Two directives that are deliberately absent, and stay absent
 *
 * A Lighthouse "best practices" audit names both of these on every run, so the
 * pressure to add them recurs. Neither is a header change on the tenant, and
 * the reasons are properties of what a published customer site IS.
 *
 * ### `require-trusted-types-for 'script'` — unreachable, and not merely unbuilt
 *
 * Trusted Types turns every string-to-code sink into a call that must pass
 * through a registered policy. The tenant render path has four kinds of sink,
 * and the last one has no fix at all:
 *
 * 1. `new Function(step.code)()` in the marketing plugin's site runtime runs
 *    the site owner's own JavaScript on their own page — a sold feature. TT
 *    gates `new Function` exactly as it gates `eval`, so enforcing it deletes
 *    the feature rather than hardening it.
 * 2. `container.innerHTML = …` in that same runtime, plus seven
 *    `dangerouslySetInnerHTML` sites across the tenant, typography rich text
 *    and the Custom HTML block. Each would need a policy wrapper; React and
 *    `next/script` (which injects `<script>` elements at `afterInteractive`)
 *    have no Trusted Types support to hang one on.
 * 3. The JSON-LD and animation `<script>` blocks the page emits inline.
 * 4. Custom HTML's Embed mode is a `srcdoc` iframe carrying a RAW author
 *    snippet. A `srcdoc` child inherits this policy — measured, and the same
 *    inheritance the tenant relies on for `connect-src` and `frame-src`. The
 *    snippet is third-party widget code we never see, so there is no call site
 *    to route through a policy. This is the one an owner allowlist cannot
 *    answer, and it is why the directive is not merely deferred.
 *
 * ### `script-src` — nonce and hash both fail, for recorded reasons
 *
 * Do not re-derive this. The tenant page is ISR at `revalidate = 600`, so its
 * HTML is regenerated OUTSIDE any request: a per-request nonce lands in the
 * header while the cached bytes carry `$undefined`, which was measured as two
 * requests to one cached page returning byte-identical HTML under different
 * nonces. Hashes cannot cover the JSON-LD (varies per page) or the RSC flight
 * payload (varies per revalidation, and its content IS the serialized tree).
 * The full history is in `apps/tenant/middleware.ts`, and
 * `apps/tenant/specs/csp-no-script-src.spec.ts` fails if anyone re-adds it.
 *
 * The console is the opposite case and DOES carry `script-src` — it is
 * request-rendered, so a nonce matches its bytes. Do not read the console's
 * directive as evidence the tenant could have one.
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
  /**
   * `worker-src` and `manifest-src` (AGL-1152). Both were unconstrained, and
   * because this policy carries NO `default-src` there was nothing for them to
   * fall back to — an injected script could start a worker from any origin it
   * liked, and a worker is the most useful thing an injection can get: it keeps
   * running after the page moves on, and it is out of sight of anything
   * watching the document.
   *
   * Safe to ENFORCE rather than report first, which the rest of this file
   * rightly defaults to, because both were checked against real usage instead
   * of assumed: there is no `new Worker`, `new SharedWorker` or
   * `serviceWorker.register` anywhere in apps/ or libs/, and the only manifest
   * is `/manifest.webmanifest`, which the tenant middleware rewrites to its own
   * `/api/manifest` — same origin either way.
   *
   * `blob:` is allowed for workers and not for the manifest: a bundler or a
   * library may legitimately mint a worker from a blob, and blocking the
   * REMOTE origin is what closes the exfiltration path. A manifest has no such
   * pattern, so it gets the tighter `'self'`.
   */
  return (
    `object-src 'none'; base-uri 'self'; frame-ancestors ${ancestors}; ` +
    `worker-src 'self' blob:; manifest-src 'self'`
  )
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
  // App Check's reCAPTCHA badge. Path-scoped to match the `SCRIPT_ORIGINS`
  // entry that loads the script it belongs to — the same widget, the other
  // half of it.
  'https://www.google.com/recaptcha/',
  // GA4's measurement pixel. `SCRIPT_ORIGINS` above admits this host for the
  // gtag SCRIPT and asks, in a comment, whether the matching pixel is an
  // ad-network beacon that has no business in a logged-in console. Measured:
  // it is GA4's own, on the pages that load the analytics SDK we deliberately
  // ship. Allowlisting the script and reporting its beacon measures nothing.
  'https://www.googletagmanager.com',
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
 * The other three owner-widenable directives (AGL-1152): media, fonts, and
 * where a form may post.
 *
 * Same shape as `tenantImgSrcDirective` and the same reasoning, so read that
 * first. What differs is only what each one is allowed to fall back to, and
 * these are REPORT-ONLY at the time of writing — see the middleware. That is
 * not timidity, it is the doctrine this file keeps: our own code can be
 * measured, a published customer site cannot. A site embedding a Vimeo player
 * or a Google font is doing something legitimate that no amount of reading our
 * repo would reveal, so the browser names them first and the flip to enforcing
 * comes after the reports are quiet.
 *
 * The owner's list is live either way — it is what the eventual enforcing
 * header will carry, so approving a host now is not wasted work.
 */
function tenantOwnerWidenedDirective(
  directive,
  isProduction,
  approvedHosts,
  siteOrigins,
  extraSources = [],
) {
  const development = isProduction
    ? []
    : ['http://localhost:*', 'http://127.0.0.1:*']
  const sources = ["'self'"]
    .concat(extraSources)
    // The site's own addresses, always — a custom domain gives a site TWO
    // origins and `'self'` is only the one it was served from.
    .concat(approvedImageHostSources(siteOrigins))
    .concat(approvedImageHostSources(approvedHosts))
    .concat(development)
  return `${directive} ${sources.join(' ')}`
}

/**
 * Video and audio. `data:`/`blob:` because an uploaded clip may be either,
 * and `TENANT_IMAGE_ORIGINS` because an upload is an upload — a free-tier org
 * without the paid `mediaCdn` entitlement stores an absolute
 * `firebasestorage.googleapis.com` URL for a video exactly as it does for an
 * image. Pinned for the same reason and not owner-removable: dropping it would
 * blank a free-tier site's own uploads.
 */
function tenantMediaSrcDirective(isProduction, approvedMediaHosts, siteOrigins) {
  return tenantOwnerWidenedDirective(
    'media-src',
    isProduction,
    approvedMediaHosts,
    siteOrigins,
    ['data:', 'blob:'].concat(TENANT_IMAGE_ORIGINS),
  )
}

/**
 * Web fonts. `data:` covers a font inlined into a stylesheet.
 *
 * `fonts.gstatic.com` is PINNED, and this is measurement rather than
 * generosity: `host-theme.ts` builds a `fonts.googleapis.com/css2` link for
 * any theme that names Google families, and `app/[host]/layout.tsx`
 * preconnects to `fonts.gstatic.com` — which is where the font FILES come
 * from, and so the origin this directive decides on. Enforcing without it
 * would strip the typeface from every themed site on the platform, for a
 * choice its owner made in our own theme editor.
 *
 * (The stylesheet at `fonts.googleapis.com` is a `style-src` question, not a
 * `font-src` one. That directive is still unconstrained and is a separate,
 * harder problem — emotion injects inline styles, so it cannot be enforced
 * without hashes.)
 */
const TENANT_FONT_ORIGINS = ['https://fonts.gstatic.com']
function tenantFontSrcDirective(isProduction, approvedFontHosts, siteOrigins) {
  return tenantOwnerWidenedDirective(
    'font-src',
    isProduction,
    approvedFontHosts,
    siteOrigins,
    ['data:'].concat(TENANT_FONT_ORIGINS),
  )
}

/**
 * Where a form may POST. No `data:`/`blob:` — a form submitting to either is
 * not a thing a site does on purpose, and this is the directive that decides
 * whether an injected form can carry what a visitor typed off-site.
 */
function tenantFormActionDirective(
  isProduction,
  approvedFormActions,
  siteOrigins,
) {
  return tenantOwnerWidenedDirective(
    'form-action',
    isProduction,
    approvedFormActions,
    siteOrigins,
  )
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
 * either would authorize all of it — which is the `https:` mistake in
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
  /*
   * The console's own advertising tags
   * (`apps/console/components/advertising-tags.component.tsx`).
   *
   * Scripts we deliberately ship, so they belong in the candidate policy for
   * the same reason the gtag loader above does — and the distinction that
   * comment draws still holds: a gtag *pixel* arrives as an `img-src` report
   * and is a question about ad-network beacons in a logged-in console, not an
   * allowlist entry here.
   *
   * Two of these are already covered by `www.googletagmanager.com`: the Google
   * Ads tag rides the same `gtag/js` library, and a Tag Manager container is
   * `gtm.js` on that host. Only the non-Google vendors need naming.
   *
   * Listed AHEAD of a violation report rather than after one, which is the
   * exception to this file's rule that the browser names what belongs here.
   * The rule exists so the list documents facts instead of guesses; a loader
   * this repository mounts is a fact. Leaving them out would fill the
   * report-only stream with violations for scripts we chose to ship, and would
   * silently kill both tags on the day `script-src` is flipped to enforcing.
   */
  'https://connect.facebook.net',
  'https://snap.licdn.com',
  // Google Sign-In. `signInWithPopup` loads gapi from here for the federated
  // flows, which is why the reports cluster on `/signin` — 37 of them in the
  // first fortnight of measurement, every one a script we deliberately ship.
  'https://apis.google.com',
  /*
   * Realtime Database. The RTDB SDK appends a `<script>` per long-poll frame,
   * and the besigner's presence and version views hold an open connection —
   * 61 reports, all from besigner and version routes.
   *
   * Wildcarded because the hostname is a SHARD, assigned per connection:
   * production served `s-gke-usc1-nssi2-2.firebaseio.com` alongside the
   * project's own `aglyn-main-default-rtdb.firebaseio.com`, and pinning either
   * would report the other from the next connection onward.
   */
  'https://*.firebaseio.com',
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
 * enforcing `script-src`, and an inline script can be authorized by nothing but
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
/*
 * ## The residue that is NOT an allowlist entry
 *
 * With the origins above, what still reports is `blocked-uri: inline` — 22 in
 * the first fortnight, on `/signin` and `/app`. None of them is ours: the
 * console renders no inline `<script>` anywhere, and reads `x-nonce` nowhere.
 * They are injected at runtime BY the third-party scripts this list admits —
 * gapi on the sign-in page, the Firebase SDKs on the app shell — and an
 * injected inline script carries no nonce by construction.
 *
 * `'strict-dynamic'` is the directive designed for exactly this and it is not
 * the answer here: it makes `'self'` inert, and measuring it took the count
 * from 1 to 70 (see the note above). `'unsafe-inline'` would clear the report
 * by removing the protection the whole policy exists for.
 *
 * So this residue is the standing reason `script-src` cannot be flipped from
 * report-only to enforcing, and it is a property of the dependencies rather
 * than a gap in this file. Dropping a dependency that injects inline is what
 * would move it; nothing in this list can.
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
 * authorize another's.
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
 * maintain and no way for one customer's origin to authorize another's.
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
/**
 * How many hosts one site may approve (AGL-1152).
 *
 * A bound, not a quota: the header goes on every response of every page, and
 * an unbounded owner-editable list is an unbounded header. Well above any real
 * site — the widest thing observed is a handful of image CDNs — and small
 * enough that a pasted-in dump cannot make the policy the largest thing on the
 * wire.
 */
/**
 * Image hosts the MEASUREMENT tags need, added only to sites that run them
 * (AGL-1152).
 *
 * ## Why this is platform-curated and not the owner's list
 *
 * `approvedImageHosts` is for hosts the owner's own CONTENT comes from, and
 * they can reasonably be expected to know those. Nobody can reasonably be
 * expected to know that Google Ads conversions land on
 * `googleads.g.doubleclick.net` while Signals uses `stats.g.doubleclick.net`.
 * Worse, an owner who could REMOVE these would silently break their own
 * conversion tracking and have no way to connect the two events. So the
 * platform owns this set, and it is added only when the site actually
 * configures a measurement id — a site with no analytics gets no wider policy
 * than it needs.
 *
 * ## The two vendors, and where Meta actually comes from
 *
 * NOT from a GTM container — no host on the platform has one configured. Meta
 * is a FIRST-CLASS pixel: `analytics.adTags.meta` holds the account id, and
 * `advertising-tags.ts` turns it into a `connect.facebook.net` script whose
 * beacon posts to `www.facebook.com/tr`. That is the report-only violation
 * visible on `aglyn.com` today, and it is why both hosts are named here.
 *
 * `advertising-tags.ts` is the source of truth for which vendors load what.
 * It cannot be imported from this file — this one is root-level CommonJS,
 * outside the nx graph, because `next.config.js` must `require` it — so a
 * spec asserts every script-loading vendor in that registry has its origin
 * covered here. A GTM container, when one is eventually configured, is a
 * separate and broader problem: it can carry any vendor's tag, and what it
 * loads beyond this list is the owner's to approve.
 *
 * ⛔ NOT A PLACE FOR A TRACKING HOST THAT MERELY SHOWED UP IN THE REPORTS.
 * Each entry here is a host a tag we DELIBERATELY ship fetches an image from.
 * Adding one to silence its own violation is the AGL-1671 mistake played
 * backwards — the report is the evidence, and deleting the evidence is not the
 * same as answering it.
 *
 * ## ⚠️ What this CANNOT cover, and nothing can
 *
 * GA4's remarketing-audience pixel is fetched from the visitor's LOCAL Google
 * domain — `www.google.<cctld>/ads/ga-audiences`, observed as
 * `www.google.com.vn` on 2026-08-24. CSP source expressions cannot wildcard a
 * TLD: `https://*.google.com` is expressible, `https://www.google.*` is not.
 * Enumerating ~190 ccTLDs in a header shipped on every response is not a
 * policy, it is a payload.
 *
 * So that ONE pixel is refused under enforcement, and the consequence is
 * bounded and worth stating plainly: GA4 → Google Ads audience building
 * degrades for visitors outside the `www.google.com` region. CONVERSION
 * tracking is unaffected — it posts to `googleads.g.doubleclick.net` and
 * `www.googleadservices.com`, both named below — so ad performance
 * measurement keeps working; it is retargeting reach that narrows.
 *
 * The real fix is server-side tagging: route measurement through a
 * first-party endpoint and no third-party image pixel is needed at all. That
 * removes this entire class of problem rather than allowlisting around it.
 */
/**
 * Google's country domains, for the ONE beacon a wildcard cannot reach
 * (AGL-1152).
 *
 * GA4's remarketing-audience pixel is fetched from the visitor's LOCAL Google
 * domain — `www.google.<tld>/ads/ga-audiences` — which is why the reports
 * showed `www.google.com.vn`. CSP source expressions cannot wildcard a TLD:
 * `https://*.google.com` is expressible, `https://www.google.*` is not. So the
 * only way to keep GA4 → Google Ads audience building working under an
 * enforced `img-src` is to name them.
 *
 * ## The cost, measured rather than asserted
 *
 * ~190 entries, about 4.8 KB of header. That sounds worse than it is: the
 * value is byte-identical on every response, so HPACK/QPACK carries it once
 * per connection and references the table afterwards — the first request on a
 * connection pays, the rest do not. And it is added ONLY to sites that
 * configure measurement, so a customer site with no analytics ships none of
 * it.
 *
 * An earlier revision of this file called enumerating them "a payload, not a
 * policy" and left the pixel refused. That was the wrong call: the cost is one
 * compressed header on the operator's own marketing site, and the thing it
 * buys is remarketing reach outside the `.com` region.
 *
 * ⚠️ THIS LIST GOES STALE. Google adds and retires country domains, and a
 * missing entry is a silently narrowed audience rather than an error anyone
 * sees. The `img-src` violation reports are the instrument: a
 * `www.google.<something>` in them that is not here is the signal to add it.
 * Do not treat a quiet report as proof the list is complete — see AGL-1726 on
 * why an empty room is not a quiet one.
 */
const GOOGLE_CCTLDS = [
  'com', 'ad', 'ae', 'com.af', 'com.ag', 'al', 'am', 'co.ao', 'com.ar', 'as',
  'at', 'com.au', 'az', 'ba', 'com.bd', 'be', 'bf', 'bg', 'com.bh', 'bi', 'bj',
  'com.bn', 'com.bo', 'com.br', 'bs', 'bt', 'co.bw', 'by', 'com.bz', 'ca',
  'cat', 'cd', 'cf', 'cg', 'ch', 'ci', 'co.ck', 'cl', 'cm', 'cn', 'com.co',
  'co.cr', 'com.cu', 'cv', 'com.cy', 'cz', 'de', 'dj', 'dk', 'dm', 'com.do',
  'dz', 'com.ec', 'ee', 'com.eg', 'es', 'com.et', 'fi', 'com.fj', 'fm', 'fr',
  'ga', 'ge', 'gg', 'com.gh', 'com.gi', 'gl', 'gm', 'gr', 'com.gt', 'gy',
  'com.hk', 'hn', 'hr', 'ht', 'hu', 'co.id', 'ie', 'co.il', 'im', 'co.in',
  'iq', 'is', 'it', 'je', 'com.jm', 'jo', 'co.jp', 'co.ke', 'com.kh', 'ki',
  'kg', 'co.kr', 'com.kw', 'kz', 'la', 'com.lb', 'li', 'lk', 'co.ls', 'lt',
  'lu', 'lv', 'com.ly', 'co.ma', 'md', 'me', 'mg', 'mk', 'ml', 'com.mm', 'mn',
  'ms', 'com.mt', 'mu', 'mv', 'mw', 'com.mx', 'com.my', 'co.mz', 'com.na',
  'com.ng', 'com.ni', 'ne', 'nl', 'no', 'com.np', 'nr', 'nu', 'co.nz',
  'com.om', 'com.pa', 'com.pe', 'com.pg', 'com.ph', 'com.pk', 'pl', 'pn',
  'com.pr', 'ps', 'pt', 'com.py', 'com.qa', 'ro', 'rs', 'ru', 'rw', 'com.sa',
  'com.sb', 'sc', 'se', 'com.sg', 'sh', 'si', 'sk', 'com.sl', 'sm', 'sn', 'so',
  'sr', 'st', 'com.sv', 'td', 'tg', 'co.th', 'com.tj', 'tl', 'tm', 'tn', 'to',
  'com.tr', 'tt', 'com.tw', 'co.tz', 'com.ua', 'co.ug', 'co.uk', 'com.uy',
  'co.uz', 'com.vc', 'co.ve', 'co.vi', 'com.vn', 'vu', 'ws', 'co.za', 'co.zm',
  'co.zw',
]

/** `https://www.google.<tld>` for every country domain above. */
const GOOGLE_CCTLD_ORIGINS = GOOGLE_CCTLDS.map((tld) => `https://www.google.${tld}`)

const MEASUREMENT_IMAGE_ORIGINS = [
  // Google Tag Manager / gtag delivery.
  'https://www.googletagmanager.com',
  /*
   * GA4 collection, which lands on TWO SEPARATE DOMAINS (AGL-2486).
   *
   * `google-analytics.com` and `analytics.google.com` read as the same vendor
   * and are not the same host, so no wildcard over one reaches the other:
   * `https://*.google-analytics.com` matches `region1.google-analytics.com`
   * and cannot match `analytics.google.com`, which is a subdomain of
   * `google.com`. Listing only the first family is the shape that refused
   * every GA4 hit on aglyn.com while the policy looked complete.
   *
   * Measured on production rather than inferred — four `fetch` probes from a
   * live `https://aglyn.com/press` document under the enforcing policy:
   *
   * | host                            | verdict                        |
   * | ------------------------------- | ------------------------------ |
   * | `www.google-analytics.com`      | allowed                        |
   * | `region1.google-analytics.com`  | allowed (the wildcard reaches) |
   * | `analytics.google.com`          | **REFUSED**, connect-src       |
   * | `region1.analytics.google.com`  | **REFUSED**, connect-src       |
   *
   * gtag's v2 transport uses both: the first hit goes to
   * `www.google-analytics.com/g/collect`, and the Google Signals follow-up
   * goes to `analytics.google.com/g/collect` so the ad-personalization cookie
   * can be set on a `google.com` host. Regional data residency moves each
   * onto a `region#.` prefix of its own domain, which is why both families
   * carry a wildcard rather than only the bare host.
   *
   * ⛔ The fix is NOT `https://*.google.com`. That would admit every Google
   * property on the internet to buy one endpoint, and this list exists to name
   * what a page actually talks to.
   *
   * The cost of getting this wrong is the worst shape a measurement failure
   * has: the tag loads, the site looks fine, and the reports go quiet with
   * nothing saying why — pageviews AND Core Web Vitals, since web-vitals
   * events ride the same transport.
   */
  'https://www.google-analytics.com',
  'https://*.google-analytics.com',
  'https://analytics.google.com',
  'https://*.analytics.google.com',
  // Google Signals.
  'https://stats.g.doubleclick.net',
  /*
   * GA4 → Google Ads AUDIENCE BUILDING, and a separate host from the Signals
   * beacon above rather than a duplicate of it.
   *
   * With ads personalization on, gtag follows its collect hit with an image to
   * `td.doubleclick.net/td/ga/rul?tid=<measurement id>` — the redirect that
   * joins the GA4 session to the Ads cookie so a property's audiences can
   * export. `stats.g.doubleclick.net` does NOT cover it: they are different
   * hosts, and CSP matches hosts.
   *
   * Measured blocked on aglyn.com: a live probe raised
   * `securitypolicyviolation { effectiveDirective: 'img-src', blockedURI:
   * 'https://td.doubleclick.net/td/ga/rul' }` while every other Google
   * endpoint on this list passed. It is the failure shape the block comment
   * above warns about — the tag loads, the site looks fine, and the thing that
   * goes quiet is remarketing, which reports nothing anywhere.
   */
  'https://td.doubleclick.net',
  // Google Ads conversion tracking.
  'https://googleads.g.doubleclick.net',
  'https://www.googleadservices.com',
  /*
   * Google's CROSS-CLIENT MEASUREMENT collector, and a fourth doubleclick host
   * rather than a duplicate of the three above.
   *
   * With a Google Ads conversion tag alongside GA4, gtag posts a `fetch` to
   * `ad.doubleclick.net/ccm/s/collect` — the hit that reconciles a conversion
   * across the ad and analytics identities. No wildcard reaches it from the
   * `*.g.doubleclick.net` hosts already listed, because `ad.` is a sibling
   * label, and CSP matches hosts.
   *
   * Measured as a `connect-src` refusal on a live load of
   * `https://aglyn.com/pricing`, raised twice — once by the CSP itself and
   * once by the Fetch API failing the request — while `td.`, `stats.g.` and
   * `googleads.g.` all passed.
   */
  'https://ad.doubleclick.net',
  // Meta pixel: the beacon and the loader that installs it.
  'https://www.facebook.com',
  'https://connect.facebook.net',
  /*
   * LinkedIn Insight Tag: the library host and the beacon it posts to.
   * `www.linkedin.com` is where the tag redirects the beacon for logged-in
   * members, so allowing only the pixel host leaves that population reporting.
   *
   * The pixel host is WILDCARDED because it is a SHARD, the same shape as
   * `*.firebaseio.com` above: the tag picks a numbered prefix per page view,
   * and pinning the bare `px.` host reaches none of them. Measured with img
   * and connect probes from a live `https://aglyn.com/` document under the
   * enforcing policy:
   *
   * | host                       | verdict                      |
   * | -------------------------- | ---------------------------- |
   * | `px.ads.linkedin.com`      | allowed                      |
   * | `px1.ads.linkedin.com`     | **REFUSED**, img + connect   |
   * | `px2.ads.linkedin.com`     | **REFUSED**, img + connect   |
   * | `px3.ads.linkedin.com`     | **REFUSED**, img + connect   |
   * | `px4.ads.linkedin.com`     | **REFUSED**, img + connect   |
   *
   * The tag served `px4` on every load of the marketing site, so the pinned
   * host was the one prefix that never arrived — the failure shape this list
   * exists to prevent, where the tag loads, the page looks right, and the
   * conversions are simply absent.
   */
  'https://snap.licdn.com',
  'https://*.ads.linkedin.com',
  'https://www.linkedin.com',
  // Every Google country domain, for the remarketing pixel. `www.google.com`
  // is the first entry of that list, so it is not repeated here.
  ...GOOGLE_CCTLD_ORIGINS,
]

/**
 * The same vendors for `connect-src`, minus the country domains (AGL-1152).
 *
 * The measurement tags do not only fetch pixels — GA4's pageview hit is an
 * ordinary `fetch`, and it was measured as one: a production load of
 * `https://aglyn.com/pricing` recorded
 * `fetch https://www.google-analytics.com/g/collect?v=2&tid=G-…` alongside the
 * `www.googletagmanager.com/gtag/js` script. Enforcing `connect-src` without
 * these would leave the tag loaded and every hit refused, which is the worst
 * shape a measurement failure can have: the site looks fine, the reports go
 * quiet, and nothing says why.
 *
 * Derived from the image list rather than retyped, so a vendor added for one
 * directive cannot go missing from the other. The ~190 country domains are the
 * one deliberate subtraction: they exist for a single `<img>` remarketing
 * beacon on `www.google.<tld>/ads/ga-audiences`, so they buy nothing here and
 * would put ~4.8 KB of header on every response for a request shape that never
 * arrives. `https://www.google.com` is kept — it is the vendor's primary host
 * and is the first entry of the country list only by accident of how that list
 * is built, so dropping it would single one entry out of the curated set with
 * no evidence behind the cut.
 */
const MEASUREMENT_CONNECT_ORIGINS = ['https://www.google.com'].concat(
  MEASUREMENT_IMAGE_ORIGINS.filter(
    (origin) => !GOOGLE_CCTLD_ORIGINS.includes(origin),
  ),
)

/**
 * An origin this deployment was CONFIGURED with, or undefined (AGL-1152).
 *
 * The same defensive shape `operatorDomains` uses above, and for the same
 * reason: an unset or malformed value must contribute NOTHING. An empty string
 * concatenated into a source list becomes a bare `https://`, which is a
 * scheme-only source matching every https origin on the internet — the one
 * outcome worse than a missing entry.
 *
 * Returns the ORIGIN rather than the hostname, because these feed directives
 * where a port is meaningful (`http://localhost:4200` is a real console origin
 * in development).
 */
function configuredOrigin(raw) {
  const value = String(raw || '').trim()
  if (!value) return undefined
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(
      url.hostname,
    )) {
      return undefined
    }
    return url.origin
  } catch {
    return undefined
  }
}

/**
 * Where a published site's own runtime fetches from (AGL-1152).
 *
 * ⚠️ EVERY ENTRY IS A MEASURED REQUEST, not a plausible one. This directive
 * decides whether an injected script can post a visitor's session or a
 * shopper's card details to an address of its choosing, and every origin named
 * here is one it may post to instead.
 *
 * `NEXT_PUBLIC_PLUGIN_ORIGIN` is the only cross-origin fetch our own client
 * code makes on an ordinary page, and it was read off production rather than
 * out of the source: a load of `https://aglyn.com/` recorded
 * `fetch https://plugins.aglyn.com/artifacts/{listingId}/{version}/{sha}.bundle`.
 * That is `loadRealmPlugins` pulling an installed marketplace bundle
 * (`libs/aglyn/src/lib/plugin-manager/realm-plugins.ts`). Without it every site
 * with a realm plugin installed loses that plugin, and loses it silently — the
 * loader catches and logs, so the page renders with the feature simply absent.
 *
 * `api.stripe.com` is the storefront Payment Element. `storefront-payment-
 * element.tsx` mounts Stripe's `CheckoutProvider`, whose session and confirm
 * calls go to that host from the top document — the payment iframes are a
 * separate `frame-src` question. Without it a shopper's card submit fails at
 * the last step of a purchase, which is the most expensive moment on the site
 * to break.
 *
 * ⚠️ WHAT THIS ALSO REACHES, and it is easy to miss: a `srcdoc` iframe
 * INHERITS this policy. Measured against a real browser — a sandboxed
 * `srcdoc` child under `connect-src https://example.invalid` reported
 * `connect-src <- http://127.0.0.1:4522/x.json` and its fetch was refused. The
 * Custom HTML block's Embed mode is exactly that shape, so an author's pasted
 * third-party widget fetches under THIS directive, not under a policy of its
 * own. That is what the owner list is for, and why the card copy talks about
 * embeds rather than about our runtime.
 *
 * What is NOT here, because it was measured absent: Firebase. The tenant runs
 * no client Firestore, Auth or App Check — every read is server-side through
 * the Admin SDK — so a published page never opens a `*.googleapis.com`
 * connection, and naming one would authorize an egress that does not exist.
 */
const TENANT_CONNECT_ORIGINS = ['https://api.stripe.com']

function tenantConnectSrcDirective(
  isProduction,
  approvedConnectHosts,
  runsMeasurement,
  siteOrigins,
) {
  // `ws:` alongside `http:` because a source expression matches by scheme
  // group — `http://localhost:*` does not admit `ws://localhost:3000` — and
  // the dev server's HMR socket is the one connection a developer cannot see
  // fail without also losing every reload.
  const development = isProduction
    ? []
    : [
        'http://localhost:*',
        'http://127.0.0.1:*',
        'ws://localhost:*',
        'ws://127.0.0.1:*',
      ]
  const pluginOrigin = configuredOrigin(process.env.NEXT_PUBLIC_PLUGIN_ORIGIN)
  const sources = ["'self'"]
    // The site's own addresses, for the same reason `img-src` carries them: a
    // site with a custom domain attached has two origins and `'self'` is only
    // the one this page was served from.
    .concat(approvedImageHostSources(siteOrigins))
    .concat(TENANT_CONNECT_ORIGINS)
    .concat(pluginOrigin ? [pluginOrigin] : [])
    // Gated exactly as `img-src` gates the same vendors: a site with no
    // analytics has no reason to permit an ad network's endpoint, and one that
    // permits it anyway is describing our convenience instead of the site.
    .concat(runsMeasurement ? MEASUREMENT_CONNECT_ORIGINS : [])
    .concat(approvedImageHostSources(approvedConnectHosts))
    .concat(development)
  return `connect-src ${sources.join(' ')}`
}

/**
 * The players and payment frames a published site embeds (AGL-1152).
 *
 * ⛔ `frame-ancestors` is NOT this, and confusing the two reads as "already
 * allowed": that directive says who may frame US, this one says whom WE may
 * frame. The tenant has shipped the first since AGL-518 and never the second.
 *
 * Every entry is read out of the code that CONSTRUCTS the `src`, which for the
 * two players means the whole set is closed rather than merely observed:
 * `parseVideoEmbedSrc` (`libs/plugins/mui/src/lib/components/blocks.tsx`)
 * takes an author's YouTube or Vimeo URL, extracts the video ID and rebuilds
 * the address itself, so the only two strings it can ever produce are
 * `https://www.youtube-nocookie.com/embed/{id}` and
 * `https://player.vimeo.com/video/{id}`. The raw author URL never reaches the
 * element. Drop either origin and the Video block goes to an empty box on
 * every site that uses one.
 *
 * Stripe is the storefront Payment Element. Measured against a real mount:
 * `elements.create('payment')` put THREE iframes on the page, all on
 * `https://js.stripe.com`. `hooks.stripe.com` is the 3-D Secure challenge and
 * is required by `csp-stripe-payment-element.spec.ts`, which was written
 * against AGL-1944 precisely so that the day this directive appeared it would
 * fail rather than take checkout down quietly.
 *
 * ## What is NOT governed here, measured rather than assumed
 *
 * A `srcdoc` iframe is not checked against `frame-src` at all. Measured in a
 * real browser under `frame-src https://example.invalid`: a `srcdoc` child
 * rendered its content with ZERO violations, while a same-origin `src` frame
 * on the same page reported `frame-src <- …/denied.html`. So the Custom HTML
 * block's Embed mode keeps working untouched — and, in the same measurement, a
 * frame NESTED inside that srcdoc child IS refused, because the child inherits
 * this policy. An author embedding a third-party iframe approves its host.
 *
 * That second result is also why `'self'` is spelled out. `frame-src` has no
 * implicit fallback to same-origin: without it the platform's own frames are
 * refused on their own page.
 */
const TENANT_FRAME_ORIGINS = [
  'https://www.youtube-nocookie.com',
  'https://player.vimeo.com',
  'https://js.stripe.com',
  'https://hooks.stripe.com',
]

/**
 * The console, for the admin bar's silent edit-access probe.
 *
 * `admin-bar.tsx` frames `${consoleOrigin}/edit-access?…&silent=1` to ask
 * whether this visitor may edit the site; without the origin here the probe
 * frame is refused and the bar never appears for anyone.
 *
 * Mirrors `admin-bar-slot.tsx`'s own expression so the policy and the code
 * cannot name different consoles — EXCEPT on a self-host container, which gets
 * only what its operator configured. The reasoning is AGL-2446's, applied to
 * the other direction of framing: an operator's published pages should not
 * carry a policy naming a console Aglyn runs, and a container that configured
 * no console has nothing for the bar to reach anyway.
 */
function tenantConsoleFrameOrigin() {
  const configured = configuredOrigin(process.env.NEXT_PUBLIC_CONSOLE_URL)
  if (configured) return configured
  return process.env.AGLYN_STANDALONE === '1' ? undefined : 'https://app.aglyn.com'
}

function tenantFrameSrcDirective(isProduction, approvedFrameHosts, siteOrigins) {
  const development = isProduction
    ? []
    : ['http://localhost:*', 'http://127.0.0.1:*']
  const pluginOrigin = configuredOrigin(process.env.NEXT_PUBLIC_PLUGIN_ORIGIN)
  const consoleFrame = tenantConsoleFrameOrigin()
  const sources = ["'self'"]
    // The site's own addresses, for the reason `img-src` carries them: a site
    // on a custom domain has two origins and `'self'` is only one of them.
    .concat(approvedImageHostSources(siteOrigins))
    .concat(TENANT_FRAME_ORIGINS)
    // The marketplace sandbox. `PluginFrame` points an iframe at this origin
    // for every installed executable plugin, and the cross-origin boundary IS
    // the sandbox — without the entry the plugin renders as nothing at all.
    .concat(pluginOrigin ? [pluginOrigin] : [])
    .concat(consoleFrame ? [consoleFrame] : [])
    .concat(approvedImageHostSources(approvedFrameHosts))
    .concat(development)
  return `frame-src ${sources.join(' ')}`
}

const APPROVED_IMAGE_HOSTS_MAX = 50

/**
 * A hostname a site owner may add, or null (AGL-1152).
 *
 * ⛔ THIS IS AN ALLOWLIST BUILT FROM CUSTOMER-EDITABLE DATA, so it is parsed
 * rather than trusted. The failure mode is not a broken header — it is a
 * header that silently permits more than the owner asked for. Anything with a
 * scheme, a path, a port, whitespace, a comma or a semicolon is REFUSED
 * outright rather than sanitised: `evil.com; script-src *` cannot be repaired
 * into something safe, and a value that has to be repaired is a value nobody
 * should be shipping into a policy.
 *
 * A single leading `*.` is allowed — CSP understands it and image CDNs are
 * routinely per-account subdomains — but a bare `*` is not, because that is
 * the whole internet wearing an allowlist's clothes.
 */
function normalizeApprovedImageHost(value) {
  if (typeof value !== 'string') return null
  const host = value.trim().toLowerCase()
  if (!host || host.length > 253) return null
  // No scheme, no path, no port, no separators. `img-src` sources are
  // space-delimited, so a space is an injection point, not a typo.
  if (/[\s;,/\\?#@:]/.test(host)) return null
  const bare = host.startsWith('*.') ? host.slice(2) : host
  if (!bare || bare === '*') return null
  // A conservative hostname: labels of alphanumerics and hyphens, at least one
  // dot, no leading/trailing hyphen. Deliberately refuses IP literals — an
  // owner approving a raw address is far more likely a mistake than a CDN.
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(bare)) {
    return null
  }
  return `https://${host}`
}

/**
 * The hosts a site has approved, cleaned and bounded (AGL-1152).
 *
 * Exported so the console's editor warning and the middleware agree on what
 * counts as approved — a second implementation of this parse is how the editor
 * comes to promise something the header does not deliver.
 */
function approvedImageHostSources(approved) {
  if (!Array.isArray(approved)) return []
  const seen = new Set()
  const out = []
  for (const entry of approved) {
    const source = normalizeApprovedImageHost(entry)
    if (!source || seen.has(source)) continue
    seen.add(source)
    out.push(source)
    if (out.length >= APPROVED_IMAGE_HOSTS_MAX) break
  }
  return out
}

/**
 * PER-SITE since AGL-1152, and that is what makes the enforcing flip reachable.
 *
 * AGL-1726 read the evidence and refused to enforce this directive, for two
 * reasons that both dissolve once the list belongs to the site owner:
 *
 *   - Condition 2, the one that actually decided it: hotlinking an external
 *     image is an ADVERTISED authoring feature, so a first-party-only enforced
 *     `img-src` would silently revoke a documented capability from every
 *     published site at once. An owner-approved list revokes nothing — it
 *     enforces what that owner chose, and the editor warns at authoring time
 *     so a refusal is never the first anyone hears of it.
 *   - Condition 6, which it said should stop the flip on its own: "a rollback
 *     that does not need a deploy... the directive is a build-time constant in
 *     `security-origins.js`". It is not a constant any more. The list is host
 *     data, so widening or emptying it is a Firestore write that propagates
 *     within the verdict TTL, with no Vercel build in the path.
 *
 * ⚠️ STILL ISR-SAFE, and for the same reason the shipped version was. AGL-1228
 * removed a report-only `script-src` because a per-REQUEST nonce cannot match
 * cached bytes. This is per-HOST, not per-request: every response for one site
 * carries the identical string, and the policy lives in a header rather than
 * in the cached body, so there is nothing for the two to disagree about. Do
 * not read "it varies" as "it is per-request" — that is the distinction the
 * whole directive turns on.
 *
 * `firebasestorage.googleapis.com` is PINNED via `TENANT_IMAGE_ORIGINS` and is
 * deliberately not owner-removable (AGL-1726 condition 5): orgs without the
 * paid `mediaCdn` entitlement store absolute download URLs rather than `media:`
 * references, so an owner who deleted it would blank their own free-tier
 * images while paying customers' sites kept working.
 */
function tenantImgSrcDirective(
  isProduction,
  approvedImageHosts,
  runsMeasurement,
  siteOrigins,
) {
  const development = isProduction
    ? []
    : ['http://localhost:*', 'http://127.0.0.1:*']
  const sources = ["'self'", 'data:', 'blob:']
    // THE SITE'S OWN ADDRESSES, always (AGL-1152).
    //
    // `'self'` is only the origin the page was SERVED from, and a site with a
    // custom domain attached has two: `{subdomain}.{apex}` and the domain
    // itself. Content authored before an attach references the platform
    // subdomain; content authored after references the custom domain; a
    // visitor gets whichever origin they arrived on, so on an enforced policy
    // one of the two halves is refused on its own site. The owner should not
    // have to approve their own address to make their own images load, and
    // would have no way to know they must.
    .concat(approvedImageHostSources(siteOrigins))
    .concat(TENANT_IMAGE_ORIGINS)
    // Only for a site that configured a measurement id. A site with no
    // analytics has no reason to permit an ad network's beacon, and a policy
    // that permits one anyway is documenting our convenience, not its needs.
    .concat(runsMeasurement ? MEASUREMENT_IMAGE_ORIGINS : [])
    .concat(approvedImageHostSources(approvedImageHosts))
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
  TENANT_FONT_ORIGINS,
  tenantMediaSrcDirective,
  tenantFontSrcDirective,
  tenantFormActionDirective,
  approvedImageHostSources,
  normalizeApprovedImageHost,
  APPROVED_IMAGE_HOSTS_MAX,
  MEASUREMENT_IMAGE_ORIGINS,
  MEASUREMENT_CONNECT_ORIGINS,
  GOOGLE_CCTLD_ORIGINS,
  TENANT_CONNECT_ORIGINS,
  tenantConnectSrcDirective,
  TENANT_FRAME_ORIGINS,
  tenantFrameSrcDirective,
}
