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
 * THE VISITOR'S HALF OF CAMPAIGN ATTRIBUTION — the touch that has to survive
 * the gap between arriving from a campaign and becoming somebody.
 *
 * ## The gap this exists to cross
 *
 * A known recipient can be joined on their address: they clicked a campaign's
 * mail, the delivery webhook stamped the click on their person document, and
 * `email-revenue-attribution.ts` reads it back when their order settles. An
 * ANONYMOUS visitor has no such handle. They arrive from an ad, a partner
 * link or a social post, browse for a while, and only become identifiable at
 * the moment they submit a form, sign up, book or check out. Between the
 * arrival and that moment there is nothing on the server that connects them.
 *
 * The site's own collector already reads `utm_source`/`utm_medium`/
 * `utm_campaign` off the landing URL and increments a per-day label counter
 * with them. That answers "how many views did this campaign send us" and
 * stops there — the labels are never carried to the moment the visitor says
 * who they are, so every form, lead, contact and booking a campaign caused is
 * recorded as though nobody caused it.
 *
 * This carries them. The touch is held on the VISITOR, and every identify
 * moment attaches it.
 *
 * ## What holds it, and why it outlives the tab
 *
 * `localStorage`, expiring at {@link ATTRIBUTION_WINDOW_DAYS}.
 *
 * `campaign-forwarding.ts` holds its own campaign in `sessionStorage` and
 * argues for it: a first touch that outlived the visit would start
 * attributing next week's organic return to this week's ad. That argument is
 * correct for the question it answers — which campaign produced THIS SIGNUP,
 * asked of one uninterrupted visit to the marketing site — and it is the
 * wrong shape here, because this question already has a stated answer to
 * "how long may a touch be credited": the attribution window, seven days,
 * stamped onto every record so the rule is readable off the data.
 *
 * A store that dies with the tab cannot express a seven-day window. It would
 * credit only the visitors who convert without ever closing the tab and
 * silently record every other conversion as organic — a measured zero, which
 * is the failure mode this whole area exists to end. So the touch lives as
 * long as the window says it may and not one millisecond longer: an expired
 * entry is DELETED on the read that finds it, rather than ignored, so a
 * device never holds a campaign it can no longer be credited with.
 *
 * ## Last touch, not first
 *
 * The revenue join credits the LAST click, and a product where a lead and an
 * order attribute by different rules is worse than one that is uniformly
 * approximate. So a new campaign arrival OVERWRITES the stored one. This is
 * the deliberate opposite of {@link rememberVisitCampaign}, which keeps the
 * first — that one describes a single visit's origin and this one describes
 * which campaign most recently brought a person back.
 *
 * ## Consent
 *
 * Two tiers, exactly as the console hop splits them, and the split is the
 * same because the acts are the same:
 *
 *  - **The live URL at the moment of conversion** touches no storage. The
 *    parameters are already in the page the visitor asked for, nothing is
 *    written to their device, and there is accordingly nothing to consent to.
 *    A visitor who converts on the page the ad landed them on is attributed
 *    with no grant of any kind.
 *  - **The remembered touch** is written to the visitor's device for an
 *    analytics purpose, which is `analytics_storage`, and it waits for the
 *    same grant the analytics tag waits for. The gate is not re-derived here:
 *    the caller already computed it for the tag and hands the same boolean
 *    down, so there is one gate and it cannot drift from itself.
 *
 * `null` is UNRESOLVED and is not `false`. With `strictNullChecks` off
 * repo-wide that distinction evaporates unless it is carried explicitly, so
 * it is: until the visitor's state is actually settled, nothing is read and
 * nothing is written. Failing closed costs an attribution; failing open
 * writes to a device before the visitor answered.
 *
 * On a WITHDRAWAL the stored touch is removed rather than merely ignored.
 * Somebody who changes their mind should not leave the thing they withdrew
 * consent for sitting on their device.
 *
 * ⛔ **A host whose posture requires prior consent and whose visitor has not
 * given it produces no remembered touch at all.** Their conversion attributes
 * to nothing, exactly as direct traffic does. That is the degradation, stated
 * rather than worked around: there is no fallback identifier, no fingerprint
 * and no server-side cookie, because every one of those is the durable
 * identifier the analytics posture on this runtime deliberately does not set.
 *
 * ## What is never carried
 *
 * Only the three allowlisted `utm_` labels, scrubbed by
 * {@link parseCampaignAttribution} — which refuses an email-shaped value
 * outright. No address, no person's identifier, no click id, nothing that
 * names the visitor. A campaign link is exactly where putting a recipient in
 * a query string would be tempting, and the parser is what makes it
 * impossible rather than merely discouraged: the stored string is re-parsed
 * through the same allowlist that wrote it, so a hand-edited `localStorage`
 * entry can claim no more than a hand-edited URL could.
 *
 * ⛔ **Nothing here depends on a parameter surviving the mail provider's
 * click wrapper.** A campaign link is rewritten by the provider and redirects
 * to the authored URL, so whatever the marketer put on it arrives — but the
 * email channel does not rely on that, because an email click is already
 * recorded server-side against the recipient's address hash. The labels below
 * are the WEB channel's touch, and a campaign that carries none is joined by
 * address instead.
 */

