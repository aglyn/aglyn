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
 * Carry the campaign across the domain hop (AGL-1731).
 *
 * `campaign-attribution.ts` is the READER half of this contract and it works.
 * This is the half that was missing, and without it the reader was fed
 * nothing: `aglyn.com` is a tenant published site and `app.aglyn.com` is the
 * console, a real cross-origin hop, and no code anywhere put a `utm_*`
 * parameter on a console-bound link. So `users/{uid}.signupCampaign` was
 * written for exactly one population — visitors whose CTA href had a campaign
 * typed into it by hand.
 *
 * A hand-typed one is worse than none. It is STATIC: `utm_source=google`
 * authored onto the pricing button attributes every clicker to Google whether
 * they arrived from Google, from Hacker News or from a bookmark. Confidently
 * wrong attribution reaches the same spend decisions as absent attribution and
 * is much harder to notice, because the report looks populated.
 *
 * What is needed instead is PER-VISITOR forwarding: the landing page copies
 * the campaign off its own inbound URL onto the console-bound href, at click
 * time, for that one visitor.
 *
 * ## Why a delegated listener and not `AppLink`
 *
 * The same reason `analytics-link-clicks.ts` gives, and it is the reason that
 * decides this file's shape. The CTAs on `aglyn.com` are authored besigner
 * content, not repo files; rich-text and Custom HTML anchors are written with
 * `dangerouslySetInnerHTML` and are plain DOM anchors with no React handler at
 * all. A prop on `AppLink` would miss them, and reaching them from `AppLink`
 * would mean `useSearchParams` in a component the console renders on every
 * page — a dynamic-rendering hazard on statically generated surfaces, paid on
 * every route to fix a link on one of them. A capture-phase listener on
 * `document` sees every anchor, costs one listener, and renders nothing.
 *
 * ## The two tiers, and why the storage tier is the SECOND one
 *
 * A visitor rarely signs up from the page the ad landed on. They land on
 * `/?utm_source=google&...`, read `/pricing`, then click. By then the campaign
 * is off the address bar, so reading the live URL at click time alone would
 * capture only the minority who convert without navigating.
 *
 * - **Tier 1 — the live URL.** Read `window.location.search` at click time.
 *   This touches NO storage: the parameters are already in the page the
 *   visitor asked for. Nothing is written to their device, so there is nothing
 *   here to consent to, and it works for every visitor including one who has
 *   declined analytics.
 * - **Tier 2 — the first touch of the visit**, in `sessionStorage`, which is
 *   what survives the walk from the landing page to the pricing page.
 *
 * Tier 2 WINS when both exist, because first touch is the question being
 * asked. Last touch — re-deriving the campaign from whatever URL happens to be
 * current at signup — answers a different question and would disagree with
 * GA4's own session attribution.
 *
 * ## Why tier 2 is gated on analytics consent, and tier 1 is not
 *
 * Tier 2 writes to the visitor's device for an analytics purpose, so it is
 * `analytics_storage` in the consent-mode sense and it waits for the same
 * grant the GA tag waits for (AGL-1498). The gate is not re-implemented here
 * and no consent record is read here: the caller already computes
 * `analyticsAllowed` for the tag and hands the same boolean down, so there is
 * one gate and it cannot drift from itself.
 *
 * It is deliberately NOT gated on advertising storage. Nothing here reads or
 * writes an advertising identifier, sets a cookie, or leaves anything that
 * outlives the tab, and AGL-1649 has advertising denied with no route for a
 * host to grant it — gating on a permission that cannot currently be given
 * would be a feature that is dead by construction rather than one that is off.
 *
 * **Consent unresolved is not consent denied, and both are falsy.** With
 * `strictNullChecks` off repo-wide that distinction is the sort that
 * evaporates, so it is carried as an explicit tri-state: until the caller has
 * actually resolved the visitor's state, tier 2 neither reads nor writes.
 * Failing closed here costs an attribution; failing open would write to a
 * device before the visitor answered.
 *
 * ## What is never done
 *
 * A value is only ever forwarded if this visitor literally arrived carrying
 * it. There is no default, no inference from the referrer, and no
 * `utm_source=direct` — a signup with no campaign must reach the console with
 * no campaign, so that "arrived from nowhere" and "never asked" stay the
 * distinct facts `campaign-attribution.ts` keeps them.
 *
 * Only links to OUR OWN console origin are touched, and the origin is supplied
 * by the caller rather than written here — a self-host install points
 * `NEXT_PUBLIC_CONSOLE_URL` somewhere else entirely. Decorating any other host
 * would post our campaign labels to a third party, which is a data leak dressed
 * up as attribution.
 *
 * ## One accepted consequence
 *
 * The tenant runtime serves `aglyn.com` AND every customer's published site,
 * so a customer site that links to our signup forwards ITS OWN inbound
 * campaign — an agency partner's `utm_source=their-newsletter` would land in our
 * acquisition report describing their spend, not ours. It is not gated on
 * "is this the operator's marketing host" deliberately: that gate needs a
 * second configured origin to compare against, and a deployment that forgot to
 * set it would forward NOTHING while looking perfectly healthy. A silent zero
 * is the exact failure AGL-1731 is about, and it is worse than a few
 * mislabelled rows that GA's own Hostname dimension can already separate.
 */

