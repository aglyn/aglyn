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

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clearStoredEditToken,
  EDIT_MESSAGE_TYPE,
  EDIT_RESULT_MESSAGE_TYPE,
  readStoredEditToken,
  setEditOptOut,
  writeStoredEditToken,
  type StoredEditToken,
} from './admin-bar-shared'

/**
 * The tenant admin bar (admin edit bar, AGL-1302 follow-on; auto-appearance
 * and top bar AGL-1829) — the lazily loaded chunk behind `admin-bar-stub`.
 * Paths in:
 *
 * - Stored token: redeemed at `/api/edit-context`, which re-verifies it
 *   server-side and resolves the screen serving the current path. Only THEN
 *   does the bar render — nothing on this page ever trusts a client-side
 *   claim of access.
 * - `autoConnect` (AGL-1829/AGL-1842): the presence hint armed us. FIRST
 *   the bar tries the same-site EXCHANGE (AGL-1842): a POST to this site's
 *   own `/api/edit-access/exchange`, carrying the HttpOnly signed hint the
 *   login-time bounce planted on `.aglyn.app` — the server verifies it and
 *   re-authorizes this uid for THIS host with the same gate the console's
 *   token mint applies, answering with the same signed token. That is the
 *   only silent path that works on `*.aglyn.app`, where the console is
 *   cross-site. A 401 (no such cookie — the `aglyn.com`/`aglyn.io`
 *   marketing hosts, whose marker cookie has no signed sibling) falls back
 *   to the AGL-1829 probe: a HIDDEN iframe loads the console's
 *   `/edit-access?silent=1`, which re-verifies the session first-party and
 *   postMessages back the token — checked against the ONE console origin
 *   this page was built with, exactly like the popup path. A 403 is a
 *   definitive "no rights here" and renders NOTHING, as does a probe that
 *   answers "no" (or nothing, within the timeout) — an auto-armed bar has
 *   no business showing UI to someone it can't verify.
 * - Manual arm without a token: the "Edit this site" pill; clicking it (a
 *   user gesture, so no popup blocker) opens the same page as a popup.
 *
 * The ready bar is platform chrome FIXED TO THE TOP of the site: compact,
 * dark, visibly not part of the site's own design. While mounted it pushes
 * the page down by its own height (a top margin on `<html>`, plus
 * `scroll-padding-top` so anchor jumps stay visible) and nudges the site's
 * own viewport-anchored fixed/sticky headers down the same amount — a
 * besigner site header is usually a MUI AppBar at `top: 0`, which the bar
 * would otherwise cover. Everything is restored on unmount. Only editors
 * ever mount it, so the shift is theirs alone; anonymous visitors' layout
 * is untouched by construction.
 *
 * Plain DOM and inline styles throughout — this chunk must not drag MUI or
 * the theme into a surface that sits on other people's websites — plus ONE
 * `<style>` tag for what inline styles cannot express: the phone-width
 * media query (see BAR_CSS).
 */

export interface AdminBarProps {
  hostId: string
  consoleOrigin: string
  /** Armed by the presence hint, not a gesture — fail silent, never a pill. */
  autoConnect?: boolean
}

interface EditContext {
  siteName?: string
  /** The site's own favicon, resolved like the layout's icon link. */
  faviconUrl?: string | null
  screenId: string | null
  screenName: string | null
  /** Set when the page is a composed collection route (AGL-1845): the
   * collection's display name, with `collectionEntry` telling an entry
   * apart from a (paginated/filtered) list. `screenName` is then the
   * TEMPLATE screen serving the route. */
  collectionName?: string | null
  collectionEntry?: boolean
  versionId: string | null
  /** True when a version newer than the live pointer exists; null unknown. */
  draftChanges?: boolean | null
  editUrl: string | null
  consoleUrl: string
  screensUrl?: string | null
  inboxUrl?: string | null
  ordersUrl?: string | null
  /** The console's host analytics surface, server-built like every link. */
  analyticsUrl?: string | null
  /** Today's site-wide pageviews from the first-party beacon; null unknown. */
  viewsToday?: number | null
  /** Today's views of THIS screen — present only for Pro+ orgs (AGL-150). */
  screenViewsToday?: number | null
  /** The console's user-level account page (`/manage/user`) — no org slug. */
  accountUrl?: string | null
}

type Phase =
  | 'idle'
  | 'exchanging'
  | 'probing'
  | 'connecting'
  | 'resolving'
  | 'ready'
  | 'silent'
  | 'dismissed'

