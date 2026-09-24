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
 * What this deployment calls itself (AGL-2153).
 *
 * the rule for the self-host path: *"the self hosted owner should not have
 * to edit the source to update aglyn branded items urls or personal
 * identification items, should move these to env vars"*. AGL-2016 did that for
 * the values where getting it wrong misroutes a legal notice. This is the
 * other half — the product name itself, which was a bare `'Aglyn'` literal in
 * nine places.
 *
 * ## Why one module rather than nine reads
 *
 * The literals were not merely duplicated, they were duplicated across a
 * boundary: `PLATFORM_GENERATOR_NAME` exists here AND as a hand-copied
 * constant in `apps/tenant/middleware.ts`, because the edge bundle cannot
 * import this lib. A single source they both read is what stops the copy from
 * drifting into a deployment that half-renames itself.
 *
 * ## Why a default at all, when operator-identity.ts refuses to have one
 *
 * `operator-identity.ts` sets out the rule and it is the right one: a value
 * whose wrongness is invisible to the operator and visible only off-site must
 * not be guessed. The brand is the opposite case. An operator who does not set
 * it sees "Aglyn" in their own browser tab on their own first page load, in
 * their own console. That is a default they can see and correct, which is a
 * default rather than a trap — the same test AGL-2022 applied to the tenant
 * apex.
 *
 * ## Why `NEXT_PUBLIC_`, and why dot notation is load-bearing
 *
 * The brand is printed to the public — that is what it is for — so
 * `NEXT_PUBLIC_` carries no disclosure risk. Next inlines `NEXT_PUBLIC_*` into
 * the browser bundle by textually substituting `process.env.NAME`; the
 * **bracket** form is never substituted and reads `undefined` in the browser
 * (AGL-2037). Every read below is dot notation on purpose.
 *
 * Build-time consequence for self-hosters: these are baked in when the image
 * is built, so they must be set *before* `docker compose build`, not merely
 * before `up`. `docs/SELF_HOSTING.md` says so.
 */

/** A non-empty trimmed string, else undefined — `'   '` is a half-finished `.env`. */
const clean = (value: unknown): string | undefined => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length ? text : undefined
}

/**
 * The product name, as shown to end users.
 *
 * This is the browser-tab affix, the PWA name, the WebAuthn relying-party name
 * the OS credential prompt displays, the `<meta name="generator">` and
 * `x-powered-by` on published sites, and the platform default `productName` /
 * `fromName` every non-white-label org's surfaces resolve to.
 */
export const PLATFORM_BRAND_NAME =
  clean(process.env.NEXT_PUBLIC_PLATFORM_BRAND_NAME) ?? 'Aglyn'

/**
 * The legal entity operating the software's own cloud, for copy that needs a
 * company rather than a product (`BRAND.ORG_NAME_LEGAL`).
 *
 * NOT the same thing as `operatorIdentity().name`, and the distinction matters.
 * This is a *brand* string with a visible default; that one is the identity a
 * statutory notice is addressed to and refuses to default. An operator who
 * sets only this has renamed the product, not published who they are.
 */
export const PLATFORM_BRAND_LEGAL_NAME =
  clean(process.env.NEXT_PUBLIC_PLATFORM_BRAND_LEGAL_NAME) ??
  `${PLATFORM_BRAND_NAME} LLC`

/**
 * Where a "need help?" line points.
 *
 * Falls through the operator's OWN support address before it falls back to
 * ours, deliberately: an operator who followed the runbook has already set
 * `NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL`, and making them discover a second
 * variable to stop pointing their customers at Aglyn's support desk — which
 * cannot help those customers with anything — is a trap dressed as a default.
 *
 * Read here rather than imported from `operator-identity.ts` so this module
 * stays dependency-free and safe to import from anywhere, including the places
 * that cannot take the operator module's weight.
 *
 * ## Why the last fallback is the CONSOLE and not the marketing site
 *
 * It was `aglyn.com/support`, which answers 404 and has never existed
 * (AGL-3262) — MEASURED against the live site, not inferred: `/support`,
 * `/help` and `/docs` all render the not-found page and none is in the
 * sitemap. A support URL that 404s is worse than none, because it is printed
 * on a receipt beside a charge the reader is already unsure about.
 *
 * `app.aglyn.com/support` is a real page (AGL-3265): it resolves the
 * workspace from the session, so a customer with one lands on its support
 * umbrella and a customer with several picks. That is the whole reason it
 * exists — it is the one support address that needs nothing interpolated
 * into it, which is exactly what this constant is.
 *
 * ⚠️ The residual, stated rather than hidden: on a SELF-HOSTED install that
 * configured neither variable above, this now points a stranger's customers
 * at our console, where they have no account. That was already true of the
 * old value and is not made worse by fixing it — and the step above is the
 * real answer, which is why it is the operator's support MAILBOX rather than
 * a second URL variable they would have to discover.
 */