import {
  CAMPAIGN_QUERY_KEYS,
  campaignAttributionQuery,
  parseCampaignAttribution,
  type CampaignAttribution,
} from './campaign-attribution'

/**
 * Where the first touch of this visit is held. `sessionStorage`, so it dies
 * with the tab: a campaign is a fact about one visit, and a value that
 * outlived the visit would start attributing next week's organic return to
 * this week's ad.
 */
export const CAMPAIGN_VISIT_STORAGE_KEY = 'aglyn:campaign'

/**
 * What a read of the first-touch store produced.
 *
 * Three states rather than "a campaign or null", and the third is the whole
 * point. `sessionStorage` throws outright in some privacy modes, and a
 * `catch` that returned null would report "this visitor named no campaign" —
 * indistinguishable from an organic arrival, which is how an unreadable source
 * becomes a measured zero. `unreadable` is a different answer and the caller
 * treats it differently: it falls through to the live URL instead of
 * concluding anything.
 */
export type VisitCampaignRead =
  | { status: 'campaign'; campaign: CampaignAttribution }
  | { status: 'none' }
  | { status: 'unreadable' }

/**
 * Whether the visitor has granted analytics storage.
 *
 * `null` means NOT YET RESOLVED, and is not the same as `false`. The consent
 * state is settled client-side after hydration, so there is a window in every
 * pageview where the answer is genuinely unknown, and treating it as a denial
 * would be as wrong as treating it as a grant. Tier 2 does nothing in it.
 */
let storageConsent: boolean | null = null

/** The one listener pair on `document`, or null. Held, not flagged — the same
 * reason `analytics-link-clicks.ts` holds its own: a boolean lets a caller
 * install over a listener that is still attached, and re-entrant decoration is
 * harder to see than a double-counted event. */
let installedHandler: ((event: Event) => void) | null = null

function sessionStore(): Storage | null {
  if (typeof window === 'undefined') return null
  // Touching the property itself can throw, not just its methods.
  try {
    return window.sessionStorage ?? null
  } catch {
    return null
  }
}

/**
 * The campaign this visit began with, as far as the store can say.
 *
 * Re-parsed through the same allowlist that wrote it rather than trusted:
 * `sessionStorage` is writable by anything running on the page, so the stored
 * string can claim no more than an inbound URL could — three allowlisted keys,
 * trimmed, email shapes refused, capped.
 */
export function readVisitCampaign(): VisitCampaignRead {
  if (storageConsent !== true) return { status: 'none' }
  const store = sessionStore()
  if (!store) return { status: 'unreadable' }
  let raw: string | null
  try {
    raw = store.getItem(CAMPAIGN_VISIT_STORAGE_KEY)
  } catch {
    return { status: 'unreadable' }
  }
  if (!raw) return { status: 'none' }
  const campaign = parseCampaignAttribution(new URLSearchParams(raw))
  return campaign ? { status: 'campaign', campaign } : { status: 'none' }
}

/**
 * Remember the campaign on the current URL as this visit's first touch.
 *
 * First touch means FIRST: an existing entry is never replaced. A second
 * campaign arriving later in the same visit is a link the visitor followed
 * after we already knew where they came from, and letting it overwrite would
 * quietly turn this into last-touch.
 *
 * Returns what is now remembered so a caller can assert on it.
 */
export function rememberVisitCampaign(search?: string): CampaignAttribution | null {
  const existing = readVisitCampaign()
  if (existing.status === 'campaign') return existing.campaign
  if (storageConsent !== true) return null
  const store = sessionStore()
  if (!store) return null
  const source =
    typeof search === 'string'
      ? search
      : typeof window === 'undefined'
        ? ''
        : window.location.search
  const campaign = parseCampaignAttribution(new URLSearchParams(source))
  if (!campaign) return null
  try {
    store.setItem(CAMPAIGN_VISIT_STORAGE_KEY, campaignAttributionQuery(campaign))
  } catch {
    // A store that refuses the write costs the walk from the landing page to
    // the pricing page, never the click itself — tier 1 still carries a
    // visitor who converts without navigating.
    return null
  }
  return campaign
}

/**
 * Tell this module what the visitor's analytics consent state is.
 *
 * Called by whoever already computed it for the tag, on every render, so a
 * grant seeds the first touch the moment it is given and a WITHDRAWAL takes
 * effect immediately: the stored value is dropped, not merely ignored. A
 * visitor who changes their mind mid-visit should not leave the thing they
 * withdrew consent for sitting on their device.
 */