/** How long the silent probe may take before the bar gives up quietly. */
const PROBE_TIMEOUT_MS = 10_000

export const BAR_HEIGHT = 40

/**
 * Phone-width chrome (AGL-1829 mobile pass). Inline styles cannot carry
 * `@media`, so the width-dependent rules live in a `<style>` tag the bar
 * renders with itself — safe here because the tenant CSP sets NO
 * `style-src` (verified in `security-origins.js`: `baseCspDirectives` is
 * `object-src`/`base-uri`/`frame-ancestors` only), so no nonce is needed.
 * Below the breakpoint the row collapses to
 * [mark] [site name] [Edit] [⋯ menu] [×]: everything else moves into the
 * ⋯ menu, the bar grows to 44px, and every control gets a ≥40px touch
 * target. `!important` on the show/hide rules is deliberate — they must
 * beat the elements' own inline styles, which is the specificity these
 * rules exist to override.
 *
 * The page-offset mechanism does NOT hardcode either height twice: the
 * effect below MEASURES the mounted bar (falling back to BAR_HEIGHT) and
 * re-applies on window resize, so whatever height the media query renders
 * is the height the page is pushed down by.
 */
export const BAR_HEIGHT_MOBILE = 44
export const MOBILE_BREAKPOINT = 640

const BAR_CSS = `
.aglyn-admin-bar{height:${BAR_HEIGHT}px;gap:12px;padding:0 12px;}
.aglyn-admin-bar .aglyn-ab-site{overflow:hidden;text-overflow:ellipsis;max-width:200px;}
.aglyn-admin-bar a:hover{color:#fff;}
.aglyn-admin-bar .aglyn-ab-user:hover,.aglyn-admin-bar .aglyn-ab-icon-btn:hover{background:rgba(255,255,255,0.1);}
.aglyn-admin-bar .aglyn-ab-menu a:hover,.aglyn-admin-bar .aglyn-ab-menu button:hover{background:rgba(255,255,255,0.08);color:#f5f7fa;}
.aglyn-admin-bar a:focus-visible,.aglyn-admin-bar button:focus-visible{outline:2px solid #8ecbff;outline-offset:1px;border-radius:4px;}
.aglyn-ab-mobile{display:none !important;}
@media (max-width:${MOBILE_BREAKPOINT - 1}px){
  .aglyn-admin-bar{height:${BAR_HEIGHT_MOBILE}px;gap:8px;padding:0 8px;}
  .aglyn-admin-bar .aglyn-ab-desktop{display:none !important;}
  .aglyn-ab-mobile{display:inline-flex !important;}
  .aglyn-admin-bar .aglyn-ab-site{max-width:32vw;}
  .aglyn-admin-bar a,.aglyn-admin-bar button{min-height:40px;display:inline-flex;align-items:center;}
  .aglyn-admin-bar .aglyn-ab-icon-btn{min-width:40px;justify-content:center;}
}
`

const barStyle: React.CSSProperties = {
  position: 'fixed',
  left: 0,
  right: 0,
  top: 0,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  background: '#111826',
  color: '#f5f7fa',
  fontFamily: 'system-ui, sans-serif',
  // 12px platform-chrome type throughout the bar; the dropdowns bump it
  // for their taller touch rows.
  fontSize: 12,
  zIndex: 2147483000,
  boxShadow: '0 1px 6px rgba(0,0,0,0.35)',
}

const linkStyle: React.CSSProperties = {
  color: '#8ecbff',
  textDecoration: 'none',
  fontWeight: 600,
  whiteSpace: 'nowrap',
}

const quietLinkStyle: React.CSSProperties = {
  color: '#c3ccd9',
  textDecoration: 'none',
  fontWeight: 500,
  whiteSpace: 'nowrap',
}

const brandLinkStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  color: '#f5f7fa',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
  minWidth: 0,
}

/**
 * The Aglyn logo mark (AGL-1829 branding pass): the compass + bounding-box
 * paths, deliberately DUPLICATED from the canonical `AglynLogoMark` in
 * `libs/shared/ui/jsx/src/lib/const/svg-icons.tsx` (same path data as
 * `apps/tenant/public/_static/images/brand/aglyn-logo-mark-multi.svg`) —
 * the AGL-1810 duplicate-with-pointer pattern. Inline rather than imported
 * because the shared component is `styled(SvgIcon)`: importing it would drag
 * MUI and the theme into a lazy chunk that must stay lean on other people's
 * websites, and an `<img>` would add a fetch this bar has none of. Fills are
 * the brand "multi" colors (compass pink, bounding-box blue), which read on
 * the dark bar. If the mark ever changes, change it there AND here.
 */