import {
  campaignAttributionQuery,
  parseCampaignAttribution,
  type CampaignAttribution,
} from './campaign-attribution'

/*==========================================
 * THE WINDOW, AND WHY THIS IS THE SECOND COPY OF A NUMBER.
 *
 * `email-revenue-window.ts` in `shared-util-email` declares the same seven
 * days, and its docblock is right that a window defined twice is a window
 * that drifts. Importing it here is not available: `shared-util-email` is
 * tagged `scope:shared` and reaches back into `@aglyn/aglyn`, so an edge in
 * this direction closes a project cycle and the module-boundary rule refuses
 * it. That is the same wall `email-media-src.ts` hit, and the answer is the
 * same one it took — a deliberate copy, pinned by a drift guard in an app
 * spec that can import both sides (`attribution-window-drift.spec.ts`).
 *
 * The copy is the WINDOW only. The model name is stamped onto records, which
 * happens server-side, so it stays in one place and never comes near this
 * file.
 *=========================================*/

/** Days between a campaign touch and a conversion it may be credited with. */
export const ATTRIBUTION_WINDOW_DAYS = 7

/** The same window in milliseconds. */
export const ATTRIBUTION_WINDOW_MS =
  ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000

/**
 * Whether a touch may be credited with a conversion at `convertedAtMs`.
 *
 * Both bounds matter and they fail differently, exactly as the revenue join
 * describes them: a touch AFTER the conversion is the receipt rather than the
 * cause, and a touch older than the window is one nobody can argue caused
 * anything. Inclusive at both ends.
 */
function touchIsInWindow(touchedAtMs: number, convertedAtMs: number): boolean {
  if (!Number.isFinite(touchedAtMs) || !Number.isFinite(convertedAtMs)) {
    return false
  }
  if (touchedAtMs <= 0 || convertedAtMs <= 0) return false
  const age = convertedAtMs - touchedAtMs
  return age >= 0 && age <= ATTRIBUTION_WINDOW_MS
}

/** Where the touch is held. Namespaced like every other key this app sets. */
export const CAMPAIGN_TOUCH_STORAGE_KEY = 'aglyn:campaign-touch'

/**
 * The parameter the touch's instant rides under inside the wire form.
 *
 * Deliberately not a `utm_` name: the wire form is parsed by the same
 * allowlist that reads a URL, and a fourth `utm_` key would either be dropped
 * by it or have to widen it. `t` is outside the allowlist and read
 * separately.
 */
export const CAMPAIGN_TOUCH_TIME_KEY = 't'

/** A campaign the visitor arrived from, and when they arrived from it. */
export interface CampaignTouch extends CampaignAttribution {
  /** When the visitor followed the campaign link, epoch ms. */
  atMs: number
}

/**
 * Whether the visitor has granted analytics storage.
 *
 * `null` means NOT YET RESOLVED and is not the same as `false` — see the
 * consent section above.
 */
let storageConsent: boolean | null = null

