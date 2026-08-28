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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/server'

/**
 * Every cookie the product sets, and where (AGL-1918).
 *
 * The Cookie Policy names the cookies we set. It is besigner content on the
 * live marketing site — not a file in this repo, and not one of the hashed
 * `constants/legal/v*` snapshots, which cover only Terms and Privacy. So
 * nothing in the build could ever notice the policy going out of date, and the
 * only detector was a person reading both the page and the code at the same
 * time.
 *
 * That detector has already failed once in the direction that matters: an
 * audit run for this issue found five cookies set in production and absent
 * from the published table (`aglyn_editor` on two registrable domains,
 * `aglyn_edit_hint`, Stripe's `__stripe_mid`/`__stripe_sid`, and `_gid`). A
 * table that under-reports is the compliance problem; a table listing cookies
 * we no longer set is the other half.
 *
 * This registry cannot check the published page. What it CAN do is make a new
 * cookie impossible to add silently: `cookie-inventory.spec.ts` scans the repo
 * for cookie writes and fails on any file not declared here. Declaring one
 * means naming the cookie and saying what the Cookie Policy has to say about
 * it — which is the moment to notice the policy needs a new row.
 *
 * NOT covered by the writer scan, and deliberately: cookies set by third-party
 * SDKs we load (Stripe's `__stripe_mid`/`__stripe_sid`, Google's `_ga`/
 * `_ga_<id>` and `_GRECAPTCHA`). No line of ours writes them, so no scan of
 * ours can find them. They are listed in `THIRD_PARTY_COOKIES` below so the
 * inventory is complete for a reader, and the spec asserts each named loader
 * is still imported somewhere — an integration we drop must lose its policy
 * row too.
 *
 * ## The blind spot that let the advertising rows go missing (AGL-2486)
 *
 * That writer scan is structurally incapable of finding an advertising vendor,
 * and this is worth stating because the same shape will recur. The scan keys
 * on code that WRITES a cookie; our advertising code only ever CLEARS one.
 * `META_PIXEL_VENDOR` has declared `cookiePrefixes: ['_fbp', '_fbc']` since
 * AGL-1649 — the platform knew the names, used them to sweep, and still had no
 * row here, because a guard that can only see writers misses every vendor
 * whose tag sets cookies from a script we do not author. That is most of them.
 *
 * So `THIRD_PARTY_COOKIES` is now checked in BOTH directions for advertising:
 * the "still loaded" direction lives in `cookie-inventory.spec.ts` beside the
 * writer scan, and the coverage direction — every vendor the gate can load has
 * an entry naming every prefix it declares — lives in
 * `apps/tenant/specs/advertising-tag-gate.spec.tsx` as case (g). The vendor
 * registry is the right key precisely because it is written for teardown, so
 * it cannot be complete enough to revoke a vendor while being too incomplete
 * to disclose it.
 *
 * That check is in the TENANT spec rather than here for a reason worth not
 * re-litigating: it was written here first and turned case (f) of that same
 * file red, because `apps/console` importing `app-utils/advertising-tags` is
 * exactly the DPA §3.2 boundary (f) defends — no ad-vendor machinery in the
 * app where customers' own data lives. The guard was right. So the check moved
 * to the side that may legitimately hold the registry and reads THIS file as
 * source text, which is how (f) reads console files too: no import, and no
 * dependency edge in either direction.
 */

/** One first-party cookie, as the Cookie Policy has to describe it. */
export interface FirstPartyCookie {
  /** Literal name, or the `{placeholder}` form for a per-site cookie. */
  readonly name: string
  /**
   * A string that must still appear in the writing file. It is the literal
   * that produces the name — a constant's value, or a template's prefix — so
   * renaming the cookie without revisiting this entry fails.
   */
  readonly token: string
  /** Which hosts serve it. */
  readonly surface: string
  /** Plain-language purpose, in the words the policy should use. */
  readonly purpose: string
  /** How long it lasts, in the words the policy should use. */
  readonly duration: string
  readonly httpOnly: boolean
}

