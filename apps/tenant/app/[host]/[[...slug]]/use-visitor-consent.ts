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

'use client'

// The deep module, never the `@aglyn/aglyn` barrel (AGL-1550). This hook is
// part of the analytics/consent subtree that must stay independent of the
// site-plugin gate, and the barrel pulls the plugin manager and the canvas in
// behind it — an import that defeats the whole point of the hoist while
// looking like a tidier import line. `site-analytics-independence.spec.ts`
// asserts it.
import {
  hasGlobalPrivacyControl,
  isExplicitConsentStatus,
  readStoredVisitorConsent,
  resolveConsentPosture,
  type StoredVisitorConsent,
  storeVisitorConsent,
  VISITOR_CONSENT_CHANGED_EVENT,
  type VisitorConsentHost,
  type VisitorConsentPosture,
} from '@aglyn/aglyn/app-utils/visitor-consent'
import { useEffect, useState } from 'react'

/**
 * Resolves a visitor's consent state, client-side only (AGL-1498).
 *
 * Tenant pages are ISR-cached, so neither the visitor's region nor their
 * choice can EVER shape the server HTML — every visitor gets the same
 * cached page, and this hook is where their own state attaches after
 * hydration. `ready` starts false and the server/first client render agree
 * on "nothing yet", which is also the gate's safe answer.
 *
 * Resolution order, most binding first:
 *
 * 1. An EXPLICIT stored choice (accepted / declined / opted-out) — theirs,
 *    keep it, no region lookup needed.
 * 2. GPC — the browser's opt-out signal overrides an implied default (it
 *    can arrive after the default was recorded) but never an explicit
 *    choice: a specific, informed accept outranks a blanket signal.
 * 3. A stored implied / gpc-opt-out record — resolved on a prior visit.
 * 4. Nothing stored: ask `/api/consent/region` (session-cached) and apply
 *    the posture — `opt-out` records `implied` and tracking is live from
 *    this first paint; `opt-in` leaves the visitor undecided, which keeps
 *    the script out until the banner gets a yes.
 *
 * `?aglynConsent=ask` simulates a first prior-consent visit — stored state
 * is ignored for DISPLAY and the posture forces to `opt-in`. Honored on any
 * surface because it only ever moves TOWARD strictness: a crafted link can
 * show someone a banner they've already answered, never strip a banner or
 * un-decline a decline (choices made under the override are stored for
 * real, as the visitor's own clicks).
 */

/** Session-scoped region cache — one lookup per visit, not per pageview. */
const REGION_CACHE_KEY = 'aglyn:consent:region'

async function resolveVisitorCountry(): Promise<string | null> {
  try {
    const cached = window.sessionStorage.getItem(REGION_CACHE_KEY)
    if (cached) {
      const parsed = JSON.parse(cached)
      if (parsed && 'country' in parsed) {
        return typeof parsed.country === 'string' ? parsed.country : null
      }
    }
  } catch {
    // No storage — fetch every pageview; correct, just less frugal.
  }
  try {
    const response = await fetch('/api/consent/region')
    if (!response.ok) return null
    const payload = await response.json().catch(() => null)
    const country =
      typeof payload?.country === 'string' ? payload.country : null
    try {
      // A successful `null` is cached too: "the edge sends no geo here" is
      // an answer, and re-asking cannot improve it this session.
      window.sessionStorage.setItem(
        REGION_CACHE_KEY,
        JSON.stringify({ country }),
      )
    } catch {
      // Best-effort cache only.
    }
    return country
  } catch {
    // Network failure reads as unknown region → opt-in, the strict side.
    return null
  }
}

function hasAskOverride(): boolean {
  try {
    return (
      new URLSearchParams(window.location.search).get('aglynConsent') === 'ask'
    )
  } catch {
    return false
  }
}

export interface VisitorConsentState {
  ready: boolean
  stored: StoredVisitorConsent | null
  posture: VisitorConsentPosture | null
  country: string | null
}

const INITIAL_STATE: VisitorConsentState = {
  ready: false,
  stored: null,
  posture: null,
  country: null,
}

