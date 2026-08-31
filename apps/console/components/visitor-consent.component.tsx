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

import ConsentBannerUi, {
  type ConsentCopy,
} from '@aglyn/aglyn/app-utils/consent-banner-ui'
import { VISITOR_CONSENT_CHANGED_EVENT, VISITOR_CONSENT_OPEN_EVENT } from '@aglyn/aglyn/app-utils/visitor-consent'
import type {
  StoredVisitorConsent,
  VisitorConsentPosture,
} from '@aglyn/aglyn/app-utils/visitor-consent'
import {
  decidePlatformConsent,
  PLATFORM_CONSENT_SUBJECT,
  platformAsksAboutAdvertising,
  readPlatformConsent,
  storePlatformConsent,
} from '@aglyn/aglyn/app-utils/platform-visitor-consent'
import { Link, Typography } from '@mui/material'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { LEGAL_REFERENCE_URLS, LEGAL_URLS } from '../constants/shared'

/**
 * The console's visitor-consent surfaces — the UI over the enforcement layer,
 * never the enforcement itself.
 *
 * Enforcement lives in `firebase-services.tsx`: the Firebase Analytics tag is
 * not created at all while the registered consent gate says no, so gtag.js is
 * never fetched, `window.gtag` never exists, and the shared `deliver()` has no
 * fallback to reach. That property holds whether or not this component ever
 * renders, which is the only arrangement worth having — a banner that appears
 * while data is already flowing is worse than no banner, because it documents
 * a choice the visitor never actually got.
 *
 * ## The surfaces themselves are SHARED
 *
 * `ConsentBannerUi` draws all three, on this console and on every published
 * customer site, and it decides which one is up. What this file adds is the
 * three things that are genuinely the console's: the resolution
 * (`decidePlatformConsent`), the wording, and where the persistent control
 * lives. Everything below describes what those choices mean here — the drawing
 * of them is one component, in one place.
 *
 * The three are mutually exclusive by construction rather than by arrangement:
 * they are fixed to the bottom of the viewport, and a visitor being asked does
 * not also need a control telling them they may choose.
 *
 * - **The prior-consent banner.** Shown only to a visitor the posture says
 *   must be ASKED FIRST — the UK, the EU/EEA, Switzerland, and anyone whose
 *   region cannot be determined — and only while they are undecided. It
 *   disappears the moment they answer and never comes back. Everywhere else
 *   consent is implied and no banner renders at all.
 *
 * - **The persistent control.** "Your Privacy Choices", the CCPA §7015 opt-out
 *   link. Where it lives is decided by whether the page has an account menu:
 *   signed in it is a row in that menu and NOTHING floats over the page; on
 *   the unauthenticated pages, which have no menu, the shell asks for the pill
 *   drawn below. See {@link VisitorConsentPill}.
 *
 * - **The preferences panel.** The change-your-mind path in BOTH directions,
 *   with no trigger of its own. It opens on
 *   {@link VISITOR_CONSENT_OPEN_EVENT} — dispatched by the account menu's row
 *   — on the pill, and on a click of any `#aglyn-consent` link.
 *
 * ## Checkbox state is DERIVED, never defaulted
 *
 * The switches read the resolved record, so they describe what is actually
 * happening to this visitor rather than a house preference:
 *
 * - Outside the prior-consent regions, resolution writes an `implied` record
 *   on the first visit and the analytics switch reads ON — correctly, because
 *   that visitor IS being measured and this control is their withdrawal path.
 * - Inside them, resolution writes nothing at all, so the switch reads OFF
 *   until they accept. A ticked box shown to someone who has not consented
 *   misrepresents their state, and it is the misrepresentation that matters
 *   most here.
 *
 * The same derivation covers a visitor with no stored record from before this
 * shipped. Nothing is backfilled: writing an `accepted` record for existing
 * users would fabricate a consent nobody gave, and in a prior-consent region
 * it would fabricate the one kind that is unlawful to assume.
 */

/**
 * The console's wording. Everything else about the surfaces is shared.
 *
 * These are the only differences that were ever real between the two consent
 * implementations this replaced: a console says "this console", a published
 * site says "this site", and the strictly-necessary sentence names signing in
 * here and shopping carts there. Passed as strings, because a string is not a
 * reason for a second component.
 */
const CONSOLE_CONSENT_COPY: ConsentCopy = {
  panelIntro: 'Choose what this console may use.',
  strictlyNecessary:
    'Strictly necessary features — signing in, keeping you signed in, and ' +
    'remembering this choice — are always on because the console cannot work ' +
    'without them.',
  bannerAnalyticsOnly:
    'This console would like to use analytics (Google Analytics) to ' +
    'understand how it is used. It does not run unless you allow it — ' +
    'signing in and everything else here works either way.',
  bannerWithAdvertising:
    'This console would like to use analytics (Google Analytics) to ' +
    'understand how it is used, and advertising cookies to personalize ads ' +
    'and measure how they perform. Neither runs unless you allow it — ' +
    'signing in and everything else here works either way. Use Preferences ' +
    'to choose them separately.',
  analyticsDetail:
    'Google Analytics — which pages are used and where things go wrong.',
}

/**
 * The documents behind the choice.
 *
 * A node rather than a pair of URLs in the shared component, because these are
 * the CONSOLE's published policies, reached through its own route constants. A
 * choice offered with no way to read what is being chosen is not an informed
 * one.
 */
function PolicyLinks(): ReactElement {
  return (
    <Typography variant="caption" color="text.secondary" component="div">
      {'Read the '}
      <Link href={LEGAL_URLS.PRIVACY} target="_blank" rel="noopener noreferrer">
        {'Privacy Policy'}
      </Link>
      {' and the '}
      <Link
        href={LEGAL_REFERENCE_URLS.COOKIES}
        target="_blank"
        rel="noopener noreferrer"
      >
        {'Cookie Policy'}
      </Link>
      {'.'}
    </Typography>
  )
}