export function setCampaignForwardingConsent(allowed: boolean | null): void {
  storageConsent = allowed === true ? true : allowed === false ? false : null
  if (storageConsent === true) {
    rememberVisitCampaign()
    return
  }
  if (storageConsent === false) {
    const store = sessionStore()
    if (!store) return
    try {
      store.removeItem(CAMPAIGN_VISIT_STORAGE_KEY)
    } catch {
      // Nothing else to try, and a failed cleanup must not break the page.
    }
  }
}

/**
 * The campaign to forward, first touch preferred.
 *
 * The `unreadable` case falls through to the live URL rather than to nothing,
 * which is the point of carrying that state at all: a broken store degrades
 * this to tier 1 rather than to silence.
 */
export function campaignToForward(search?: string): CampaignAttribution | null {
  const stored = readVisitCampaign()
  if (stored.status === 'campaign') return stored.campaign
  const live =
    typeof search === 'string'
      ? search
      : typeof window === 'undefined'
        ? ''
        : window.location.search
  return parseCampaignAttribution(new URLSearchParams(live))
}

function normalizeOrigin(value: string | null | undefined): string {
  if (!value) return ''
  try {
    return new URL(value).origin
  } catch {
    return ''
  }
}

/**
 * The href a console-bound link should carry for this visitor, or null to
 * leave it exactly as authored.
 *
 * Null — rather than "the href unchanged" — so that a caller cannot write back
 * a value it did not mean to change, and so a test can tell "decided not to
 * touch this" from "touched it and produced the same string".
 *
 * The three keys are replaced WHOLESALE, never merged key by key. A visitor
 * who arrived with only `utm_source=hn` clicking a button authored with all
 * three must not produce `source=hn` married to the author's `campaign=`: that
 * row describes an event that never happened. Everything else on the href —
 * `plan`, `interval`, the AGL-1535 intent — is preserved untouched.
 */
export function decorateCampaignHref(
  href: string,
  baseHref: string,
  consoleOrigin: string,
  campaign: CampaignAttribution | null,
): string | null {
  if (!campaign) return null
  const origin = normalizeOrigin(consoleOrigin)
  if (!origin) return null
  let url: URL
  try {
    url = new URL(href, baseHref)
  } catch {
    return null
  }
  if (url.origin !== origin) return null
  for (const key of CAMPAIGN_QUERY_KEYS) url.searchParams.delete(key)
  const query = new URLSearchParams(campaignAttributionQuery(campaign))
  query.forEach((value, key) => url.searchParams.set(key, value))
  const next = url.toString()
  return next === href ? null : next
}

/**
 * Start forwarding the campaign onto console-bound links on this page.
 *
 * Idempotent and safe to call during render, the same contract as
 * `installLinkClickTracking` and for the same AGL-1550 reason: an effect only
 * runs if React commits, and a page that renders without committing would
 * otherwise ship links with no campaign on them.
 *
 * Both `pointerdown` and `click` are listened for, in capture phase.
 * `pointerdown` is what covers a middle-click, a modifier-click into a new
 * tab, and "Copy link address" from the context menu — all of which read the
 * href without ever firing `click`. `click` is what covers keyboard
 * activation, which fires no pointer event at all. Decoration is idempotent,
 * so a plain left click doing both is not a problem.
 *
 * Returns an uninstall function for tests and for a caller that owns the page
 * lifecycle.
 */
export function installCampaignForwarding(options: {
  consoleOrigin: string
}): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return () => undefined
  }
  if (installedHandler) return () => undefined
  const origin = normalizeOrigin(options?.consoleOrigin)
  if (!origin) return () => undefined

  const onActivate = (event: Event) => {
    try {
      const target = event.target as Element | null
      if (!target || typeof target.closest !== 'function') return
      const anchor = target.closest('a[href]')
      if (!anchor) return
      const decorated = decorateCampaignHref(
        anchor.getAttribute('href') || '',
        window.location.href,
        origin,
        campaignToForward(),
      )
      if (decorated) anchor.setAttribute('href', decorated)
    } catch {
      // Attribution never breaks a navigation. A link that throws here would
      // be a link that does not work, which costs more than the campaign does.
    }
  }

  installedHandler = onActivate
  document.addEventListener('pointerdown', onActivate, true)
  document.addEventListener('click', onActivate, true)
  return resetCampaignForwarding
}

/** Test seam — removes both listeners, forgets them, and forgets consent. */
export function resetCampaignForwarding(): void {
  if (installedHandler && typeof document !== 'undefined') {
    document.removeEventListener('pointerdown', installedHandler, true)
    document.removeEventListener('click', installedHandler, true)
  }
  installedHandler = null
  storageConsent = null
}
