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
 * NOT covered, and deliberately: cookies set by third-party SDKs we load
 * (Stripe's `__stripe_mid`/`__stripe_sid`, Google's `_ga`/`_ga_<id>` and
 * `_GRECAPTCHA`). No line of ours writes them, so no scan of ours can find
 * them. They are listed in `THIRD_PARTY_COOKIES` below so the inventory is
 * complete for a reader, and the spec asserts each named loader is still
 * imported somewhere — a integration we drop must lose its policy row too.
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

export const COOKIE_WRITERS: Record<string, CookieWriter> = {
  'apps/console/app/api/auth/session/route.ts': {
    note: 'Mints and clears the console session on sign-in and sign-out.',
    cookies: [
      {
        name: '__session',
        token: "'__session'",
        surface: 'app.aglyn.com and workspace subdomains of aglyn.com',
        purpose: 'Keeps you signed in to the console',
        duration: '14 days (a sign-out tombstone lasts 24 hours)',
        httpOnly: true,
      },
      {
        name: '__session_tenant',
        token: "'__session_tenant'",
        surface: 'app.aglyn.com and workspace subdomains of aglyn.com',
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
        surface: 'app.aglyn.com',
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
        surface: 'app.aglyn.com and workspace subdomains of aglyn.com',
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
        surface: 'aglyn.com and its subdomains',
        purpose:
          'Marks the browser as one an Aglyn editor is signed in on, so a site you can edit offers the edit bar. Its value is the literal 1 — no personal data',
        duration: '7 days, cleared on sign-out',
        httpOnly: false,
      },
    ],
  },
  'apps/tenant/app/api/edit-hint/set/route.ts': {
    note: 'The aglyn.app twin of the console editor hint, plus its signed credential.',
    cookies: [
      {
        name: 'aglyn_edit_hint',
        token: 'EDIT_HINT_COOKIE',
        surface: '*.aglyn.app',
        purpose:
          'Signed proof that an Aglyn editor is signed in, exchanged for edit access on a site you administer',
        duration: '7 days',
        httpOnly: true,
      },
      {
        name: 'aglyn_editor',
        token: 'aglyn_editor=1',
        surface: '*.aglyn.app',
        purpose: 'The JS-visible half of the same hint, on the aglyn.app domain',
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
        surface: 'customer sites with commerce (*.aglyn.app and custom domains)',
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
    note: 'Consent engine. It only ever CLEARS analytics cookies (expires them); it sets none of its own — the consent record itself lives in web storage.',
    cookies: [],
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
    names: ['_ga', '_ga_<id>', '_gid'],
    loaderToken: 'ANALYTICS_COOKIE_PREFIXES',
    surface:
      'aglyn.com, app.aglyn.com (loaded through the Firebase SDK, not a gtag tag), docs.aglyn.com, and customer sites that configure their own id',
    purpose: 'Measures how the site is used',
  },
  Stripe: {
    names: ['__stripe_mid', '__stripe_sid'],
    loaderToken: 'loadStripe',
    surface:
      'app.aglyn.com at checkout, and every customer storefront that takes payment',
    purpose: 'Fraud prevention and payment session continuity',
  },
  'Google reCAPTCHA': {
    names: ['_GRECAPTCHA'],
    loaderToken: 'ReCaptchaEnterpriseProvider',
    surface: 'app.aglyn.com, set on google.com by Firebase App Check',
    purpose: 'Bot protection',
  },
}
