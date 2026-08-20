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

// Deliberately NO 'use client' directive: inside @aglyn/aglyn the directive
// splits the bundler into a duplicate module graph, and the second
// canvas/emitter singleton renders the tenant site blank (AGL-52 — the
// lint rule that enforces this). It is also unnecessary: every importer
// (the tenant catch-all, the console preview simulator) is itself a
// 'use client' module, so this file is already inside the client graph. A
// future import from a SERVER component fails loudly at build time
// ("useState only works in a client component"), not silently.

import {
  type CSSProperties,
  type ReactElement,
  useEffect,
  useRef,
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
 * - **The "Your Privacy Choices" pill**: a small, persistent, fixed control on
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

/**
 * The title of the persistent opt-out control — **fixed by regulation, not a
 * copy choice**.
 *
 * Once a business "shares" personal information for cross-context behavioral
 * advertising, CCPA §1798.135(b) requires a clear and conspicuous opt-out
 * link, and CCPA regs §7015 permit a SINGLE combined link only when it is
 * titled with these exact words. Aglyn crossed that line when advertising
 * technology went onto aglyn.com, so the pill's previous label — "Privacy
 * choices" — stopped being compliant the moment the tag shipped.
 *
 * Capitalisation is part of the specified title. Do not sentence-case it to
 * match the rest of the overlay copy, do not shorten it to fit a narrow
 * viewport, and do not translate it away on a US-facing site: it is pinned by
 * `consent-opt-out-title.spec.tsx`, which renders the real control and reads
 * the text back.
 */
export const CONSENT_OPT_OUT_TITLE = 'Your Privacy Choices'

/**
 * The official CCPA **opt-out icon** — the other half of §7015, and the half
 * AGL-2011's title commit deliberately left undone.
 *
 * §7015(a) requires the icon *"in approximately the same size as any other
 * icons"* and §7015(c) requires it to *"be approximately the same size as
 * other icons on the business's webpage"* and to appear immediately to the
 * left of the "Your Privacy Choices" text. §7015(f) is the reason the shapes
 * below are transcribed rather than drawn: the regulation points at
 * *published artwork*, not at a description of a toggle, so an approximation
 * that reads as "close enough" is not the mark the regulation names.
 *
 * ## Provenance — read this before touching a single coordinate
 *
 * Downloaded from the California Attorney General's own icon page,
 * `oag.ca.gov/privacy/ccpa/icons-download`, by two independent routes that
 * agree byte for byte: the `ccpa-icons.zip` bundle that page offers, and the
 * standalone `privacyoptions.svg` that page displays inline. Both are
 * sha256 `86f2eb97cc1f3909c12e4512de9e267215d94ac5aaee9393d0f007f18c34e8ba`.
 * The unmodified file is committed at
 * `apps/tenant/public/_static/images/legal/ccpa-opt-out-icon.svg` — diff it
 * against the AG's copy to re-verify at any time.
 *
 * ## Why the paths are inlined here and not `<img src>`-ed
 *
 * The AGL-1810 duplicate-with-pointer pattern, for the same reason the admin
 * bar uses it: this component renders on **every published customer site**
 * and inside the console's preview simulator, and neither an extra fetch nor
 * a broken-image glyph is acceptable where a regulator's mark is supposed to
 * be. A self-hosted deployment gets the mark with no asset pipeline at all.
 * If the AG ever republishes the artwork, change the committed file AND
 * these four constants.
 *
 * ## What was changed in transcription, and what was not
 *
 * The coordinates and the two colours are verbatim. The only change is that
 * the AG file carries its fills in a `<style>` block of `.st0`–`.st3`
 * classes, and an inline `<style>` inside a shared overlay is **document-
 * global CSS**: shipping it would define `.st0`/`.st1` on every customer's
 * page and restyle any element of theirs that happens to use those names. So
 * each class is expanded to the presentation attributes it stood for —
 * `.st0`/`.st1` are `fill-rule:evenodd; clip-rule:evenodd` plus the fill,
 * `.st2`/`.st3` are the fill alone. Paint order is the file's own; the white
 * left-hand fill is painted before the blue shell that rings it.
 */
/** `.st0` — the white field behind the check, inside the shell's cut-out. */
const OPT_OUT_ICON_LEFT_FIELD_PATH =
  'M7.4,12.8h6.8l3.1-11.6H7.4C4.2,1.2,1.6,3.8,1.6,7S4.2,12.8,7.4,12.8z'
/** `.st1` — the blue toggle shell, evenodd so the left half reads through. */
const OPT_OUT_ICON_SHELL_PATH =
  'M22.6,0H7.4c-3.9,0-7,3.1-7,7s3.1,7,7,7h15.2c3.9,0,7-3.1,7-7S26.4,0,22.6,0z M1.6,7c0-3.2,2.6-5.8,5.8-5.8' +
  ' h9.9l-3.1,11.6H7.4C4.2,12.8,1.6,10.2,1.6,7z'
/** `.st2` (`id="x"`) — the white cross on the blue half. */
const OPT_OUT_ICON_CROSS_PATH =
  'M24.6,4c0.2,0.2,0.2,0.6,0,0.8l0,0L22.5,7l2.2,2.2c0.2,0.2,0.2,0.6,0,0.8c-0.2,0.2-0.6,0.2-0.8,0' +
  ' l0,0l-2.2-2.2L19.5,10c-0.2,0.2-0.6,0.2-0.8,0c-0.2-0.2-0.2-0.6,0-0.8l0,0L20.8,7l-2.2-2.2c-0.2-0.2-0.2-0.6,0-0.8' +
  ' c0.2-0.2,0.6-0.2,0.8,0l0,0l2.2,2.2L23.8,4C24,3.8,24.4,3.8,24.6,4z'
/** `.st3` (`id="y"`) — the blue check on the white half. */
const OPT_OUT_ICON_CHECK_PATH =
  'M12.7,4.1c0.2,0.2,0.3,0.6,0.1,0.8l0,0L8.6,9.8C8.5,9.9,8.4,10,8.3,10c-0.2,0.1-0.5,0.1-0.7-0.1l0,0' +
  ' L5.4,7.7c-0.2-0.2-0.2-0.6,0-0.8c0.2-0.2,0.6-0.2,0.8,0l0,0L8,8.6l3.8-4.5C12,3.9,12.4,3.9,12.7,4.1z'

/** The mark's own colours. Not themeable — see {@link CcpaOptOutIcon}. */
const OPT_OUT_ICON_BLUE = '#0066FF'
const OPT_OUT_ICON_WHITE = '#FFFFFF'

/**
 * The opt-out icon, sized for the pill.
 *
 * `aria-hidden`, because it sits beside the words it stands for: the pill
 * already announces "Your Privacy Choices" as its accessible name, and a
 * labelled icon next to identical visible text makes a screen reader say the
 * title twice. Same treatment as the admin bar's mark.
 *
 * 26 × 12 against the file's own `0 0 30 14` viewBox, so the default
 * `preserveAspectRatio` scales the drawing to the 12px height — one line of
 * the pill's 12px/1.4 text — and centres it. That is what §7015's "the same
 * size as other icons" asks for here: the pill has no other icons, so the
 * text is the scale to match.
 *
 * **The colours are the regulation's, not the theme's.** The pill's own
 * background is a fixed near-white that no tenant palette reaches, which is
 * exactly the surface this artwork was published against — so it needs no
 * light/dark variant and must not be given one.
 */
function CcpaOptOutIcon(): ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 30 14"
      width={26}
      height={12}
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0, display: 'block' }}
      data-aglyn-consent-optout-icon=""
    >
      <path
        d={OPT_OUT_ICON_LEFT_FIELD_PATH}
        fill={OPT_OUT_ICON_WHITE}
        fillRule="evenodd"
        clipRule="evenodd"
      />
      <path
        d={OPT_OUT_ICON_SHELL_PATH}
        fill={OPT_OUT_ICON_BLUE}
        fillRule="evenodd"
        clipRule="evenodd"
      />
      <path d={OPT_OUT_ICON_CROSS_PATH} fill={OPT_OUT_ICON_WHITE} />
      <path d={OPT_OUT_ICON_CHECK_PATH} fill={OPT_OUT_ICON_BLUE} />
    </svg>
  )
}

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
 *
 * `inline-flex` rather than the button default, so the §7015 icon and the
 * §7015 title share one baseline-centred row. The 6px gap keeps them read as
 * one control — the regulation wants the icon *with* the link, not near it —
 * while `flexWrap` lets the label drop under the icon in a narrow viewport
 * instead of forcing the pill wider than the screen. The clearance the pill
 * reserves at the foot of the page is MEASURED, so it absorbs both the extra
 * width and a wrapped second line without any constant here changing.
 */