export const PLATFORM_SUPPORT_URL: string = (() => {
  const configured = clean(process.env.NEXT_PUBLIC_PLATFORM_SUPPORT_URL)
  if (configured) return configured
  const operatorEmail = clean(process.env.NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL)
  if (operatorEmail) return `mailto:${operatorEmail}`
  return 'https://app.aglyn.com/support'
})()

/** True when this deployment still answers to Aglyn's own brand. */
export const isAglynOperatedBrand = (): boolean =>
  PLATFORM_BRAND_NAME === 'Aglyn'

/**
 * Where the platform's own front door is — the marketing home, not the help
 * desk.
 *
 * ## Why this is not `PLATFORM_SUPPORT_URL`
 *
 * The "Made with …" badge on a published free-tier site used to link to
 * `supportUrl`, and on this deployment `supportUrl` falls through to
 * `mailto:` + the operator support address. So the one link the platform gets
 * on every free customer's site — its only organic acquisition surface —
 * opened the visitor's mail client addressed to our support desk. A visitor
 * who liked the site and clicked to find out what built it got a blank email,
 * and support got the misdirected replies.
 *
 * They are genuinely different destinations. `supportUrl` answers "I am a
 * customer and something is wrong"; this answers "what is this, and can I have
 * one". Keeping one value for both guarantees one of them is wrong.
 *
 * ## Why it is null rather than aglyn.com off-brand
 *
 * A self-hosted deployment that renamed the product but set no home URL has
 * nowhere honest to send that visitor: "Made with Foo" pointing at aglyn.com
 * advertises the wrong company on Foo's customers' sites. The badge already
 * renders as a plain label when it has no destination (AGL-2428), which is the
 * correct outcome — so the Aglyn default applies only while this really is the
 * Aglyn-operated brand.
 */
export const PLATFORM_HOME_URL: string | null =
  clean(process.env.NEXT_PUBLIC_PLATFORM_HOME_URL) ??
  (isAglynOperatedBrand() ? 'https://aglyn.com' : null)

/**
 * The platform's own logo MARK — the compact, square, no-wordmark form — as a
 * URL an `<img>` on a PUBLISHED SITE can load.
 *
 * Site-relative on purpose: every app that renders it serves
 * `public/_static/…` from its own origin, so one path works on
 * `{sub}.aglyn.app` and on a customer's custom domain alike without knowing
 * either. The white variant is the one that survives the badge's dark pill and
 * an org's `primaryColor` behind it.
 *
 * Null unless this is the Aglyn-operated brand, for the same reason as
 * {@link PLATFORM_HOME_URL}: a renamed deployment must not stamp our mark on
 * its customers' sites. Such an operator sets `NEXT_PUBLIC_PLATFORM_MARK_URL`
 * to their own, or gets a text-only badge.
 */
export const PLATFORM_MARK_URL: string | null =
  clean(process.env.NEXT_PUBLIC_PLATFORM_MARK_URL) ??
  (isAglynOperatedBrand()
    ? '/_static/images/brand/aglyn-logo-mark-white.svg'
    : null)

