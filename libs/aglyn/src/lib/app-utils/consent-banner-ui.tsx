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

import {
  type CSSProperties,
  type ReactElement,
  useEffect,
  useState,
} from 'react'
import {
  readStoredVisitorConsent,
  type StoredVisitorConsent,
  storeVisitorConsent,
  VISITOR_CONSENT_OPEN_EVENT,
  type VisitorConsentPosture,
  type VisitorConsentStatus,
} from './visitor-consent'

/**
 * The visitor consent surfaces (AGL-1498) — UI over the enforcement layer,
 * never the enforcement itself: the GA script stays unloaded until a
 * granting state is recorded, whether or not this component ever rendered.
 *
 * Three surfaces in one component, driven by the resolved state:
 *
 * - **The prior-consent banner** (opt-in posture, undecided visitor):
 *   symmetric Allow / Decline plus Preferences — the peer benchmark's
 *   credible shape; Decline is never buried.
 * - **The "Privacy choices" pill**: a small, persistent, fixed control on
 *   EVERY page whenever the consent machinery is active. In the implied
 *   posture no banner and no notice ever renders (the Squarespace shape),
 *   which makes this pill the ONE discoverable opt-out surface — that is
 *   why it is platform-mounted rather than a per-template footer link a
 *   theme could drop. Sites can additionally link any element to
 *   `#aglyn-consent`; both open the same panel.
 * - **The preferences panel**: change the state in EITHER direction at any
 *   time — accept after declining, opt out after being defaulted in.
 *
 * Lives in the shared lib because the console preview renders the SAME
 * component under its region simulator — a preview that renders an
 * approximation would prove nothing about the real banner.
 */

const OVERLAY_FONT =
  'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

const CARD_STYLE: CSSProperties = {
  position: 'fixed',
  left: '50%',
  bottom: 16,
  transform: 'translateX(-50%)',
  // Above the popup backdrop (2147483200): the consent question outranks a
  // promotional popup, and the popup's own GA mirrors wait on the answer.
  zIndex: 2147483400,
  width: 'min(680px, calc(100vw - 24px))',
  boxSizing: 'border-box',
  padding: 16,
  borderRadius: 12,
  border: '1px solid rgba(0, 0, 0, 0.12)',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.18)',
  background: '#fff',
  color: '#111',
  fontFamily: OVERLAY_FONT,
  fontSize: 14,
  lineHeight: 1.5,
  textAlign: 'left',
}

const BUTTON_BASE: CSSProperties = {
  boxSizing: 'border-box',
  minWidth: 104,
  padding: '8px 16px',
  borderRadius: 8,
  fontSize: 14,
  fontFamily: 'inherit',
  cursor: 'pointer',
}

// Allow and Decline are the SAME control at the same level — no dark
// patterns, no click-deep refusal.
const PRIMARY_BUTTON: CSSProperties = {
  ...BUTTON_BASE,
  border: '1px solid #111',
  background: '#111',
  color: '#fff',
}

const SECONDARY_BUTTON: CSSProperties = {
  ...BUTTON_BASE,
  border: '1px solid #111',
  background: '#fff',
  color: '#111',
}

const LINK_BUTTON: CSSProperties = {
  border: 'none',
  background: 'none',
  padding: '8px 4px',
  fontSize: 14,
  fontFamily: 'inherit',
  color: 'inherit',
  textDecoration: 'underline',
  cursor: 'pointer',
}

/**
 * The persistent entry point. Deliberately quiet — a small bottom-left pill
 * — but always present and always the same, page after page.
 */
const PILL_STYLE: CSSProperties = {
  position: 'fixed',
  left: 12,
  bottom: 12,
  zIndex: 2147483390,
  boxSizing: 'border-box',
  padding: '6px 12px',
  borderRadius: 999,
  border: '1px solid rgba(0, 0, 0, 0.24)',
  background: 'rgba(255, 255, 255, 0.92)',
  color: '#333',
  fontFamily: OVERLAY_FONT,
  fontSize: 12,
  lineHeight: 1.4,
  cursor: 'pointer',
}

export interface ConsentBannerUiProps {
  hostId: string
  /** The visitor's recorded state; null means undecided. */
  stored: StoredVisitorConsent | null
  /** The resolved posture; only consulted while undecided. */
  posture: VisitorConsentPosture | null
  /** Region at decision time, recorded onto explicit choices. */
  country?: string | null
  /**
   * Simulator seam (console preview): when set, decisions are reported here
   * INSTEAD of being persisted, so previewing as-if-from-the-EU never
   * writes a real consent record. Production leaves it unset.
   */
  onDecision?: (status: VisitorConsentStatus) => void
}