const PILL_STYLE: CSSProperties = {
  position: 'fixed',
  left: 12,
  bottom: 12,
  zIndex: 2147483390,
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 6,
  maxWidth: 'calc(100vw - 24px)',
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

/** Breathing room kept between the pill and the last row it must not cover. */
const PILL_CLEARANCE = 8

/**
 * Selector for "the end of the page" — the footer landmark, however the
 * template spells it. A besigner-authored footer renders as `<footer>`;
 * `[role=contentinfo]` catches a hand-rolled one. `body` is the fallback so
 * a site with no footer at all still reserves the room.
 */
const FOOTER_SELECTOR = 'footer, [role="contentinfo"]'

/**
 * Bottom padding the end of the page needs so the fixed pill cannot land on
 * top of it (AGL-2205).
 *
 * Derived from the pill's MEASURED box rather than from `PILL_STYLE`: the
 * label wraps to two lines in a narrow viewport and in a translated locale,
 * and a clearance computed from the constants would be exactly one line
 * short in precisely the case where the copyright row is already tightest.
 *
 * Pure, and exported, because the geometry is the whole fix: a spec can pin
 * "51px of room for a 30.8px pill sitting 12px off the bottom" without a
 * layout engine, which is the half a jsdom render cannot check.
 */
export function consentPillClearance(
  viewportHeight: number,
  pillTop: number,
): number {
  if (!Number.isFinite(viewportHeight) || !Number.isFinite(pillTop)) return 0
  return Math.max(0, Math.ceil(viewportHeight - pillTop) + PILL_CLEARANCE)
}

/**
 * Reserves that room at the foot of the document while the pill is up.
 *
 * The pill is `position: fixed`, so scrolling to the end of the page parks
 * it directly on the footer's bottom row — which on every Aglyn marketing
 * page is the "© 2026 Aglyn LLC" line, the one piece of footer content that
 * is there for legal reasons. Measured on aglyn.com/pricing before this: the
 * pill occupied 12–126 × 680–711 and the copyright row 24–258 × 669–689, a
 * 102 × 9 px overlap at 1440 and the same again at 375.
 *
 * AGL-2205 proposed docking the pill above the footer instead. Measuring the
 * real footer ruled that out: it is 490px tall at 1440 and 1375px at 375,
 * against an 812px viewport — docking above it puts the pill in the middle
 * of the screen on desktop and clean off it on mobile, and the pill is the
 * ONLY opt-out surface a visitor in the implied posture ever sees, so it may
 * not scroll away. Reserving the pill's own footprint keeps it where people
 * expect it, costs nothing to anyone who never scrolls that far, and the
 * room appears INSIDE the footer's own background band rather than as a
 * strip of body colour underneath it.
 *
 * Only the DEFICIT is added: a template that already leaves enough room is
 * left exactly as it was, which is why the site's own padding is re-read
 * (with ours removed) on every pass instead of being captured once — it is
 * responsive, and a value cached at mount is wrong after the first resize.
 */
function useConsentPillClearance(
  pillRef: { current: HTMLElement | null },
  active: boolean,
): void {
  useEffect(() => {
    const pill = pillRef.current
    if (!active || !pill) return
    const doc = pill.ownerDocument
    const view = doc?.defaultView
    // `ownerDocument`, never the global `document`: the console preview
    // mounts this same component, and reserving room in the CONSOLE's
    // chrome because the preview happens to share its document would be a
    // fix applied to the wrong page.
    if (!doc || !view) return
    const target: HTMLElement | null =
      doc.querySelector<HTMLElement>(FOOTER_SELECTOR) ?? doc.body
    if (!target) return

    const previous = target.style.getPropertyValue('padding-bottom')
    const previousPriority = target.style.getPropertyPriority('padding-bottom')
    const restore = () => {
      if (previous) {
        target.style.setProperty('padding-bottom', previous, previousPriority)
      } else {
        target.style.removeProperty('padding-bottom')
      }
    }

    const apply = () => {
      // Ours off first: `getComputedStyle` would otherwise read back the
      // value this effect wrote on the previous pass and ratchet it upward.
      // Safe to do mid-measurement — the pill is fixed, so the reflow this
      // causes cannot move it.
      restore()
      const natural =
        Number.parseFloat(view.getComputedStyle(target).paddingBottom) || 0
      const needed = consentPillClearance(
        view.innerHeight,
        pill.getBoundingClientRect().top,
      )
      if (needed > natural) {
        target.style.setProperty('padding-bottom', `${needed}px`)
      }
    }

    apply()
    view.addEventListener('resize', apply)
    // The pill's own box changes without the viewport changing — a font
    // finishing loading re-wraps the label.
    const observer =
      typeof view.ResizeObserver === 'function'
        ? new view.ResizeObserver(apply)
        : undefined
    observer?.observe(pill)
    return () => {
      view.removeEventListener('resize', apply)
      observer?.disconnect()
      restore()
    }
  }, [pillRef, active])
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
   * Whether this site asks about advertising storage (AGL-1649). Resolved by
   * the caller from the host document, because this component is also
   * mounted by the console preview against a simulated host.
   *
   * `false` — the default and the state of every existing site — renders
   * exactly the single-question surface AGL-1498 shipped.
   */
  advertising?: boolean
  /**
   * Simulator seam (console preview): when set, decisions are reported here
   * INSTEAD of being persisted, so previewing as-if-from-the-EU never
   * writes a real consent record. Production leaves it unset.
   */
  onDecision?: (status: VisitorConsentStatus, advertising?: boolean) => void
}

export function ConsentBannerUi(props: ConsentBannerUiProps): ReactElement | null {
  const { hostId, stored, posture, country, advertising, onDecision } = props
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [analyticsChecked, setAnalyticsChecked] = useState(
    stored?.analytics === true,
  )
  // Starts UNTICKED unless the visitor previously said yes to this exact
  // category (AGL-1649). A pre-ticked advertising box is consent by
  // inattention, which is the thing a banner is supposed to replace.
  const [adsChecked, setAdsChecked] = useState(stored?.advertising === true)

  // The change-your-mind paths: the window event, and a `#aglyn-consent`
  // link click anywhere in the page (capture, so canvas link handling that
  // stops propagation cannot swallow it).
  useEffect(() => {
    const open = () => {
      const current = readStoredVisitorConsent(hostId)
      setAnalyticsChecked(current?.analytics === true)
      setAdsChecked(current?.advertising === true)
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

  // `ads` is only ever passed through; `storeVisitorConsent` re-derives it
  // against the status, so a refusal cannot carry a grant however this is
  // called.
  const decide = (status: VisitorConsentStatus, ads = false) => {
    const granted = advertising === true && ads
    if (onDecision) {
      onDecision(status, granted)
    } else {
      storeVisitorConsent(hostId, { status, country, advertising: granted })
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

  // Before the early returns below, so the hook order never depends on which
  // of the three surfaces is up. The banner and the panel are centred cards
  // that reserve nothing — only the pill parks itself on the footer.
  const pillRef = useRef<HTMLButtonElement | null>(null)
  useConsentPillClearance(pillRef, !preferencesOpen && !askBanner)

  if (preferencesOpen) {
    return (
      <section
        role="region"
        aria-label={CONSENT_OPT_OUT_TITLE}
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
        {advertising ? (
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
              checked={adsChecked}
              onChange={(event) => setAdsChecked(event.target.checked)}
            />
            {'Advertising — personalised ads and measuring ad performance'}
          </label>
        ) : null}
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
            onClick={() =>
              decide(
                analyticsChecked ? 'accepted' : refusalStatus,
                // Advertising cannot outlive analytics: unticking analytics
                // and leaving advertising ticked is a refusal of both, which
                // `consentModeSignals` also clamps independently.
                analyticsChecked && adsChecked,
              )
            }
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
            {advertising
              ? 'This site would like to use analytics (Google Analytics) ' +
                'to understand how it is used, and advertising cookies to ' +
                'personalise ads and measure how they perform. Neither runs ' +
                'unless you allow it — everything else works either way. ' +
                'Use Preferences to choose them separately.'
              : 'This site would like to use analytics (Google Analytics) to ' +
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
                setAdsChecked(stored != null && stored.advertising === true)
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
              onClick={() => decide('accepted', advertising === true)}
            >
              {advertising ? 'Allow all' : 'Allow'}
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
      ref={pillRef}
      type="button"
      data-aglyn-consent-pill=""
      aria-label={CONSENT_OPT_OUT_TITLE}
      style={PILL_STYLE}
      onClick={() => {
        const current = onDecision ? stored : readStoredVisitorConsent(hostId)
        setAnalyticsChecked(current?.analytics === true)
        setAdsChecked(current?.advertising === true)
        setPreferencesOpen(true)
      }}
    >
      {/*
        Icon FIRST: §7015 places the opt-out icon immediately to the left of
        the title, and this is the control the regulation is about. The
        prior-consent banner deliberately gets neither the title nor the icon
        — it is a consent solicitation that disappears once answered, so
        dressing it in the regulation's mark would advertise it as the
        persistent opt-out link it cannot be.
      */}
      <CcpaOptOutIcon />
      {CONSENT_OPT_OUT_TITLE}
    </button>
  )
}

export default ConsentBannerUi
