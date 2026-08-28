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
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import {
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  readStoredVisitorConsent,
  refusalStatusFor,
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
 * ## EVERY surface renders this component
 *
 * Published customer sites, the console — signed in and signed out — and the
 * console preview's region simulator. There were two implementations of these
 * three surfaces and they had already drifted into two different designs: a
 * plain card with bare checkboxes on one side, a MUI dialog with switches and
 * descriptions on the other. The dialog is the design that survived, and the
 * differences that were real turned out to be STRINGS — "this site" against
 * "this console", carts against signing in — which is what {@link ConsentCopy}
 * is for. A string is not a reason for a second component.
 *
 * MUI is available on both: the tenant runtime renders it through
 * `HostThemeProvider`, under the same `AppRouterCacheProvider` emotion cache
 * the console uses, and `membership-page.tsx` already draws MUI components a
 * folder away from the call site here. The unlayered-cache hazard is the
 * BESIGNER canvas, which no published page and no consent surface goes
 * through.
 *
 * Palette and type come from whichever theme is in scope, which on a customer
 * site is the site's own — the control belongs to the page it is asked on. The
 * two things that must NOT follow a theme are the §7015 mark, which is
 * transcribed artwork, and {@link CONSENT_OVERLAY_Z_INDEX}, which has to
 * outrank a popup backdrop no theme knows about.
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
/**
 * Exported so a surface that renders its own opt-out control gets the
 * REGULATOR'S artwork rather than an approximation of it. §7015(f) points at
 * published artwork, and the console's unauthenticated pages need the same
 * mark this overlay draws — a second, hand-drawn toggle would be a different
 * mark wearing the same name.
 */
export function CcpaOptOutIcon(): ReactElement {
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
/**
 * The stacking context the consent surfaces must win, and why it is a number
 * rather than a theme token.
 *
 * `theme.zIndex.modal` is 1300, and on a published site the consent card has
 * to sit above the popup backdrop at 2147483200 — the consent question
 * outranks a promotional popup, and the popup's own GA mirrors are waiting on
 * the answer. Exported so the console preview's own panel can be raised
 * against the real value instead of a copy of it.
 */
export const CONSENT_OVERLAY_Z_INDEX = 2147483400

/** The persistent control sits just below the card it can be replaced by. */
export const CONSENT_PILL_Z_INDEX = 2147483390

/** The card both the banner and the preferences panel are drawn on. */
const CARD_WIDTH = 'min(680px, calc(100vw - 24px))'

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

/**
 * The words each surface uses, so one component serves them all.
 *
 * A console says "this console" and a published site says "this site"; the
 * strictly-necessary sentence names shopping carts on a customer site and
 * signing in on the console. Those are STRINGS, and a string is not a reason
 * for a second component — which is what the two implementations this replaces
 * had become. Every field defaults to the published-site wording, so a caller
 * that has nothing to say differently passes nothing.
 */
export interface ConsentCopy {
  /** Opens the preferences panel. */
  panelIntro?: string
  /** Names what runs regardless, and why it is not being asked about. */
  strictlyNecessary?: string
  /** The ask, on a site that runs analytics only. */
  bannerAnalyticsOnly?: string
  /** The ask, on a site that also asks about advertising. */
  bannerWithAdvertising?: string
  /** The analytics control's label and the line under it. */
  analyticsLabel?: string
  analyticsDetail?: string
  /** The advertising control's, where the surface asks about it. */
  advertisingLabel?: string
  advertisingDetail?: string
}

const DEFAULT_COPY: Required<ConsentCopy> = {
  panelIntro: 'Choose what this site may use.',
  strictlyNecessary:
    'Strictly necessary features — like shopping carts, sign-in, and ' +
    'remembering this choice — are always on because the site cannot work ' +
    'without them.',
  bannerAnalyticsOnly:
    'This site would like to use analytics (Google Analytics) to understand ' +
    'how it is used. Analytics only runs if you allow it — everything else ' +
    'works either way.',
  bannerWithAdvertising:
    'This site would like to use analytics (Google Analytics) to understand ' +
    'how it is used, and advertising cookies to personalize ads and measure ' +
    'how they perform. Neither runs unless you allow it — everything else ' +
    'works either way. Use Preferences to choose them separately.',
  analyticsLabel: 'Analytics',
  analyticsDetail: 'Google Analytics — how the site is used.',
  advertisingLabel: 'Advertising',
  advertisingDetail: 'Personalized ads and measuring how they perform.',
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
   * Whether this surface asks about advertising storage. Resolved by the
   * caller — from the host document on a published site, from the platform's
   * own consent declaration on the console.
   */
  advertising?: boolean
  /** Per-surface wording; see {@link ConsentCopy}. */
  copy?: ConsentCopy
  /**
   * Links to the policies behind the choice, rendered under the copy on both
   * the banner and the panel.
   *
   * A node rather than a pair of URLs: the console links its own published
   * Privacy and Cookie policies through its route constants, and a published
   * site links whatever its owner has. A choice offered with no way to read
   * what is being chosen is not an informed one, but neither surface's links
   * are this component's to know.
   */
  policyLinks?: ReactNode
  /**
   * Whether the persistent "Your Privacy Choices" control may render here.
   *
   * `true` — the default, and every published site — draws the pill whenever
   * no other surface is up. It is the ONLY opt-out surface a visitor in the
   * implied posture ever sees, so it is platform-mounted rather than left to
   * a template that could drop it.
   *
   * `false` for a page that already carries the control somewhere better. The
   * console's signed-in pages put it in the account menu, where a person looks
   * for their own settings; floating a second copy over the page would be the
   * same control drawn twice.
   */
  showPill?: boolean
  /**
   * The caller owns what a decision DOES.
   *
   * Unset — a published site — persists through `storeVisitorConsent`, which
   * is where the withdrawal behaviour lives: it re-derives both grants from
   * the status, silences any resident tag, sweeps the analytics and
   * advertising cookies and dispatches the change event.
   *
   * Set, and the caller writes instead. The console writes through
   * `storePlatformConsent` so the record also mirrors across its hostnames;
   * the console's region simulator writes nothing at all, which is what keeps
   * previewing as-if-from-the-EU from recording a real consent record.
   */
  onDecision?: (status: VisitorConsentStatus, advertising?: boolean) => void
}

/** The card both overlays are drawn on — fixed, centred, above everything. */
const overlayCardSx = {
  position: 'fixed',
  left: '50%',
  bottom: 16,
  transform: 'translateX(-50%)',
  zIndex: CONSENT_OVERLAY_Z_INDEX,
  width: CARD_WIDTH,
  p: 2,
  borderRadius: 3,
  textAlign: 'left',
} as const

export function ConsentBannerUi(props: ConsentBannerUiProps): ReactElement | null {
  const {
    hostId,
    stored,
    posture,
    country,
    advertising,
    copy,
    policyLinks,
    showPill = true,
    onDecision,
  } = props
  const words = { ...DEFAULT_COPY, ...copy }
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

  // Same gate either way, distinct record — see `refusalStatusFor`.
  const refusalStatus = refusalStatusFor(stored, posture)

  const askBanner = !stored && posture === 'opt-in' && !preferencesOpen

  // Before the early returns below, so the hook order never depends on which
  // of the three surfaces is up. The banner and the panel are centred cards
  // that reserve nothing — only the pill parks itself on the footer.
  const pillRef = useRef<HTMLButtonElement | null>(null)
  useConsentPillClearance(pillRef, showPill && !preferencesOpen && !askBanner)

  /** One control per category, label and detail on two lines. */
  const categorySwitch = (
    label: string,
    detail: string,
    checked: boolean,
    onChange: (next: boolean) => void,
  ): ReactElement => (
    <FormControlLabel
      control={
        <Switch
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          slotProps={{ input: { 'aria-label': label } }}
        />
      }
      label={
        <Box>
          <Typography variant="body2">{label}</Typography>
          <Typography variant="caption" color="text.secondary">
            {detail}
          </Typography>
        </Box>
      }
    />
  )

  if (preferencesOpen) {
    return (
      <Dialog
        open
        onClose={() => setPreferencesOpen(false)}
        maxWidth="sm"
        fullWidth
        aria-label={CONSENT_OPT_OUT_TITLE}
        data-aglyn-consent-preferences=""
        sx={{ zIndex: CONSENT_OVERLAY_Z_INDEX }}
      >
        {/* The exact words are fixed by CCPA regs §7015 for a combined
            opt-out control — see `CONSENT_OPT_OUT_TITLE`. */}
        <DialogTitle>{CONSENT_OPT_OUT_TITLE}</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Typography variant="body2">
              {`${words.panelIntro} ${words.strictlyNecessary}`}
            </Typography>
            {categorySwitch(
              words.analyticsLabel,
              words.analyticsDetail,
              analyticsChecked,
              setAnalyticsChecked,
            )}
            {advertising
              ? categorySwitch(
                  words.advertisingLabel,
                  words.advertisingDetail,
                  adsChecked,
                  setAdsChecked,
                )
              : null}
            {policyLinks}
          </Stack>
        </DialogContent>
        <DialogActions>
          {/* Refuse and accept are the SAME control at the same level — no
              dark patterns, no click-deep refusal. */}
          <Button onClick={() => decide(refusalStatus)}>{'Decline all'}</Button>
          <Button
            variant="contained"
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
          </Button>
        </DialogActions>
      </Dialog>
    )
  }

  if (askBanner) {
    return (
      <Paper
        elevation={8}
        role="region"
        aria-label="Privacy choices"
        data-aglyn-consent-banner=""
        sx={overlayCardSx}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          sx={{ alignItems: { xs: 'stretch', sm: 'center' } }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2">
              {advertising
                ? words.bannerWithAdvertising
                : words.bannerAnalyticsOnly}
            </Typography>
            {policyLinks ? <Box sx={{ mt: 0.5 }}>{policyLinks}</Box> : null}
          </Box>
          <Stack
            direction="row"
            spacing={1}
            sx={{ flexShrink: 0, flexWrap: 'wrap' }}
          >
            <Button
              size="small"
              onClick={() => {
                setAnalyticsChecked(stored != null && stored.analytics)
                setAdsChecked(stored != null && stored.advertising === true)
                setPreferencesOpen(true)
              }}
            >
              {'Preferences'}
            </Button>
            <Button
              size="small"
              variant="outlined"
              onClick={() => decide('declined')}
            >
              {'Decline'}
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={() => decide('accepted', advertising === true)}
            >
              {advertising ? 'Allow all' : 'Allow'}
            </Button>
          </Stack>
        </Stack>
      </Paper>
    )
  }

  if (!showPill) return null

  // The pill renders whenever no other surface is up — INCLUDING the
  // implied posture, where it is the only opt-out surface there is.
  return (
    <Button
      ref={pillRef}
      type="button"
      // No ripple, and it is not cosmetic: `consent-opt-out-title.spec.tsx`
      // reads the control's LAST child to prove the §7015 title is the text
      // immediately right of the §7015 mark, and a ripple span would be the
      // last child instead.
      disableRipple
      data-aglyn-consent-pill=""
      aria-label={CONSENT_OPT_OUT_TITLE}
      variant="outlined"
      size="small"
      onClick={() => {
        const current = onDecision ? stored : readStoredVisitorConsent(hostId)
        setAnalyticsChecked(current?.analytics === true)
        setAdsChecked(current?.advertising === true)
        setPreferencesOpen(true)
      }}
      sx={{
        position: 'fixed',
        left: 12,
        bottom: 12,
        zIndex: CONSENT_PILL_Z_INDEX,
        gap: 0.75,
        flexWrap: 'wrap',
        maxWidth: 'calc(100vw - 24px)',
        borderRadius: 999,
        textTransform: 'none',
        color: 'text.secondary',
        borderColor: 'divider',
        backgroundColor: 'background.paper',
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
    </Button>
  )
}

export default ConsentBannerUi
