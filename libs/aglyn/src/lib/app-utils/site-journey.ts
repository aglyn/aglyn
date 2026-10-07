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

import { sendAnalyticsBeacon } from './analytics-beacon'

/**
 * A VISIT'S STEPS, IN ORDER (AGL-3605): the one per-visit record the site
 * collector keeps, so a funnel can ask "of the visits that did A, how many
 * then did B".
 *
 * Every other first-party counter is a daily aggregate with no identifier at
 * all (`visit-claim.ts` says why), and an aggregate cannot be ordered: a day
 * with 100 pricing views and 10 sign-ups says nothing about whether the
 * sign-ups viewed pricing. Ordering needs something that ties two steps to one
 * visit, and this module is that and nothing more.
 *
 * ## What identifies a visit
 *
 * A random id held in `sessionStorage`: one browser tab, until it closes. Not
 * a cookie, not `localStorage`, never derived from the address or the
 * browser, never shared between sites (the stored id names the site it was
 * minted for, and another site's page mints its own). Two tabs are two
 * visits; closing the tab and coming back tomorrow is a new visit; nothing
 * links a visit to a person.
 *
 * ## Consent
 *
 * The id leaves the browser, so it is `analytics` storage and waits for the
 * same grant the site's analytics tag waits for. The page tells this module
 * the verdict on every render ({@link configureSiteJourney}): until it grants
 * — and for a visitor who declines, opts out or sends GPC — nothing is minted
 * and every step is DROPPED, never queued, for the reason
 * `analytics-events.ts` gives. The one step recorded at the moment of a grant
 * is the page the visitor is on right then, which is a step they are taking
 * now, not a replay. Withdrawing the grant deletes the stored id, so a later
 * grant starts a new visit rather than continuing the old one.
 *
 * ## When it runs at all
 *
 * Only on a site that records journeys (`host.funnelRecording === true`,
 * which the plugin that reads them stamps when a site has something to read
 * them for), only on a production surface without the internal-traffic
 * opt-in (the beacon's own gate), and at most {@link SITE_JOURNEY_MAX_STEPS}
 * steps per visit.
 *
 * Kept free of the `@aglyn/aglyn` barrel and of any plugin: the published
 * page's measurement mount imports it (the AGL-1550 independence rule), and
 * plugins report their steps here without knowing who counts them.
 */

/** The body field that marks a collector beacon as a journey step. */
export const SITE_JOURNEY_BEACON_FIELD = 'journey'

/**
 * What a step can be — only what the platform already sees happen.
 *
 * - `page`: a page was viewed; key = the path.
 * - `form`: a form was submitted successfully; key = the form id.
 * - `booking`: a booking was made (a free one confirmed, or a paid one's
 *   payment settled); key = the service id.
 * - `cart`: a product was added to the cart; key = the product id.
 * - `order`: a storefront order was placed and paid; no key.
 * - `overlay`: an announcement bar or popup was clicked; key = the overlay id.
 * - `event`: a custom event an interaction fired; key = the event name.
 */
export const SITE_JOURNEY_STEP_TYPES = [
  'page',
  'form',
  'booking',
  'cart',
  'order',
  'overlay',
  'event',
] as const

export type SiteJourneyStepType = (typeof SITE_JOURNEY_STEP_TYPES)[number]

export function isSiteJourneyStepType(value: unknown): value is SiteJourneyStepType {
  return (
    typeof value === 'string' &&
    (SITE_JOURNEY_STEP_TYPES as readonly string[]).includes(value)
  )
}

/** The most steps one visit records. A visit past it records nothing more. */
export const SITE_JOURNEY_MAX_STEPS = 60

/** The longest key a step carries; longer keys are cut. */
export const SITE_JOURNEY_KEY_MAX = 200

/** A visit id's shape: 22 URL-safe characters (128 random bits). */
export const SITE_JOURNEY_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/

const STORAGE_KEY = 'aglyn-journey'

/** Whether a host document asks for journeys to be recorded. */
export function hostRecordsJourneys(
  host: { funnelRecording?: unknown } | null | undefined,
): boolean {
  return host?.funnelRecording === true
}

interface StoredJourney {
  id: string
  hostId: string
  steps: number
  /** The last step sent, so a reload of the same page is one step. */
  last?: string
}

interface JourneyState {
  hostId: string | null
  enabled: boolean
  /** The page last recorded, so a re-render records nothing new. */
  path: string | null
}

const state: JourneyState = { hostId: null, enabled: false, path: null }