/** An absolute `https://` URL, else undefined — anything else has no origin in an inbox. */
const httpsUrl = (value: string | undefined): string | undefined => {
  if (!value) return undefined
  try {
    return new URL(value).protocol === 'https:' ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * The platform's logo as its own system email draws it: the header of mail
 * sent under the platform's brand (AGL-3322).
 *
 * ABSOLUTE and https, unlike {@link PLATFORM_MARK_URL}. That mark is a
 * site-relative path because every app that draws it serves the file from its
 * own origin; an inbox has no origin, so a relative path there is a
 * broken-image box. A configured value that is not an absolute `https://` URL
 * is ignored rather than handed on to fail in somebody's inbox.
 *
 * The WORDMARK rather than the square mark: a header is read at a glance, and
 * the wordmark names the sender where the mark would need the reader to
 * already know it. This one is the file the Aglyn marketing site's own email
 * header block draws, served from that site's media CDN.
 *
 * Null unless this is the Aglyn-operated brand, for the reason
 * {@link PLATFORM_HOME_URL} is: a renamed deployment must not put our logo at
 * the top of its customers' mail. Such an operator sets
 * `NEXT_PUBLIC_PLATFORM_EMAIL_LOGO_URL`, or gets its product name as the
 * header, in bold text.
 *
 * Deliberately NOT `PLATFORM_BRANDING_PROFILE.emailLogoUrl`, which stays null.
 * That field is an ORG's email logo: a white-label profile inherits it when
 * the org set none, and a send that carries one is read as an org's own mail.
 * Putting the platform's logo there would stamp it on every white-label org
 * that left the field blank.
 */
export const PLATFORM_EMAIL_LOGO_URL: string | null =
  httpsUrl(clean(process.env.NEXT_PUBLIC_PLATFORM_EMAIL_LOGO_URL)) ??
  (isAglynOperatedBrand()
    ? 'https://aglyn.com/api/media/cdn/org:jWmGooWE3L:aglyn-marketing/YwrD-IDzcf'
    : null)

/**
 * The postal address printed beside {@link PLATFORM_BRAND_LEGAL_NAME} at the
 * foot of the platform's own system email (AGL-3322).
 *
 * A BRAND string, beside the legal name whose line it completes, rather than
 * a field of `operatorIdentity()`, and the difference is the default. The
 * operator identity is what a statutory notice is addressed to and refuses to
 * guess; this is a line in a footer the operator sees in their own mail and
 * can correct, and for the Aglyn-operated brand the right value is known: the
 * registered agent's address the Aglyn marketing site's email footer prints.
 *
 * Null unless this is the Aglyn-operated brand: a renamed deployment must
 * never print our address as its own. Such an operator sets
 * `NEXT_PUBLIC_PLATFORM_POSTAL_ADDRESS`, or their footer carries the legal
 * name alone. Line breaks in a configured value are folded into commas,
 * because the footer prints the address on one line.
 */
export const PLATFORM_POSTAL_ADDRESS: string | null =
  clean(process.env.NEXT_PUBLIC_PLATFORM_POSTAL_ADDRESS)
    ?.split(/\s*\n\s*/)
    .filter(Boolean)
    .join(', ') ??
  (isAglynOperatedBrand()
    ? 'c/o Northwest Registered Agent, LLC, 5900 Balcones Drive STE 100, Austin, TX 78731'
    : null)

/**
 * A branding profile with every field present — what a branded surface
 * renders. Image/color/domain fields are nullable (Aglyn's own surfaces
 * bake those in rather than carry a URL); the remaining text fields always
 * have a value so callers never string-concatenate `undefined`.
 *
 * `supportUrl` is nullable too, and it is the one field where null carries a
 * decision rather than an absence — see {@link resolveBrandingProfile}. A
 * caller must render NOTHING for it, never a placeholder and never a
 * substitute.
 */
export interface ResolvedBrandingProfile {
  productName: string
  logoUrl: string | null
  faviconUrl: string | null
  primaryColor: string | null
  supportUrl: string | null
  /**
   * The brand's own FRONT DOOR — where "Made with <product>" sends a visitor
   * who wants to know what built the site they are looking at.
   *
   * Deliberately separate from {@link ResolvedBrandingProfile.supportUrl},
   * which the badge used to borrow: a help-desk address is the wrong answer to
   * "what is this", and on this deployment it resolves to a `mailto:`, so the
   * badge opened a blank email instead of a web page.
   *
   * Nullable for the same reason `supportUrl` is — a brand with nowhere to
   * send that visitor gets a plain label, never a substitute destination.
   */
  homeUrl: string | null
  fromName: string
  emailLogoUrl: string | null
  customConsoleDomain: string | null
}

/**
 * The PLATFORM (non-white-label) brand — the fallback every surface gets when
 * an org lacks the `whiteLabel` entitlement, and the gap-filler for a partial
 * agency profile.
 *
 * It lives beside the literals it is assembled from rather than beside the
 * entitlement gate that hands it out, and that placement is load-bearing
 * rather than tidying. A published tenant page renders the attribution badge
 * from this constant and reads nothing else out of `plan-entitlements.ts`;
 * defining it there put that module's whole plan, quota and entitlement table
 * — the single largest first-party module a visitor could reach — into the
 * first load of every anonymous visitor to every customer site.
 * `plan-entitlements.ts` re-exports it, so every existing caller is unchanged.
 *
 * The name says the PLATFORM's brand rather than Aglyn's because on a
 * self-host install that assertion stops being true: which platform this is,
 * is configuration. `resolveBrandingProfile` is the single resolver EVERY
 * branded surface routes through — console chrome, published-site badge and
 * title, transactional email — and this is its fallback, so all of them get a
 * self-host brand without extending the white-label machinery at all.
 */
export const PLATFORM_BRANDING_PROFILE: ResolvedBrandingProfile = {
  productName: PLATFORM_BRAND_NAME,
  // The platform's own surfaces still bake their logo in — this is here for
  // the surfaces that CANNOT, which is every surface rendered on somebody
  // else's site. The free-tier attribution badge is the one that exists
  // today, and it carried no mark at all while this was null.
  logoUrl: PLATFORM_MARK_URL,
  faviconUrl: null,
  primaryColor: null,
  supportUrl: PLATFORM_SUPPORT_URL,
  homeUrl: PLATFORM_HOME_URL,
  fromName: PLATFORM_BRAND_NAME,
  emailLogoUrl: null,
  customConsoleDomain: null,
}
