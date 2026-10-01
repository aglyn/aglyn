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
 * THE VISITOR'S HALF OF ATTRIBUTION — the UTM touch that has to survive the
 * gap between arriving from a labeled link and becoming somebody.
 *
 * The labels are the web's (`utm_source`/`utm_medium`/`utm_campaign`), not
 * any plugin's model: every door that identifies a visitor — a form, a
 * booking, a signup — attaches the touch, and whichever plugin credits its
 * campaigns reads it on the server.
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
 * `utm-forwarding.ts` holds its own campaign in `sessionStorage` and
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
 * the deliberate opposite of {@link rememberVisitUtm}, which keeps the
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
 * {@link parseUtmAttribution} — which refuses an email-shaped value
 * outright — and, for the page touch below, the ids of the campaigns and the
 * screen a page is filed under with its path. No address, no person's
 * identifier, no click id, nothing that names the visitor. A campaign link is exactly where putting a recipient in
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
  utmAttributionQuery,
  parseUtmAttribution,
  type UtmAttribution,
} from './utm-attribution'

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

/**
 * Where the touch is held. Namespaced like every other key this app sets, and
 * spelled as visitors' devices already hold it.
 */
export const UTM_TOUCH_STORAGE_KEY = 'aglyn:campaign-touch'

/**
 * The parameter the touch's instant rides under inside the wire form.
 *
 * Deliberately not a `utm_` name: the wire form is parsed by the same
 * allowlist that reads a URL, and a fourth `utm_` key would either be dropped
 * by it or have to widen it. `t` is outside the allowlist and read
 * separately.
 */
export const UTM_TOUCH_TIME_KEY = 't'