export function ConsentBannerUi(props: ConsentBannerUiProps): ReactElement | null {
  const { hostId, stored, posture, country, onDecision } = props
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [analyticsChecked, setAnalyticsChecked] = useState(
    stored?.analytics === true,
  )

  // The change-your-mind paths: the window event, and a `#aglyn-consent`
  // link click anywhere in the page (capture, so canvas link handling that
  // stops propagation cannot swallow it).
  useEffect(() => {
    const open = () => {
      setAnalyticsChecked(readStoredVisitorConsent(hostId)?.analytics === true)
      setPreferencesOpen(true)
    }
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null
      const anchor = target?.closest?.('a[href]')
      if (
        anchor &&
        (anchor.getAttribute('href') ?? '').endsWith('#aglyn-consent')
      ) {
        event.preventDefault()
        open()
      }
    }
    window.addEventListener(VISITOR_CONSENT_OPEN_EVENT, open)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener(VISITOR_CONSENT_OPEN_EVENT, open)
      document.removeEventListener('click', onClick, true)
    }
  }, [hostId])

  const decide = (status: VisitorConsentStatus) => {
    if (onDecision) {
      onDecision(status)
    } else {
      storeVisitorConsent(hostId, { status, country })
    }
    setPreferencesOpen(false)
  }

  // "No" from the preferences panel means `opted-out` when the visitor was
  // defaulted in (implied posture) and `declined` when they were asked
  // first — same gate either way, distinct record.
  const refusalStatus: VisitorConsentStatus =
    stored?.status === 'implied' || posture === 'opt-out'
      ? 'opted-out'
      : 'declined'

  const askBanner = !stored && posture === 'opt-in' && !preferencesOpen

  if (preferencesOpen) {
    return (
      <section
        role="region"
        aria-label="Privacy choices"
        data-aglyn-consent-preferences=""
        style={CARD_STYLE}
      >
        <p style={{ margin: '0 0 12px' }}>
          {'Choose what this site may use. Strictly necessary features — ' +
            'like shopping carts, sign-in, and remembering this choice — ' +
            'are always on because the site cannot work without them.'}
        </p>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            margin: '0 0 12px',
          }}
        >
          <input
            type="checkbox"
            checked={analyticsChecked}
            onChange={(event) => setAnalyticsChecked(event.target.checked)}
          />
          {'Analytics (Google Analytics) — how the site is used'}
        </label>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <button
            type="button"
            style={SECONDARY_BUTTON}
            onClick={() => decide(refusalStatus)}
          >
            {'Decline all'}
          </button>
          <button
            type="button"
            style={PRIMARY_BUTTON}
            onClick={() => decide(analyticsChecked ? 'accepted' : refusalStatus)}
          >
            {'Save choices'}
          </button>
        </div>
      </section>
    )
  }

  if (askBanner) {
    return (
      <section
        role="region"
        aria-label="Privacy choices"
        data-aglyn-consent-banner=""
        style={CARD_STYLE}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <p style={{ margin: 0, flex: '1 1 260px' }}>
            {'This site would like to use analytics (Google Analytics) to ' +
              'understand how it is used. Analytics only runs if you allow ' +
              'it — everything else works either way.'}
          </p>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <button
              type="button"
              style={LINK_BUTTON}
              onClick={() => {
                setAnalyticsChecked(stored != null && stored.analytics)
                setPreferencesOpen(true)
              }}
            >
              {'Preferences'}
            </button>
            <button
              type="button"
              style={SECONDARY_BUTTON}
              onClick={() => decide('declined')}
            >
              {'Decline'}
            </button>
            <button
              type="button"
              style={PRIMARY_BUTTON}
              onClick={() => decide('accepted')}
            >
              {'Allow'}
            </button>
          </div>
        </div>
      </section>
    )
  }

  // The pill renders whenever no other surface is up — INCLUDING the
  // implied posture, where it is the only opt-out surface there is.
  return (
    <button
      type="button"
      data-aglyn-consent-pill=""
      aria-label="Privacy choices"
      style={PILL_STYLE}
      onClick={() => {
        setAnalyticsChecked(
          onDecision
            ? stored?.analytics === true
            : readStoredVisitorConsent(hostId)?.analytics === true,
        )
        setPreferencesOpen(true)
      }}
    >
      {'Privacy choices'}
    </button>
  )
}

export default ConsentBannerUi