const MARK_COMPASS_PATH =
  'M5,16.202l-0.267,0.183l-1.733,0.152l-0,1.46l-1,-0l-0,4l4,-0l0,-1l7.171,-0l-0.148,-0.263l-0,-1.737l-7.023,-0l0,-1l-1,-0l0,-1.795Zm14,-7.234l0,9.029l-0.004,-0l0,2.737l-0.714,1.263l3.718,-0l0,-4l-1,-0l0,-10.273c-0.37,-0 -0.836,-0 -0.836,-0.001c-0.307,0.47 -0.697,0.894 -1.164,1.245Zm-16,0.145l2,-1.376l0,-1.74l1,-0l0,-1l4.748,-0l0.279,-0.193c0.025,-0.623 0.167,-1.237 0.416,-1.807l-5.443,-0l0,-1l-4,-0l-0,4l1,-0l-0,3.116Zm19,-7.116l-2.029,-0c0.067,0.088 0.131,0.179 0.192,0.273l1.281,-0l0.556,0.556l0,-0.829Z'
const MARK_BOUNDING_BOX_PATH =
  'M15,9.997c0.323,0.073 0.661,0.112 1.01,0.112c0.348,-0 0.687,-0.039 1.009,-0.112l0,10.217l-1.009,1.783l-1.01,-1.783l0,-10.217Zm-1.898,-4.221c-0.345,-1.28 0.196,-2.683 1.398,-3.377c1.434,-0.828 3.27,-0.336 4.098,1.098c0.139,0.241 0.241,0.493 0.307,0.75l1.72,-0l0.375,0.375l-0,0.75l-0.375,0.375l-1.721,-0c-0.194,0.752 -0.679,1.429 -1.404,1.848c-1.052,0.607 -2.319,0.504 -3.247,-0.159l-3.458,2.379l-0.252,1.364l-3.296,2.267l-1.363,-0.252l-1.843,1.267l-2.041,0.179l0.897,-1.842l1.826,-1.257c0,0 0.257,-1.39 0.257,-1.39l3.296,-2.268l1.39,0.257l3.436,-2.364Zm3.398,0.087c-0.478,0.276 -1.09,0.112 -1.366,-0.366c-0.276,-0.478 -0.112,-1.09 0.366,-1.366c0.478,-0.276 1.09,-0.112 1.366,0.366c0.276,0.478 0.112,1.09 -0.366,1.366Z'

function AglynMark() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={20}
      height={20}
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0, display: 'block' }}
      data-aglyn-mark=""
    >
      <path d={MARK_COMPASS_PATH} fill="#e040fb" fillRule="evenodd" />
      <path d={MARK_BOUNDING_BOX_PATH} fill="#00b0ff" fillRule="evenodd" />
    </svg>
  )
}

const dividerStyle: React.CSSProperties = {
  width: 1,
  height: 18,
  background: 'rgba(245,247,250,0.25)',
  flexShrink: 0,
}

const draftStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  color: '#ffc766',
  fontWeight: 600,
  whiteSpace: 'nowrap',
}

const identityStyle: React.CSSProperties = {
  color: '#8b94a3',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: 180,
}

/**
 * The connected-as identity as a USER MENU trigger (AGL-1829 follow-on):
 * avatar initial + email + caret, opening the account dropdown. Quiet grey
 * like the old identity span so it still reads as identity first; the
 * hover/focus background (BAR_CSS) is what says "button".
 */
const userButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  background: 'none',
  border: 'none',
  borderRadius: 6,
  color: '#c3ccd9',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 12,
  padding: '3px 6px',
  whiteSpace: 'nowrap',
}

const avatarStyle: React.CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: '50%',
  background: '#46536a',
  color: '#f5f7fa',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  flexShrink: 0,
}

/** The phone-width ⋯ dropdown: dark like the bar, every row ≥40px tall. */
const menuStyle: React.CSSProperties = {
  position: 'fixed',
  right: 8,
  minWidth: 220,
  display: 'flex',
  flexDirection: 'column',
  padding: 6,
  borderRadius: 8,
  background: '#111826',
  color: '#f5f7fa',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 14,
  boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
  zIndex: 2147483000,
}

const menuItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  minHeight: 40,
  padding: '0 12px',
  borderRadius: 6,
  color: '#f5f7fa',
  textDecoration: 'none',
  fontWeight: 500,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 14,
  textAlign: 'left',
}