/** A campaign the visitor arrived from, and when they arrived from it. */
export interface UtmTouch extends UtmAttribution {
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

/** Callers waiting for {@link storageConsent} to settle. */
const consentWaiters: Array<(allowed: boolean) => void> = []

/**
 * Run `callback` once the visitor's storage consent is settled — at once when
 * it already is, else on the first {@link setUtmTouchConsent} that settles it.
 *
 * For a caller whose answer depends on whether the device may remember
 * anything (the first-visit claim, AGL-3461): asked too early, an unresolved
 * state would read as "may not", and the visit would go uncounted for no
 * reason but timing.
 *
 * @returns a function that withdraws the callback if it has not run.
 */
export function whenUtmTouchConsentSettles(
  callback: (allowed: boolean) => void,
): () => void {
  if (storageConsent !== null) {
    callback(storageConsent)
    return () => undefined
  }
  consentWaiters.push(callback)
  return () => {
    const index = consentWaiters.indexOf(callback)
    if (index >= 0) consentWaiters.splice(index, 1)
  }
}

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
 * cannot drift from what {@link parseUtmTouch} reads back.
 */
export function utmTouchWire(touch: UtmTouch | null | undefined): string {
  if (!touch) return ''
  const labels = utmAttributionQuery(touch)
  if (!labels) return ''
  const atMs = Math.round(Number(touch.atMs))
  if (!Number.isFinite(atMs) || atMs <= 0) return ''
  return `${labels}&${UTM_TOUCH_TIME_KEY}=${atMs}`
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
export function parseUtmTouch(
  wire: unknown,
  nowMs: number = Date.now(),
): UtmTouch | null {
  if (typeof wire !== 'string' || !wire) return null
  let params: URLSearchParams
  try {
    params = new URLSearchParams(wire)
  } catch {
    return null
  }
  const campaign = parseUtmAttribution(params)
  if (!campaign) return null
  const atMs = Number(params.get(UTM_TOUCH_TIME_KEY))
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
export function setUtmTouchConsent(allowed: boolean | null): void {
  storageConsent = allowed === true ? true : allowed === false ? false : null
  if (storageConsent !== null && consentWaiters.length) {
    const settled = storageConsent
    for (const waiter of consentWaiters.splice(0)) {
      try {
        waiter(settled)
      } catch {
        // One caller's failure must not stop the next hearing the answer.
      }
    }
  }
  if (storageConsent === true) {
    rememberUtmTouch()
    // A grant given after the landing remembers the page the visitor is on,
    // exactly as it remembers the labels on its address.
    rememberPageTouch()
    return
  }
  if (storageConsent === false) {
    const store = localStore()
    if (!store) return
    for (const key of [
      UTM_TOUCH_STORAGE_KEY,
      PAGE_TOUCH_STORAGE_KEY,
      CAMPAIGN_VISITS_STORAGE_KEY,
    ]) {
      try {
        store.removeItem(key)
      } catch {
        // Nothing else to try, and a failed cleanup must not break the page.
      }
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
export function rememberUtmTouch(
  search?: string,
  nowMs: number = Date.now(),
): UtmTouch | null {
  if (storageConsent !== true) return null
  const store = localStore()
  if (!store) return null
  const source =
    typeof search === 'string'
      ? search
      : typeof window === 'undefined'
        ? ''
        : window.location.search
  const campaign = parseUtmAttribution(new URLSearchParams(source))
  if (!campaign) return null
  const touch: UtmTouch = { ...campaign, atMs: nowMs }
  const wire = utmTouchWire(touch)
  if (!wire) return null
  try {
    store.setItem(UTM_TOUCH_STORAGE_KEY, wire)
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
export function readUtmTouch(
  nowMs: number = Date.now(),
): UtmTouch | null {
  const live =
    typeof window === 'undefined'
      ? null
      : parseUtmAttribution(new URLSearchParams(window.location.search))
  if (live) return { ...live, atMs: nowMs }

  if (storageConsent !== true) return null
  const store = localStore()
  if (!store) return null
  let raw: string | null
  try {
    raw = store.getItem(UTM_TOUCH_STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  const touch = parseUtmTouch(raw, nowMs)
  if (!touch) {
    try {
      store.removeItem(UTM_TOUCH_STORAGE_KEY)
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
 *
 * Both touches ride the one field (AGL-3461): the labels the visitor arrived
 * with and the page filed under a campaign they last viewed. Their keys do
 * not overlap, so each parser reads its own half of the same string and
 * ignores the other's — which is also why every door carries the page touch
 * without a change of its own.
 */
export function utmTouchField(
  nowMs: number = Date.now(),
): { campaignTouch?: string } {
  const wire = [
    utmTouchWire(readUtmTouch(nowMs)),
    pageTouchWire(readPageTouch(nowMs)),
  ]
    .filter(Boolean)
    .join('&')
  return wire ? { campaignTouch: wire } : {}
}

/*==========================================
 * THE PAGE TOUCH (AGL-3461) — a page filed under a campaign, viewed.
 *
 * A merchant files a landing page under a campaign (`campaignIds` on the
 * screen, `container-membership.ts`) so the campaign can say what its pages
 * did. A visitor who reaches that page by typing its address, from a search
 * result or from a link carrying no labels has still been touched by the
 * campaign: they are reading its page. Until this existed that visitor's form
 * submission read "not credited to a campaign", because the only carriers
 * were a `utm_campaign` label and a click on the campaign's own mail.
 *
 * ## What the device holds, and why it is ids
 *
 * The campaigns the page was filed under WHEN IT WAS VIEWED, the screen and
 * the path, and the instant. Ids, never names: a campaign's name is editable
 * and is resolved on the server at the moment of credit, and an id names
 * nothing a reader of the device could learn anything from.
 *
 * Nothing here is trusted. The server re-reads the screen and the campaign at
 * the identify moment, and credits a campaign only while it still exists and
 * the page is still filed under it — so a hand-edited entry can claim no more
 * than a page the site really files under a real campaign.
 *
 * ## The same window, the same last-touch rule, the same consent
 *
 * {@link ATTRIBUTION_WINDOW_DAYS}, overwritten by the next page filed under a
 * campaign, and kept on the device only under the grant the labels above
 * wait for. The page the visitor is ON needs no grant at all, exactly as the
 * live URL needs none: {@link notePageCampaigns} holds it in memory for the
 * pageview, and a door on that page reports it with nothing written.
 *
 * ## The first-visit claim
 *
 * A campaign's page counts the visitors it reached for the first time in a
 * window (`claimCampaignFirstVisits`). The device remembers which campaigns
 * it has already been counted for, and for how long, under
 * {@link CAMPAIGN_VISITS_STORAGE_KEY} — ids and labels with an instant each,
 * nothing that names the visitor. Without the grant nothing is remembered and
 * nothing is claimed: a visit that cannot be told from the last one is not
 * counted as a first.
 *=========================================*/

/** Where the last page touch is held. */
export const PAGE_TOUCH_STORAGE_KEY = 'aglyn:page-touch'

/** Where the campaigns already counted as a first visit are held. */
export const CAMPAIGN_VISITS_STORAGE_KEY = 'aglyn:campaign-visits'

/**
 * How many of a page's campaigns a touch carries. A page is rarely filed
 * under more than one; the cap is on the bytes a wire field may carry.
 */
export const PAGE_TOUCH_MAX_CAMPAIGNS = 5

/** How many campaigns and labels the first-visit record remembers at once. */
const CAMPAIGN_VISITS_MAX = 50

/** The page touch's keys inside the wire form, outside the `utm_` allowlist. */
const PAGE_TOUCH_KEYS = {
  campaigns: 'pc',
  screen: 'ps',
  path: 'pp',
  time: 'pt',
} as const

/** A document id as the platform mints them; anything else is not one. */
const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,64}$/

/** The longest page path a touch carries. */
const MAX_PATH = 200

/** A page filed under one or more campaigns, and when it was viewed. */
export interface PageTouch {
  /** The campaign ids the page was filed under, in the screen's order. */
  campaignIds: string[]
  /** The screen the page renders. */
  screenId: string
  /** The page's path, `/`-led. */
  path: string
  /** When the visitor viewed it, epoch ms. */
  atMs: number
}

/** The page this pageview is on, when it is filed under a campaign. */
let currentPage: PageTouch | null = null

function cleanCampaignIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const ids: string[] = []
  for (const entry of raw) {
    const id = typeof entry === 'string' ? entry.trim() : ''
    if (!DOCUMENT_ID.test(id) || ids.includes(id)) continue
    ids.push(id)
    if (ids.length >= PAGE_TOUCH_MAX_CAMPAIGNS) break
  }
  return ids
}

function cleanPath(raw: unknown): string {
  const path = typeof raw === 'string' ? raw.trim() : ''
  if (!path.startsWith('/') || path.startsWith('//')) return ''
  return path.slice(0, MAX_PATH)
}

/**
 * The canonical wire form of a page touch — the ONLY place it is written, so
 * it cannot drift from what {@link parsePageTouch} reads back.
 */
export function pageTouchWire(touch: PageTouch | null | undefined): string {
  if (!touch) return ''
  const campaignIds = cleanCampaignIds(touch.campaignIds)
  const screenId = String(touch.screenId ?? '').trim()
  const atMs = Math.round(Number(touch.atMs))
  if (!campaignIds.length || !DOCUMENT_ID.test(screenId)) return ''
  if (!Number.isFinite(atMs) || atMs <= 0) return ''
  const params = new URLSearchParams()
  params.set(PAGE_TOUCH_KEYS.campaigns, campaignIds.join(','))
  params.set(PAGE_TOUCH_KEYS.screen, screenId)
  const path = cleanPath(touch.path)
  if (path) params.set(PAGE_TOUCH_KEYS.path, path)
  params.set(PAGE_TOUCH_KEYS.time, String(atMs))
  return params.toString()
}

/**
 * Read a stored or transmitted page touch back, or `null`.
 *
 * The window is enforced here for the reason {@link parseUtmTouch} gives:
 * every reader agrees that an expired touch is nothing. The ids are shape-
 * checked only — whether the page is still filed under them is the server's
 * question, asked at the moment of credit.
 */
export function parsePageTouch(
  wire: unknown,
  nowMs: number = Date.now(),
): PageTouch | null {
  if (typeof wire !== 'string' || !wire) return null
  let params: URLSearchParams
  try {
    params = new URLSearchParams(wire)
  } catch {
    return null
  }
  const campaignIds = cleanCampaignIds(
    String(params.get(PAGE_TOUCH_KEYS.campaigns) ?? '').split(','),
  )
  const screenId = String(params.get(PAGE_TOUCH_KEYS.screen) ?? '').trim()
  if (!campaignIds.length || !DOCUMENT_ID.test(screenId)) return null
  const atMs = Number(params.get(PAGE_TOUCH_KEYS.time))
  if (!touchIsInWindow(atMs, nowMs)) return null
  return {
    campaignIds,
    screenId,
    path: cleanPath(params.get(PAGE_TOUCH_KEYS.path)),
    atMs,
  }
}

/** Write the page this pageview is on as the visitor's last page touch. */
function rememberPageTouch(): void {
  if (storageConsent !== true || !currentPage) return
  const store = localStore()
  if (!store) return
  const wire = pageTouchWire(currentPage)
  if (!wire) return
  try {
    store.setItem(PAGE_TOUCH_STORAGE_KEY, wire)
  } catch {
    // The page the visitor is on is still reported live; only the walk to a
    // page filed under nothing loses it.
  }
}

/**
 * Tell this module which campaigns the page being viewed is filed under.
 *
 * Called by the plugin that keeps campaigns, on every pageview, with what its
 * server half read off the screen — or with `null` for a page filed under
 * none, which clears the LIVE page and leaves the remembered one alone: a
 * visitor who reads a campaign's landing page and then the site's pricing
 * page has still been touched by the campaign.
 *
 * Overwrites the remembered touch, because the model is last touch.
 *
 * @returns the touch now live, or `null`.
 */
export function notePageCampaigns(
  page: {
    screenId?: string | null
    campaignIds?: readonly string[] | null
    path?: string | null
  } | null,
  nowMs: number = Date.now(),
): PageTouch | null {
  const campaignIds = cleanCampaignIds(page?.campaignIds ?? [])
  const screenId = String(page?.screenId ?? '').trim()
  if (!page || !campaignIds.length || !DOCUMENT_ID.test(screenId)) {
    currentPage = null
    return null
  }
  const path = cleanPath(
    page.path ??
      (typeof window === 'undefined' ? '' : window.location.pathname),
  )
  // The same page noted twice in one pageview keeps the instant it was first
  // viewed: a re-render is not a second visit.
  if (
    currentPage &&
    currentPage.screenId === screenId &&
    currentPage.path === path &&
    currentPage.campaignIds.join(',') === campaignIds.join(',')
  ) {
    return currentPage
  }
  currentPage = { campaignIds, screenId, path, atMs: nowMs }
  rememberPageTouch()
  return currentPage
}

/**
 * The page touch to credit a conversion happening right now, or `null`.
 *
 * The page the visitor is on wins, with the instant they viewed it; only on a
 * page filed under nothing does this fall back to what was remembered. An
 * expired entry is deleted on the read that finds it, as the labels' is.
 */
export function readPageTouch(
  nowMs: number = Date.now(),
): PageTouch | null {
  if (currentPage && touchIsInWindow(currentPage.atMs, nowMs)) {
    return currentPage
  }
  if (storageConsent !== true) return null
  const store = localStore()
  if (!store) return null
  let raw: string | null
  try {
    raw = store.getItem(PAGE_TOUCH_STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  const touch = parsePageTouch(raw, nowMs)
  if (!touch) {
    try {
      store.removeItem(PAGE_TOUCH_STORAGE_KEY)
    } catch {
      // Already uncreditable; the next read finds it again.
    }
    return null
  }
  return touch
}

/**
 * Which of these campaigns this device is visiting for the first time in the
 * window — and remember that it now has.
 *
 * `keys` are the caller's own words for what was touched: a campaign id, or a
 * label the server will look up. Each one answers once per window: a key
 * already claimed inside it is not claimed again, and one whose claim has
 * aged out is claimed afresh, because the window is how long a visit may be
 * credited and a visit after it is a new arrival.
 *
 * Answers `[]` without the storage grant — see the section note.
 */
export function claimCampaignFirstVisits(
  keys: readonly string[],
  nowMs: number = Date.now(),
): string[] {
  if (storageConsent !== true) return []
  const store = localStore()
  if (!store) return []
  let seen: Record<string, number> = {}
  try {
    const raw = store.getItem(CAMPAIGN_VISITS_STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      seen = parsed as Record<string, number>
    }
  } catch {
    seen = {}
  }
  const live: Record<string, number> = {}
  for (const [key, atMs] of Object.entries(seen)) {
    if (typeof key === 'string' && key.length <= 120 && touchIsInWindow(Number(atMs), nowMs)) {
      live[key] = Number(atMs)
    }
  }
  const claimed: string[] = []
  for (const raw of keys) {
    const key = typeof raw === 'string' ? raw.trim().slice(0, 120) : ''
    if (!key || key in live || claimed.includes(key)) continue
    live[key] = nowMs
    claimed.push(key)
  }
  // The oldest go first when the record is full; a key dropped early is at
  // worst counted again, never lost from a campaign that was counted.
  const kept = Object.entries(live)
    .sort((a, b) => b[1] - a[1])
    .slice(0, CAMPAIGN_VISITS_MAX)
  try {
    store.setItem(CAMPAIGN_VISITS_STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)))
  } catch {
    // A device that refuses the write cannot remember the claim, so it
    // claims nothing: a visit it cannot tell from the next is not a first.
    return []
  }
  return claimed
}
