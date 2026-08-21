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
 * Zach's rule for the self-host path: *"the self hosted owner should not have
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
 */
export const PLATFORM_SUPPORT_URL: string = (() => {
  const configured = clean(process.env.NEXT_PUBLIC_PLATFORM_SUPPORT_URL)
  if (configured) return configured
  const operatorEmail = clean(process.env.NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL)
  if (operatorEmail) return `mailto:${operatorEmail}`
  return 'https://aglyn.com/support'
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