function localStore(): Storage | null {
  if (typeof window === 'undefined') return null
  // Touching the property itself throws in some privacy modes, not just its
  // methods.
  try {
    return window.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * The canonical stored form of a touch — the ONLY place it is written, so it
 * cannot drift from what {@link parseCampaignTouch} reads back.
 */
export function campaignTouchWire(touch: CampaignTouch | null | undefined): string {
  if (!touch) return ''
  const labels = campaignAttributionQuery(touch)
  if (!labels) return ''
  const atMs = Math.round(Number(touch.atMs))
  if (!Number.isFinite(atMs) || atMs <= 0) return ''
  return `${labels}&${CAMPAIGN_TOUCH_TIME_KEY}=${atMs}`
}

/**
 * Read a stored or transmitted touch back, or `null`.
 *
 * The window is enforced HERE rather than at the call sites, so every reader
 * — the browser deciding what to send, the server deciding what to credit —
 * agrees about what an expired touch is: nothing at all. A touch dated in the
 * future is refused for the reason the revenue join refuses one: a click
 * after the conversion is the receipt, not the cause.
 */
export function parseCampaignTouch(
  wire: unknown,
  nowMs: number = Date.now(),
): CampaignTouch | null {
  if (typeof wire !== 'string' || !wire) return null
  let params: URLSearchParams
  try {
    params = new URLSearchParams(wire)
  } catch {
    return null
  }
  const campaign = parseCampaignAttribution(params)
  if (!campaign) return null
  const atMs = Number(params.get(CAMPAIGN_TOUCH_TIME_KEY))
  if (!touchIsInWindow(atMs, nowMs)) return null
  return { ...campaign, atMs }
}

/**
 * Tell this module what the visitor's analytics consent state is.
 *
 * Called by whoever already computed it for the tag, on every render, so a
 * grant remembers the arrival the moment it is given and a withdrawal drops
 * the stored touch immediately.
 */
export function setCampaignTouchConsent(allowed: boolean | null): void {
  storageConsent = allowed === true ? true : allowed === false ? false : null
  if (storageConsent === true) {
    rememberCampaignTouch()
    return
  }
  if (storageConsent === false) {
    const store = localStore()
    if (!store) return
    try {
      store.removeItem(CAMPAIGN_TOUCH_STORAGE_KEY)
    } catch {
      // Nothing else to try, and a failed cleanup must not break the page.
    }
  }
}

/**
 * Remember the campaign on the current URL as this visitor's latest touch.
 *
 * Overwrites, because the model is last touch. A URL naming no campaign
 * writes NOTHING and clears nothing: a visitor who arrives from an ad and
 * then browses ten organic pages has one touch, not one touch erased by the
 * second pageview.
 *
 * @returns what is now remembered, or `null`.
 */
export function rememberCampaignTouch(
  search?: string,
  nowMs: number = Date.now(),
): CampaignTouch | null {
  if (storageConsent !== true) return null
  const store = localStore()
  if (!store) return null
  const source =
    typeof search === 'string'
      ? search
      : typeof window === 'undefined'
        ? ''
        : window.location.search
  const campaign = parseCampaignAttribution(new URLSearchParams(source))
  if (!campaign) return null
  const touch: CampaignTouch = { ...campaign, atMs: nowMs }
  const wire = campaignTouchWire(touch)
  if (!wire) return null
  try {
    store.setItem(CAMPAIGN_TOUCH_STORAGE_KEY, wire)
  } catch {
    // A store that refuses the write costs the walk from the landing page to
    // the conversion, never a conversion on the landing page itself — the
    // live URL below still carries that visitor.
    return null
  }
  return touch
}

/**
 * The touch to credit a conversion happening right now, or `null`.
 *
 * ## The order is the model
 *
 * The live URL is consulted FIRST and wins whenever it names a campaign,
 * because a campaign on the address bar at the moment of conversion is by
 * definition the most recent touch there is. Only when the current page names
 * none does this fall back to what was remembered.
 *
 * ## An expired entry is deleted, not skipped
 *
 * A touch past the window can never be credited again, so leaving it on the
 * device would be keeping a record of where somebody came from for no purpose
 * anything reads. The read that finds it removes it.
 */
export function readCampaignTouch(
  nowMs: number = Date.now(),
): CampaignTouch | null {
  const live =
    typeof window === 'undefined'
      ? null
      : parseCampaignAttribution(new URLSearchParams(window.location.search))
  if (live) return { ...live, atMs: nowMs }

  if (storageConsent !== true) return null
  const store = localStore()
  if (!store) return null
  let raw: string | null
  try {
    raw = store.getItem(CAMPAIGN_TOUCH_STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  const touch = parseCampaignTouch(raw, nowMs)
  if (!touch) {
    try {
      store.removeItem(CAMPAIGN_TOUCH_STORAGE_KEY)
    } catch {
      // The entry stays until the next read finds it again; it is already
      // uncreditable, so nothing downstream is affected.
    }
    return null
  }
  return touch
}

/**
 * The fragment a conversion request spreads into its body, or `{}`.
 *
 * One helper rather than four hand-written spreads: a door that forgets it
 * reports its conversions as organic, which looks exactly like a campaign
 * that produced none. Empty when there is no touch — never a placeholder,
 * never `campaignTouch: undefined`, so that "arrived from nowhere" and "this
 * door does not report" stay distinguishable on the wire.
 */
export function campaignTouchField(
  nowMs: number = Date.now(),
): { campaignTouch?: string } {
  const wire = campaignTouchWire(readCampaignTouch(nowMs))
  return wire ? { campaignTouch: wire } : {}
}