const pillStyle: React.CSSProperties = {
  position: 'fixed',
  right: 16,
  bottom: 16,
  padding: '8px 14px',
  borderRadius: 999,
  border: 'none',
  background: '#111826',
  color: '#f5f7fa',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  zIndex: 2147483000,
  boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
}

/**
 * Site headers the bar must not cover: viewport-anchored (`top` ≈ 0)
 * fixed/sticky elements. Besigner sites are MUI trees, so the AppBar
 * position classes are the reliable signal; plain `header`/`nav`/banner
 * cover hand-rolled themes. Scoped to a query, not a full DOM sweep —
 * and only editors ever run it, once per mount.
 */
const HEADER_CANDIDATE_SELECTOR =
  'header, nav, [role="banner"], .MuiAppBar-positionFixed, .MuiAppBar-positionSticky'

export default function AdminBar({
  hostId,
  consoleOrigin,
  autoConnect = false,
}: AdminBarProps) {
  const [phase, setPhase] = useState<Phase>(autoConnect ? 'exchanging' : 'idle')
  const [context, setContext] = useState<EditContext | null>(null)
  const [identity, setIdentity] = useState<string | undefined>(undefined)
  // The phone-width ⋯ menu (AGL-1829 mobile pass). Unmounted while closed,
  // so desktop assertions and screen readers never meet duplicate links.
  const [menuOpen, setMenuOpen] = useState(false)
  // The desktop user menu (AGL-1829 follow-on): account settings, the host
  // dashboard and Disconnect behind the connected-as identity. Below the
  // phone breakpoint this trigger hides and the ⋯ menu carries the same
  // rows instead — two dropdowns competing for a 44px bar is chrome noise.
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userButtonRef = useRef<HTMLButtonElement | null>(null)
  const moreButtonRef = useRef<HTMLButtonElement | null>(null)
  const barRef = useRef<HTMLDivElement | null>(null)
  const tokenRef = useRef<StoredEditToken | null>(null)
  const pathRef = useRef<string>('')
  // What a failed/expired token falls back to: silence when auto-armed, the
  // pill when the editor asked for the bar themselves.
  const restingPhase = autoConnect ? 'silent' : 'idle'

  const resolveContext = useCallback(
    async (stored: StoredEditToken) => {
      setPhase('resolving')
      pathRef.current = window.location.pathname
      try {
        const response = await fetch('/api/edit-context', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: stored.token,
            path: window.location.pathname,
          }),
        })
        if (response.status === 401 || response.status === 403) {
          // Expired, revoked, or wrong site — drop it and fall back rather
          // than showing a bar that lies.
          clearStoredEditToken(hostId)
          tokenRef.current = null
          setPhase(restingPhase)
          return
        }
        if (!response.ok) {
          setPhase(restingPhase)
          return
        }
        tokenRef.current = stored
        setIdentity(stored.userEmail)
        setContext((await response.json()) as EditContext)
        setPhase('ready')
      } catch {
        setPhase(restingPhase)
      }
    },
    [hostId, restingPhase],
  )

  // A still-valid token from a previous connect skips both the popup and
  // the probe entirely.
  useEffect(() => {
    const stored = readStoredEditToken(hostId)
    if (stored) void resolveContext(stored)
  }, [hostId, resolveContext])

  // The same-site hint exchange (AGL-1842) — the auto path's first move.
  // One POST to this site's OWN server; the HttpOnly hint cookie rides it
  // automatically, so there is nothing for scripts to read or leak. Where
  // it lands decides everything:
  //   200 → the same stored-token flow as the popup/probe deliveries;
  //   403 → a definitive no (known caller, no rights on this host, or a
  //         disabled/removed account) — silence, no probe;
  //   anything else (401 no cookie, 404 rollout skew, 5xx, network) → the
  //         AGL-1829 iframe probe, which is the still-working path on the
  //         same-site `aglyn.com`/`aglyn.io` marketing hosts.
  useEffect(() => {
    if (phase !== 'exchanging') return undefined
    // A stored token is already being resolved by the effect above — the
    // exchange would only race it for the same outcome.
    if (readStoredEditToken(hostId)) return undefined
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch('/api/edit-access/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostId }),
        })
        if (cancelled) return
        if (response.ok) {
          const payload = (await response.json()) as {
            token?: string
            expiresAtMs?: number
            siteName?: string
            userEmail?: string
          }
          if (payload?.token) {
            const stored: StoredEditToken = {
              token: payload.token,
              expiresAtMs: Number(payload.expiresAtMs) || Date.now(),
              siteName: payload.siteName,
              userEmail: payload.userEmail,
            }
            writeStoredEditToken(hostId, stored)
            void resolveContext(stored)
            return
          }
          setPhase('probing')
          return
        }
        setPhase(response.status === 403 ? 'silent' : 'probing')
      } catch {
        if (!cancelled) setPhase('probing')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [phase, hostId, resolveContext])

  // The console's /edit-access page (popup or silent iframe) delivers the
  // token here. Origin-checked against the ONE console origin this page was
  // built with — a message from anywhere else, or of any other shape, is
  // ignored. The silent probe's failure notice rides the same check.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== consoleOrigin) return
      const data = event.data as
        | {
            type?: string
            token?: string
            expiresAtMs?: number
            siteName?: string
            userEmail?: string
            ok?: boolean
          }
        | undefined
      if (data?.type === EDIT_RESULT_MESSAGE_TYPE && data.ok === false) {
        // The probe's explicit "no" — tear down without waiting out the
        // timeout. Only meaningful mid-probe; any later "no" is stale.
        setPhase((current) => (current === 'probing' ? 'silent' : current))
        return
      }
      if (data?.type !== EDIT_MESSAGE_TYPE || !data.token) return
      const stored: StoredEditToken = {
        token: data.token,
        expiresAtMs: Number(data.expiresAtMs) || Date.now(),
        siteName: data.siteName,
        userEmail: data.userEmail,
      }
      writeStoredEditToken(hostId, stored)
      void resolveContext(stored)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [consoleOrigin, hostId, resolveContext])

  // The probe must never hang the bar in limbo: no answer within the
  // timeout (console down, iframe blocked, endless spinner) means silence.
  useEffect(() => {
    if (phase !== 'probing') return undefined
    const timeout = window.setTimeout(
      () =>
        setPhase((current) => (current === 'probing' ? 'silent' : current)),
      PROBE_TIMEOUT_MS,
    )
    return () => window.clearTimeout(timeout)
  }, [phase])

  // Soft SPA navigation tracking: the bar re-resolves when the path under it
  // changes. A 2s poll is deliberate — cheap, and only editors ever run it.
  useEffect(() => {
    if (phase !== 'ready') return undefined
    const interval = window.setInterval(() => {
      if (
        tokenRef.current &&
        window.location.pathname !== pathRef.current
      ) {
        void resolveContext(tokenRef.current)
      }
    }, 2000)
    return () => window.clearInterval(interval)
  }, [phase, resolveContext])

  // Make room: while the bar is up, push the page (and the site's own
  // top-anchored fixed/sticky headers) down by the bar's height, and give
  // anchor scrolls the same allowance. Everything restored on the way out.
  // Editors only, by construction — this never runs on an anonymous view.
  //
  // The height is MEASURED from the mounted bar, not read from a constant:
  // the stylesheet renders 40px on desktop and 44px below the breakpoint
  // (AGL-1829 mobile pass), and whichever the media query picks — including
  // across a live window resize — is what the page must be offset by.
  // `BAR_HEIGHT` is only the fallback for a bar that reports no geometry
  // (jsdom, display:none edge cases).
  useEffect(() => {
    if (phase !== 'ready') return undefined
    const html = document.documentElement
    const previousMargin = html.style.marginTop
    const previousScrollPadding = html.style.scrollPaddingTop

    const adjusted: Array<{ element: HTMLElement; previousTop: string }> = []
    try {
      document
        .querySelectorAll<HTMLElement>(HEADER_CANDIDATE_SELECTOR)
        .forEach((element) => {
          if (element.closest('[data-aglyn-admin-bar]')) return
          const computed = window.getComputedStyle(element)
          const isPinned =
            computed.position === 'fixed' || computed.position === 'sticky'
          // `top: 0` (give or take a subpixel) means viewport-anchored where
          // the bar now sits; anything else is not under the bar.
          if (!isPinned || Math.abs(parseFloat(computed.top)) > 1) return
          adjusted.push({ element, previousTop: element.style.top })
        })
    } catch {
      // A theme's exotic DOM must never break the page — worst case the
      // site header sits behind the bar until dismissed.
    }

    const apply = () => {
      const height = barRef.current?.offsetHeight || BAR_HEIGHT
      html.style.marginTop = `${height}px`
      html.style.scrollPaddingTop = `${height}px`
      adjusted.forEach(({ element }) => {
        element.style.top = `${height}px`
      })
    }
    apply()
    window.addEventListener('resize', apply)

    return () => {
      window.removeEventListener('resize', apply)
      html.style.marginTop = previousMargin
      html.style.scrollPaddingTop = previousScrollPadding
      adjusted.forEach(({ element, previousTop }) => {
        element.style.top = previousTop
      })
    }
  }, [phase])

  // Menu dismissal (AGL-1829 follow-on): Escape closes an open dropdown
  // and returns focus to its trigger — a menu that strands keyboard focus
  // is a trap on someone else's website — and a pointer press anywhere
  // outside the bar closes them too. Listeners exist only while a menu is
  // open; the closed bar adds nothing to the page.
  useEffect(() => {
    if (!menuOpen && !userMenuOpen) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (userMenuOpen) userButtonRef.current?.focus()
      else moreButtonRef.current?.focus()
      setMenuOpen(false)
      setUserMenuOpen(false)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (barRef.current?.contains(event.target as Node)) return
      setMenuOpen(false)
      setUserMenuOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [menuOpen, userMenuOpen])

  const connect = useCallback(() => {
    setPhase('connecting')
    const url =
      `${consoleOrigin}/edit-access?hostId=${encodeURIComponent(hostId)}` +
      `&origin=${encodeURIComponent(window.location.origin)}`
    const popup = window.open(
      url,
      'aglyn-edit-access',
      'popup,width=480,height=560',
    )
    if (!popup) setPhase('idle')
  }, [consoleOrigin, hostId])

  // Disconnect is durable (AGL-1829): token gone from storage AND the
  // auto-arm suppressed on this host, so the bar doesn't reappear on the
  // next pageview. The chord or ?aglyn-edit reverses it explicitly.
  const disconnect = useCallback(() => {
    clearStoredEditToken(hostId)
    setEditOptOut(hostId)
    tokenRef.current = null
    setPhase('dismissed')
  }, [hostId])

  // The compact stat cluster (AGL-1829 follow-on): today's first-party
  // pageviews, straight off the edit-context payload — no client reads.
  // null means "no verdict" (the read failed server-side), and the cluster
  // then collapses to a plain Analytics link rather than inventing a zero;
  // the per-screen figure appears only when the server sent one (Pro+).
  const statsLabel =
    context?.viewsToday != null
      ? `${context.viewsToday.toLocaleString()} view${
          context.viewsToday === 1 ? '' : 's'
        } today${
          context.screenViewsToday != null
            ? ` · ${context.screenViewsToday.toLocaleString()} on this page`
            : ''
        }`
      : null

  if (phase === 'dismissed' || phase === 'silent') return null

  if (phase === 'probing') {
    // The silent handshake: nothing visible, just the same-site iframe in
    // which the console session is first-party. Its answer (or the timeout)
    // decides whether anything ever renders.
    const probeUrl =
      `${consoleOrigin}/edit-access?hostId=${encodeURIComponent(hostId)}` +
      `&origin=${encodeURIComponent(window.location.origin)}&silent=1`
    return (
      <iframe
        src={probeUrl}
        title="Aglyn edit access check"
        aria-hidden="true"
        tabIndex={-1}
        style={{ display: 'none' }}
      />
    )
  }

  if (phase !== 'ready') {
    // Auto-armed, nothing proven yet (resolving the probed token): stay
    // invisible — the pill is the MANUAL path's affordance only.
    if (autoConnect) return null
    return (
      <button
        type="button"
        style={pillStyle}
        onClick={connect}
        disabled={phase === 'resolving'}
        aria-label="Connect edit access for this site"
      >
        {phase === 'connecting'
          ? 'Waiting for the console…'
          : phase === 'resolving'
            ? 'Checking access…'
            : 'Edit this site'}
      </button>
    )
  }

  return (
    <div
      ref={barRef}
      className="aglyn-admin-bar"
      style={barStyle}
      data-aglyn-admin-bar=""
      role="region"
      aria-label="Aglyn admin bar"
    >
      <style>{BAR_CSS}</style>
      <a
        style={brandLinkStyle}
        href={context?.consoleUrl ?? consoleOrigin}
        target="_blank"
        rel="noreferrer"
        title="Open this site's console dashboard"
      >
        <AglynMark />
        {/* Two identities, platform then site (AGL-1829 follow-on): the
            Aglyn mark stays leftmost as platform chrome; the site's own
            favicon sits with the site's name. Absent or broken, it simply
            does not render — never a broken-image glyph on someone's
            website. */}
        {context?.faviconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a plain
          // <img> is deliberate: this chunk is plain-DOM by design (no MUI,
          // no Next image loader on other people's websites), and a 16px
          // favicon has nothing for the optimizer to earn.
          <img
            src={context.faviconUrl}
            alt=""
            width={16}
            height={16}
            data-aglyn-site-favicon=""
            style={{ flexShrink: 0, display: 'block', borderRadius: 3 }}
            onError={(event) => {
              event.currentTarget.style.display = 'none'
            }}
          />
        ) : null}
        <strong className="aglyn-ab-site">
          {context?.siteName ?? 'This site'}
        </strong>
      </a>
      <span className="aglyn-ab-desktop" style={dividerStyle} aria-hidden="true" />
      <span
        className="aglyn-ab-desktop"
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: '#c3ccd9',
          minWidth: 0,
        }}
        title={
          context?.collectionName
            ? `A ${context.collectionName} ${
                context.collectionEntry ? 'entry' : 'list page'
              } rendered by the "${context.screenName ?? 'template'}" screen`
            : undefined
        }
      >
        {context?.collectionName
          ? // A composed collection route (AGL-1845): name the collection
            // context, then the template screen serving it.
            `${context.collectionName}${
              context.collectionEntry ? ' entry' : ''
            } · ${context.screenName ?? 'Template'}`
          : (context?.screenName ?? 'Unrouted page')}
      </span>
      {context?.draftChanges === true ? (
        <span
          className="aglyn-ab-desktop"
          style={draftStyle}
          title="This screen has a version newer than the published one"
        >
          <span
            aria-hidden="true"
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: '#ffc766',
              display: 'inline-block',
            }}
          />
          Draft changes
        </span>
      ) : null}
      {context?.editUrl ? (
        <a
          style={linkStyle}
          href={context.editUrl}
          target="_blank"
          rel="noreferrer"
        >
          Edit this page
        </a>
      ) : null}
      <span style={{ flex: 1, minWidth: 12 }} />
      {context?.analyticsUrl ? (
        <a
          className="aglyn-ab-desktop"
          style={quietLinkStyle}
          href={context.analyticsUrl}
          target="_blank"
          rel="noreferrer"
          title="Open this site's analytics"
          data-aglyn-stats=""
        >
          {statsLabel ?? 'Analytics'}
        </a>
      ) : statsLabel ? (
        <span
          className="aglyn-ab-desktop"
          style={{ ...quietLinkStyle, cursor: 'default' }}
          data-aglyn-stats=""
        >
          {statsLabel}
        </span>
      ) : null}
      {context?.screensUrl ? (
        <a
          className="aglyn-ab-desktop"
          style={quietLinkStyle}
          href={context.screensUrl}
          target="_blank"
          rel="noreferrer"
        >
          Screens
        </a>
      ) : null}
      {context?.inboxUrl ? (
        <a
          className="aglyn-ab-desktop"
          style={quietLinkStyle}
          href={context.inboxUrl}
          target="_blank"
          rel="noreferrer"
        >
          Inbox
        </a>
      ) : null}
      {context?.ordersUrl ? (
        <a
          className="aglyn-ab-desktop"
          style={quietLinkStyle}
          href={context.ordersUrl}
          target="_blank"
          rel="noreferrer"
        >
          Orders
        </a>
      ) : null}
      <button
        ref={userButtonRef}
        type="button"
        onClick={() => {
          setUserMenuOpen((open) => !open)
          setMenuOpen(false)
        }}
        className="aglyn-ab-desktop aglyn-ab-user"
        style={userButtonStyle}
        aria-haspopup="menu"
        aria-expanded={userMenuOpen}
        aria-label={
          identity ? `Account menu — connected as ${identity}` : 'Account menu'
        }
        title={identity ? `Connected as ${identity}` : undefined}
        data-aglyn-user-menu=""
      >
        <span aria-hidden="true" style={avatarStyle}>
          {identity?.[0] ?? '•'}
        </span>
        <span style={{ ...identityStyle, maxWidth: 160 }}>
          {identity ?? 'Account'}
        </span>
        <span aria-hidden="true" style={{ fontSize: 8, color: '#8b94a3' }}>
          ▼
        </span>
      </button>
      <button
        ref={moreButtonRef}
        type="button"
        onClick={() => {
          setMenuOpen((open) => !open)
          setUserMenuOpen(false)
        }}
        className="aglyn-ab-mobile aglyn-ab-icon-btn"
        aria-label="More admin bar options"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        style={{
          background: 'none',
          border: 'none',
          color: '#f5f7fa',
          cursor: 'pointer',
          fontSize: 18,
          fontWeight: 700,
          padding: '0 4px',
          letterSpacing: 1,
        }}
      >
        ⋯
      </button>
      <button
        type="button"
        onClick={() => setPhase('dismissed')}
        className="aglyn-ab-icon-btn"
        aria-label="Hide admin bar"
        title="Hide until the next page view"
        style={{
          background: 'none',
          border: 'none',
          color: '#f5f7fa',
          cursor: 'pointer',
          fontSize: 16,
          padding: '0 4px',
        }}
      >
        ×
      </button>
      {userMenuOpen ? (
        <div
          className="aglyn-ab-desktop aglyn-ab-menu"
          role="menu"
          aria-label="Account menu"
          style={{
            ...menuStyle,
            fontSize: 13,
            // Sits just under the bar at whatever height it rendered —
            // measured, like the page offset, never assumed.
            top: (barRef.current?.offsetHeight || BAR_HEIGHT) + 4,
          }}
        >
          {identity ? (
            <span
              style={{
                ...menuItemStyle,
                color: '#8b94a3',
                cursor: 'default',
                fontSize: 12,
              }}
              title={`Connected as ${identity}`}
            >
              {identity}
            </span>
          ) : null}
          {context?.accountUrl ? (
            <a
              role="menuitem"
              style={{ ...menuItemStyle, fontSize: 13 }}
              href={context.accountUrl}
              target="_blank"
              rel="noreferrer"
              onClick={() => setUserMenuOpen(false)}
            >
              Account settings
            </a>
          ) : null}
          <a
            role="menuitem"
            style={{ ...menuItemStyle, fontSize: 13 }}
            href={context?.consoleUrl ?? consoleOrigin}
            target="_blank"
            rel="noreferrer"
            onClick={() => setUserMenuOpen(false)}
          >
            Site dashboard
          </a>
          <button
            type="button"
            role="menuitem"
            onClick={disconnect}
            style={{ ...menuItemStyle, fontSize: 13 }}
            title="Disconnect edit access in this browser (Cmd/Ctrl+Shift+E reconnects)"
          >
            Disconnect
          </button>
        </div>
      ) : null}
      {menuOpen ? (
        <div
          className="aglyn-ab-mobile aglyn-ab-menu"
          role="menu"
          aria-label="Admin bar menu"
          style={{
            ...menuStyle,
            // Sits just under the bar at whatever height it rendered —
            // measured, like the page offset, never assumed.
            top: (barRef.current?.offsetHeight || BAR_HEIGHT) + 4,
          }}
        >
          {context?.screensUrl ? (
            <a
              role="menuitem"
              style={menuItemStyle}
              href={context.screensUrl}
              target="_blank"
              rel="noreferrer"
              onClick={() => setMenuOpen(false)}
            >
              Screens
            </a>
          ) : null}
          {context?.inboxUrl ? (
            <a
              role="menuitem"
              style={menuItemStyle}
              href={context.inboxUrl}
              target="_blank"
              rel="noreferrer"
              onClick={() => setMenuOpen(false)}
            >
              Inbox
            </a>
          ) : null}
          {context?.ordersUrl ? (
            <a
              role="menuitem"
              style={menuItemStyle}
              href={context.ordersUrl}
              target="_blank"
              rel="noreferrer"
              onClick={() => setMenuOpen(false)}
            >
              Orders
            </a>
          ) : null}
          {context?.analyticsUrl ? (
            <a
              role="menuitem"
              style={menuItemStyle}
              href={context.analyticsUrl}
              target="_blank"
              rel="noreferrer"
              title={statsLabel ?? undefined}
              onClick={() => setMenuOpen(false)}
            >
              {statsLabel ? `Analytics · ${statsLabel}` : 'Analytics'}
            </a>
          ) : null}
          {identity ? (
            context?.accountUrl ? (
              <a
                role="menuitem"
                style={{ ...menuItemStyle, color: '#8b94a3' }}
                href={context.accountUrl}
                target="_blank"
                rel="noreferrer"
                title={`Connected as ${identity} — open your account settings`}
                onClick={() => setMenuOpen(false)}
              >
                {identity}
              </a>
            ) : (
              <span
                style={{ ...menuItemStyle, color: '#8b94a3', cursor: 'default' }}
                title={`Connected as ${identity}`}
              >
                {identity}
              </span>
            )
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={disconnect}
            style={menuItemStyle}
            title="Disconnect edit access in this browser (Cmd/Ctrl+Shift+E reconnects)"
          >
            Disconnect
          </button>
        </div>
      ) : null}
    </div>
  )
}