/** Files that write a cookie, and what they write. */
export interface CookieWriter {
  readonly cookies: readonly FirstPartyCookie[]
  /** Why this file writes cookies at all — one line, for the next reader. */
  readonly note: string
  /**
   * Set when the writer has no call site, so nothing reaches a browser. Such
   * an entry must NOT appear in the Cookie Policy — disclosing a cookie we do
   * not set is the stale half of the same defect.
   */
  readonly dead?: string
}

/**
 * The surfaces below name hosts, and this file feeds the Cookie Policy — so a
 * self-hosted deployment would otherwise publish a compliance document naming
 * Aglyn's own hostnames, with no way to correct it short of editing source.
 * That is the one thing the self-host rule forbids, and it is why
 * `selfhost-hardcoded-hosts.spec.ts` fires here.
 *
 * Allow-listing the count would have been the cheap answer and the wrong one:
 * every other entry in that allowlist earns its place by being a READER of a
 * `NEXT_PUBLIC_*` var whose literal is merely the default. This file now meets
 * the same bar, using the same two vars (and the same defaults) as the console
 * routes that already read them.
 *
 * Dot access, not bracket access: Next substitutes these names textually at
 * build time and only in dot form. Indexing `process.env` by a quoted key is
 * never substituted, so the read is undefined in a browser bundle and the
 * value silently falls back to its default — which on a self-host install
 * means ours. That is what left CNAME_TARGET un-substituted in AGL-2037.
 * (Spelling the bracket form here literally would trip
 * `check:next-public-access`, which scans source text and does not skip
 * comments — so the rule is described rather than shown.)
 */