/**
 * Pages with no account menu ask for the persistent control by mounting this.
 *
 * ## Why it is a declaration and not the control itself
 *
 * Which of the consent surfaces is up has to have ONE owner. The banner, the
 * preferences panel and the persistent control are mutually exclusive — a
 * visitor being asked does not also need a pill telling them they may choose,
 * and two fixed elements at the bottom of a narrow viewport collide. The
 * shared overlay that ships on customer sites resolves that in one component
 * for the same reason; this does the same across a tree it cannot be a parent
 * of, because the shell that knows the page has no account menu sits BELOW the
 * component that knows the visitor's consent state.
 *
 * So this registers presence and renders nothing. {@link VisitorConsent} draws
 * the control, and only when nothing else is up.
 *
 * ## Where it belongs, and why that is a placement rule rather than a taste
 *
 * A signed-in console page carries the account menu, and a person looks for
 * their own settings there — so the control is a row in that menu and nothing
 * floats over the page. The unauthenticated pages have no such menu: sign-in,
 * sign-up, account recovery, SSO, email verification and sign-out are the
 * console's public surface, `/signin` is its most-collected page, and a
 * visitor there would otherwise have no reachable control at all.
 *
 * Mounted from `authenticating.layout.tsx`, the shell every one of those
 * routes renders through, rather than page by page. That is what makes it
 * structural: a new unauthenticated route inherits the control instead of
 * needing someone to remember it, and a page that grows an account menu stops
 * getting it by construction.
 */
export function VisitorConsentPill(): null {
  useEffect(() => {
    pillRequests += 1
    notifyPillRequests()
    return () => {
      pillRequests -= 1
      notifyPillRequests()
    }
  }, [])
  return null
}
VisitorConsentPill.displayName = 'VisitorConsentPill'
VisitorConsentPill.aglyn = true

/**
 * How many mounted pages are asking for the persistent control.
 *
 * A COUNT rather than a boolean: React can hold the outgoing tree alongside
 * the incoming one across a navigation, so an unmount and a mount overlap, and
 * a boolean set false by the departing shell would hide the control on the
 * arriving one.
 */
let pillRequests = 0
const pillListeners = new Set<() => void>()

function notifyPillRequests(): void {
  for (const listener of pillListeners) listener()
}

function useConsentPillRequested(): boolean {
  const [requested, setRequested] = useState(false)
  useEffect(() => {
    const sync = () => setRequested(pillRequests > 0)
    sync()
    pillListeners.add(sync)
    return () => {
      pillListeners.delete(sync)
    }
  }, [])
  return requested
}

/** Open the console's privacy-choices panel from anywhere in the app. */
export function openVisitorConsentPanel(): void {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent(VISITOR_CONSENT_OPEN_EVENT))
  } catch {
    // A dispatch failure costs the click, never the page.
  }
}

interface ResolvedState {
  ready: boolean
  stored: StoredVisitorConsent | null
  posture: VisitorConsentPosture | null
  country: string | null
}

const INITIAL: ResolvedState = {
  ready: false,
  stored: null,
  posture: null,
  country: null,
}

export function VisitorConsent(): ReactElement | null {
  const [state, setState] = useState<ResolvedState>(INITIAL)
  const asksAboutAdvertising = platformAsksAboutAdvertising()
  const pillRequested = useConsentPillRequested()

  useEffect(() => {
    let active = true

    /**
     * Adopt whatever the record now says. Called on resolution and on every
     * consent change, including one made in another tab of the same origin —
     * `storeVisitorConsent` dispatches on this window, and a re-read is
     * cheaper than reasoning about which writer moved it.
     */
    const adopt = (resolved?: ResolvedState) => {
      if (!active) return
      setState((previous) =>
        resolved
          ? resolved
          : { ...previous, ready: true, stored: readPlatformConsent() },
      )
    }

    void decidePlatformConsent().then((resolved) =>
      adopt({ ready: true, ...resolved }),
    )
    const onChanged = () => adopt()
    window.addEventListener(VISITOR_CONSENT_CHANGED_EVENT, onChanged)
    return () => {
      active = false
      window.removeEventListener(VISITOR_CONSENT_CHANGED_EVENT, onChanged)
    }
  }, [])

  // Nothing renders until the visitor is resolved. `posture` is null until
  // then, which already keeps the ask-banner out; this also keeps the pill
  // from flashing on a page that turns out to have a record.
  if (!state.ready) return null

  return (
    <ConsentBannerUi
      hostId={PLATFORM_CONSENT_SUBJECT}
      stored={state.stored}
      posture={state.posture}
      country={state.country}
      advertising={asksAboutAdvertising}
      // The persistent control belongs in the account menu on a page that has
      // one, so the pill is drawn only where a shell has asked for it — see
      // `VisitorConsentPill`.
      showPill={pillRequested}
      copy={CONSOLE_CONSENT_COPY}
      policyLinks={<PolicyLinks />}
      // The console owns persistence: `storePlatformConsent` writes the same
      // record through the same shared writer AND mirrors it at the
      // registrable domain, so an answer given while signing in on the auth
      // host still applies once the visitor is inside the console.
      onDecision={(status, advertising) =>
        storePlatformConsent({
          status,
          country: state.country,
          advertising: advertising === true,
        })
      }
    />
  )
}
VisitorConsent.displayName = 'VisitorConsent'
VisitorConsent.aglyn = true

export default VisitorConsent