/** The resolution itself, with no React in it. */
export type ResolvedVisitorConsent = Omit<VisitorConsentState, 'ready'>

/**
 * Resolve the visitor's consent state, per the order in the module comment.
 *
 * A plain async function rather than effect-local code (AGL-1550), because it
 * has two callers that must not drift: the hook below, which needs the answer
 * to render with, and `primeVisitorConsent`, which needs the `/api/consent/region`
 * call to GO OUT even when React never commits. Idempotent — it reads and
 * writes the same storage deterministically, and the region lookup is
 * session-cached — so running it twice costs one network call and reaches one
 * answer.
 */
export async function decideVisitorConsent(
  hostId: string,
  host: VisitorConsentHost | null | undefined,
): Promise<ResolvedVisitorConsent> {
  if (hasAskOverride()) {
    // Simulate a first prior-consent visit; see the module comment.
    return { stored: null, posture: 'opt-in', country: null }
  }
  let stored = readStoredVisitorConsent(hostId)
  if (
    hasGlobalPrivacyControl() &&
    !isExplicitConsentStatus(stored?.status) &&
    stored?.status !== 'gpc-opt-out'
  ) {
    stored = storeVisitorConsent(hostId, {
      status: 'gpc-opt-out',
      country: stored?.country ?? null,
    })
  }
  if (stored) {
    return { stored, posture: null, country: stored.country ?? null }
  }
  const country = await resolveVisitorCountry()
  const posture = resolveConsentPosture(host, country)
  if (posture === 'opt-out') {
    // Implied consent, recorded as such — tracking is live from this first
    // paint, and the persistent "Privacy choices" pill is the opt-out
    // surface. No banner, no notice: the Squarespace shape.
    return {
      stored: storeVisitorConsent(hostId, { status: 'implied', country }),
      posture,
      country,
    }
  }
  return { stored: null, posture, country }
}

/**
 * One-shot guard for the render-time kick below — a pageview asks the region
 * endpoint once, not once per render pass.
 */
const primed = new Set<string>()

/**
 * Start the consent resolution WITHOUT waiting for React to commit (AGL-1550).
 *
 * The hook's effect is the normal path and does this too. It is not enough on
 * its own: an effect only runs if React commits, and the whole failure this
 * issue exists to prevent is a page that renders but never commits because
 * something above it — the site-plugin gate, in AGL-1541 — stayed suspended.
 * `ErrorBeacon` (AGL-1538) solves the same problem the same way, installing at
 * module scope rather than from an effect, so it still reports when the page
 * is wedged.
 *
 * Fire-and-forget: the result lands in storage (and the session region cache),
 * so whenever the hook does get to run it reads the answer rather than asking
 * again. Client-only — the server must stay identical for every visitor or ISR
 * would cache one visitor's region (AGL-1498).
 */
export function primeVisitorConsent(
  hostId: string | undefined,
  host: VisitorConsentHost | null | undefined,
  required: boolean,
): void {
  if (typeof window === 'undefined' || !required || !hostId) return
  const key = `${hostId}\x00${window.location.pathname}`
  if (primed.has(key)) return
  primed.add(key)
  void decideVisitorConsent(hostId, host).catch(() => undefined)
}

export function useVisitorConsent(
  hostId: string | undefined,
  host: VisitorConsentHost | null | undefined,
  required: boolean,
): VisitorConsentState {
  const [state, setState] = useState<VisitorConsentState>(INITIAL_STATE)

  useEffect(() => {
    if (!required || !hostId) return undefined
    let active = true

    const sync = () =>
      setState((previous) => ({
        ...previous,
        ready: true,
        stored: readStoredVisitorConsent(hostId),
      }))

    void decideVisitorConsent(hostId, host).then((resolved) => {
      if (active) setState({ ready: true, ...resolved })
    })
    window.addEventListener(VISITOR_CONSENT_CHANGED_EVENT, sync)
    return () => {
      active = false
      window.removeEventListener(VISITOR_CONSENT_CHANGED_EVENT, sync)
    }
    // `host` participates via the posture only; its identity per render is
    // the page-props object, stable for a pageview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId, required])

  return state
}