// The Cookie Policy is customer-facing and a white-label org must not read
// our brand in it, so the surface prose uses the configured name (AGL-2153).
const CONSOLE_HOST = (
  process.env.NEXT_PUBLIC_CONSOLE_URL || 'https://app.aglyn.com'
)
  .replace(/^https?:\/\//, '')
  .replace(/\/+$/, '')

const WORKSPACE_DOMAIN = process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN ?? 'aglyn.com'

// No code default exists for this one — `apps/tenant/middleware.ts` matches it
// only when set — so the literal here is Aglyn's own deployment value, and a
// self-hoster's `.env` (see .env.example: sites.example.com) replaces it.
const TENANT_DOMAIN = process.env.NEXT_PUBLIC_TENANT_DOMAIN ?? 'aglyn.app'

export const COOKIE_WRITERS: Record<string, CookieWriter> = {
  'apps/console/app/auth/handoff/start/route.ts': {
    note:
      'Sets the cross-domain handoff VERIFIER before bouncing to the auth ' +
      'host (AGL-1902). Host-only and deliberately NOT `Domain`-scoped: a ' +
      "customer controls their own domain's DNS, so a wider cookie could be " +
      'shadowed by one they set.',
    cookies: [
      {
        name: '__aglyn_handoff',
        token: 'HANDOFF_VERIFIER_COOKIE',
        surface: 'A custom console domain, host-only',
        purpose:
          'Proves the browser that finishes a cross-domain sign-in is the ' +
          'one that started it',
        duration: '15 minutes, and cleared the moment it is redeemed',
        httpOnly: true,
      },
    ],
  },
  'apps/console/app/api/auth/handoff/redeem/route.ts': {
    note:
      'Clears the handoff verifier on redemption — success or refusal ' +
      '(AGL-1902). It writes only an expiry, never a value.',
    cookies: [
      {
        name: '__aglyn_handoff',
        token: 'HANDOFF_VERIFIER_COOKIE',
        surface: 'A custom console domain, host-only',
        purpose:
          'Proves the browser that finishes a cross-domain sign-in is the ' +
          'one that started it',
        duration: 'Cleared here; single-use',
        httpOnly: true,
      },
    ],
  },
  'apps/console/app/api/auth/session/route.ts': {
    note: 'Mints and clears the console session on sign-in and sign-out.',
    cookies: [
      {
        name: '__session',
        token: "'__session'",
        surface: `${CONSOLE_HOST} and workspace subdomains of ${WORKSPACE_DOMAIN}`,
        purpose: 'Keeps you signed in to the console',
        duration: '14 days (a sign-out tombstone lasts 24 hours)',
        httpOnly: true,
      },
      {
        name: '__session_tenant',
        token: "'__session_tenant'",
        surface: `${CONSOLE_HOST} and workspace subdomains of ${WORKSPACE_DOMAIN}`,
        purpose:
          'Records which sign-in context (enterprise SSO tenant) the session belongs to',
        duration: '14 days',
        httpOnly: true,
      },
      {
        // Minted here, named in `_lib/security-alerts.ts`. The scan is by
        // WRITING file, so it belongs to the route that sets it and not to
        // the module that declares the constant.
        name: 'aglyn_device',
        token: 'DEVICE_COOKIE',
        surface: CONSOLE_HOST,
        purpose:
          'Recognises a device you have signed in from before, so a sign-in from a new one can be flagged to you',
        duration: '365 days',
        httpOnly: true,
      },
    ],
  },
  'apps/console/app/api/auth/activity/route.ts': {
    note: 'Server-authoritative last-activity stamp for idle sign-out (AGL-697).',
    cookies: [
      {
        name: 'aglyn_session_activity',
        token: 'ACTIVITY_COOKIE',
        surface: `${CONSOLE_HOST} and workspace subdomains of ${WORKSPACE_DOMAIN}`,
        purpose: 'Last-activity timestamp, so an idle session is signed out',
        duration: '24 hours',
        httpOnly: true,
      },
    ],
  },
  'apps/console/components/editor-hint-cookie.component.tsx': {
    note: 'Editor-presence hint so a first-party tenant site arms the admin bar (AGL-1829).',
    cookies: [
      {
        name: 'aglyn_editor',
        token: "'aglyn_editor'",
        surface: `${WORKSPACE_DOMAIN} and its subdomains`,
        purpose:
          `Marks the browser as one an ${PLATFORM_BRAND_NAME} editor is signed in on, so a site you can edit offers the edit bar. Its value is the literal 1 — no personal data`,
        duration: '7 days, cleared on sign-out',
        httpOnly: false,
      },
    ],
  },
  'apps/tenant/app/api/edit-hint/set/route.ts': {
    note: `The ${TENANT_DOMAIN} twin of the console editor hint, plus its signed credential.`,
    cookies: [
      {
        name: 'aglyn_edit_hint',
        token: 'EDIT_HINT_COOKIE',
        surface: `*.${TENANT_DOMAIN}`,
        purpose:
          `Signed proof that an ${PLATFORM_BRAND_NAME} editor is signed in, exchanged for edit access on a site you administer`,
        duration: '7 days',
        httpOnly: true,
      },
      {
        name: 'aglyn_editor',
        token: 'aglyn_editor=1',
        surface: `*.${TENANT_DOMAIN}`,
        purpose: `The JS-visible half of the same hint, on the ${TENANT_DOMAIN} domain`,
        duration: '7 days',
        httpOnly: false,
      },
    ],
  },
  'apps/tenant/middleware.ts': {
    note: 'Carries a `?tenantHost=` preview override across a browsing session.',
    cookies: [
      {
        name: 'aglyn-tenant-host',
        token: "'aglyn-tenant-host'",
        surface: 'preview and branch deployments',
        purpose:
          'Operational: remembers which site a preview URL was pointed at',
        duration: 'until the browser is closed',
        httpOnly: false,
      },
    ],
  },
  'libs/plugins/commerce/src/lib/server/cart.ts': {
    note: 'Guest cart identity on a storefront; the name is built in cart-cookie.ts.',
    cookies: [
      {
        name: 'aglyn_cart_{siteId}',
        token: 'cartCookieName',
        surface: `customer sites with commerce (*.${TENANT_DOMAIN} and custom domains)`,
        purpose: 'Remembers the shopping cart you have built, before checkout',
        duration: '90 days',
        httpOnly: true,
      },
    ],
  },
  'libs/plugins/commerce/src/lib/server/membership.ts': {
    note: 'Signed member session for a site that sells memberships.',
    cookies: [
      {
        name: 'aglyn_member_{siteId}',
        token: 'aglyn_member_',
        surface: 'customer sites with memberships',
        purpose: 'Keeps you signed in as a member of that site',
        duration: '30 days',
        httpOnly: true,
      },
    ],
  },
  'libs/shared/ui/theme/src/lib/hocs/create-with-theme-provider.tsx': {
    note: 'Light/dark preference, written by the theme switcher.',
    cookies: [
      {
        name: 'theme-color-mode',
        token: "'theme-color-mode'",
        surface: 'the console and customer sites that offer a theme switcher',
        purpose: 'Your light/dark theme preference',
        duration: '365 days',
        httpOnly: false,
      },
    ],
  },
  'libs/aglyn/src/lib/app-utils/visitor-consent.ts': {
    note: 'Consent engine. It only ever CLEARS cookies (expires them) — the analytics prefixes, and any prefix set an advertising vendor is registered with; it sets none of its own, the consent record itself lives in web storage.',
    cookies: [],
  },
  'libs/aglyn/src/lib/app-utils/platform-visitor-consent.ts': {
    note:
      "Mirrors the console visitor's own consent record between the hostnames " +
      'the console is served on. `app.` and `auth.` are one application on two ' +
      'origins — interactive sign-in is delegated to the auth host — and web ' +
      'storage is per origin, so without this an explicit opt-out on one is ' +
      'invisible to the other, which then writes an implied default from the ' +
      'posture. STRICTLY NECESSARY: it is how a "no" is remembered, so it is ' +
      'exempt from the consent it records. Written only where the whole ' +
      'registrable domain is ours; a custom console domain gets none.',
    cookies: [
      {
        name: 'aglyn_consent',
        token: 'PLATFORM_CONSENT_COOKIE',
        surface: `${CONSOLE_HOST} and the auth host, at .${WORKSPACE_DOMAIN}`,
        purpose:
          'Remembers your privacy choice across the console hostnames, so an ' +
          'answer given while signing in still applies once you are inside',
        duration: '13 months',
        // Readable by the page, and it has to be: the analytics gate consults
        // the record synchronously in the browser, before any request goes out.
        httpOnly: false,
      },
    ],
  },
  'libs/shared/util/http/src/lib/cookie-set-user-id-token.ts': {
    note: 'A pre-Firebase-session-cookie helper.',
    dead: 'No call site outside its own module and reader — grep `cookieSetUserIdToken`. Nothing reaches a browser, so `aglyn-user-token` must NOT appear in the Cookie Policy.',
    cookies: [
      {
        name: 'aglyn-user-token',
        token: 'COOKIE_KEY_USER_TOKEN',
        surface: 'none — the writer is unreachable',
        purpose: 'none — it never reaches a browser',
        duration: 'none — no call site',
        httpOnly: true,
      },
    ],
  },
  'libs/shared/util/rest-api/src/lib/set-api-response-cookie.ts': {
    note: 'A generic Set-Cookie helper.',
    dead: 'No call site — grep `setApiResponseCookie`. It names no cookie of its own.',
    cookies: [],
  },
}

/** A cookie set by an SDK we load, which no scan of our own code can find. */
export interface ThirdPartyCookies {
  /** Names, or name shapes, the vendor sets. */
  readonly names: readonly string[]
  /** A symbol that must still be imported somewhere, proving we load it. */
  readonly loaderToken: string
  readonly surface: string
  readonly purpose: string
}

export const THIRD_PARTY_COOKIES: Record<string, ThirdPartyCookies> = {
  'Google Analytics': {
    // `_gac_<id>` belongs here and was missing (AGL-2486). It is the Google
    // Ads linking cookie, named in `ANALYTICS_COOKIE_PREFIXES`'s own comment
    // and swept by the `_ga` prefix, so the code has always known about it and
    // only the disclosure did not.
    names: ['_ga', '_ga_<id>', '_gac_<id>', '_gid'],
    loaderToken: 'ANALYTICS_COOKIE_PREFIXES',
    surface:
      `${WORKSPACE_DOMAIN}, ${CONSOLE_HOST} (loaded through the Firebase SDK, not a gtag tag), the docs site, and customer sites that configure their own id`,
    purpose: 'Measures how the site is used',
  },
  /**
   * The advertising category (AGL-1649/AGL-2402), disclosed by CAPABILITY
   * rather than by rollout — the standing rule, and the published Cookie
   * Policy (2026-08-20) already names Google and Meta, so the inventory is the
   * half that was behind.
   *
   * Every entry is reached only where the visitor's recorded state grants the
   * advertising category on a surface that asks about it. Outside the
   * prior-consent regions that state can be `implied` — recorded on the first
   * visit, with the persistent opt-out control as the withdrawal path — and
   * inside them it can only ever be an explicit yes. Nothing is set at all on
   * a site that never asked. That matches what the published Cookie Policy
   * tells visitors about `_gac`, `_gcl_au`, `_fbp` and `_fbc` — "set only
   * where you have allowed advertising cookies".
   *
   * ⚠️ The SURFACES widened when the console and the docs site grew
   * advertising mounts of their own. Both rows below name them, because the
   * question a reader of the Cookie Policy asks is "where", and an inventory
   * that answered it for one surface only would be accurate and misleading.
   */
  'Google advertising (ad_storage)': {
    // Set by gtag's conversion linker once `ad_storage` is granted. Distinct
    // from the analytics row above because `_gcl_au` does NOT start with `_ga`
    // and is therefore not covered by the analytics sweep — see the note on
    // `ANALYTICS_COOKIE_PREFIXES`.
    names: ['_gcl_au'],
    loaderToken: 'consentModeSignals',
    surface:
      `${WORKSPACE_DOMAIN}, ${CONSOLE_HOST} and the docs site, and customer sites whose owner enabled the advertising question and configured a Google Analytics id. A Google Tag Manager container writes the same cookies through whatever advertising tags it carries, which is why the sweep for these does not wait to find a script element of ours`,
    purpose:
      'Attributes an ad click to what you did on the site, and measures whether an ad worked',
  },
  'Meta Pixel': {
    names: ['_fbp', '_fbc'],
    loaderToken: 'META_PIXEL_VENDOR',
    surface: `${WORKSPACE_DOMAIN} — ${PLATFORM_BRAND_NAME}'s own marketing site, gated by \`isPlatformMarketingHost\`; ${CONSOLE_HOST} and the docs site, each gated on that surface's own advertising grant; a Host operator may enable their own tag on their site`,
    purpose:
      'Shows you our ads on other sites, and measures whether they worked',
  },
  'LinkedIn Insight Tag': {
    names: [
      'li_sugr',
      'UserMatchHistory',
      'AnalyticsSyncHistory',
      'bcookie',
      'lidc',
      'li_gc',
    ],
    loaderToken: 'LINKEDIN_INSIGHT_VENDOR',
    surface: `${WORKSPACE_DOMAIN}, ${CONSOLE_HOST} and the docs site — each gated on that surface's own advertising grant — and customer sites whose owner configured a LinkedIn partner id and enabled the advertising question`,
    purpose:
      'Shows you our ads on LinkedIn, and measures whether they worked',
  },
  Stripe: {
    names: ['__stripe_mid', '__stripe_sid'],
    loaderToken: 'loadStripe',
    surface:
      `${CONSOLE_HOST} at checkout, and every customer storefront that takes payment`,
    purpose: 'Fraud prevention and payment session continuity',
  },
  'Google reCAPTCHA': {
    names: ['_GRECAPTCHA'],
    loaderToken: 'ReCaptchaEnterpriseProvider',
    surface: `${CONSOLE_HOST}, set on google.com by Firebase App Check`,
    purpose: 'Bot protection',
  },
}