function readStored(): StoredJourney | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredJourney
    if (!parsed || !SITE_JOURNEY_ID_PATTERN.test(String(parsed.id))) return null
    return parsed
  } catch {
    return null
  }
}

function writeStored(journey: StoredJourney): boolean {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(journey))
    return true
  } catch {
    return false
  }
}

function forgetStored(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing stored, or storage refused: either way nothing is held.
  }
}

/** 128 random bits as 22 URL-safe characters, or null without a CSPRNG. */
function mintJourneyId(): string | null {
  try {
    const bytes = new Uint8Array(16)
    window.crypto.getRandomValues(bytes)
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  } catch {
    return null
  }
}

/** Where this visit came from, sent once with its first step. */
function arrivalSource(): Record<string, string> {
  const source: Record<string, string> = {}
  try {
    const params = new URLSearchParams(window.location.search)
    for (const [param, field] of [
      ['utm_source', 'utmSource'],
      ['utm_medium', 'utmMedium'],
      ['utm_campaign', 'utmCampaign'],
    ] as const) {
      const value = params.get(param)
      if (value) source[field] = value.slice(0, 100)
    }
    const referrer = document.referrer ? new URL(document.referrer) : null
    if (referrer && referrer.host && referrer.host !== window.location.host) {
      source['referrerHost'] = referrer.host.slice(0, 100)
    }
  } catch {
    // An unreadable referrer is a direct visit.
  }
  return source
}

/**
 * Tells the recorder what the page knows: the site, and whether this visitor
 * may be recorded right now (the site records journeys AND the visitor's
 * analytics consent grants). Called on every render of the page's
 * measurement mount; idempotent.
 *
 * `enabled: null` means "not known yet" — consent still resolving, which a
 * page that remounts goes through on every navigation. Nothing is recorded
 * while it is unknown, and nothing is forgotten either: only a settled `false`
 * (a refusal, or the site no longer recording) deletes the stored visit.
 *
 * `path` is the page the visitor is on. It is recorded as a step when
 * recording turns on and whenever it changes while recording is on — so the
 * page steps are driven from here, once per page the visitor moves to.
 */
export function configureSiteJourney(options: {
  hostId: string | null | undefined
  enabled: boolean | null
  path?: string | null
}): void {
  if (typeof window === 'undefined') return
  const hostId = options.hostId || null
  const enabled = Boolean(hostId) && options.enabled === true
  const turnedOn = enabled && (!state.enabled || state.hostId !== hostId)
  state.hostId = hostId
  state.enabled = enabled
  if (options.enabled === false) forgetStored()
  const path = options.path || null
  if (enabled && path && (turnedOn || path !== state.path)) {
    state.path = path
    recordSiteJourneyStep('page', path)
  }
  if (!enabled) state.path = null
}

/**
 * Records one step of this visit, or drops it: when the page has not enabled
 * recording, when the visit is full, or when the browser refuses storage.
 * Never throws, never queues, never delays the caller.
 */
export function recordSiteJourneyStep(
  type: SiteJourneyStepType,
  key?: string | null,
): void {
  try {
    if (typeof window === 'undefined' || !state.enabled || !state.hostId) return
    if (!isSiteJourneyStepType(type)) return
    const hostId = state.hostId
    const cleanKey = String(key ?? '').trim().slice(0, SITE_JOURNEY_KEY_MAX)
    if (type === 'page' && !cleanKey.startsWith('/')) return
    if (type === 'event' && !cleanKey) return
    const stepId = `${type}\u0000${cleanKey}`

    let journey = readStored()
    let first = false
    if (!journey || journey.hostId !== hostId) {
      const id = mintJourneyId()
      if (!id) return
      journey = { id, hostId, steps: 0 }
      first = true
    }
    if (journey.steps >= SITE_JOURNEY_MAX_STEPS) return
    if (journey.last === stepId) return
    journey = { ...journey, steps: journey.steps + 1, last: stepId }
    if (!writeStored(journey)) return

    sendAnalyticsBeacon({
      hostId,
      [SITE_JOURNEY_BEACON_FIELD]: journey.id,
      stepType: type,
      ...(cleanKey ? { stepKey: cleanKey } : {}),
      ...(first ? { journeyStart: true, ...arrivalSource() } : {}),
    })
  } catch {
    // A journey step never breaks the page.
  }
}

/** Test seam: forget the page's configuration. */
export function resetSiteJourneyForTests(): void {
  state.hostId = null
  state.enabled = false
  state.path = null
}
