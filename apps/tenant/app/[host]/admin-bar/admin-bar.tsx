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
 * - `autoConnect` (AGL-1829): the console's same-site presence hint armed
 *   us. A HIDDEN iframe loads the console's `/edit-access?silent=1`, which
 *   re-verifies the session and this host's edit permission first-party and
 *   postMessages back the same signed token the popup sends — checked
 *   against the ONE console origin this page was built with, exactly like
 *   the popup path. No popup, no gesture needed; if the console answers
 *   "no" (or nothing, within the timeout) the bar renders NOTHING — an
 *   auto-armed bar has no business showing UI to someone it can't verify.
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
 * Plain DOM and inline styles throughout: this chunk must not drag MUI or
 * the theme into a surface that sits on other people's websites.
 */

export interface AdminBarProps {
  hostId: string
  consoleOrigin: string
  /** Armed by the presence hint, not a gesture — fail silent, never a pill. */
  autoConnect?: boolean
}

interface EditContext {
  siteName?: string
  screenId: string | null
  screenName: string | null
  versionId: string | null
  /** True when a version newer than the live pointer exists; null unknown. */
  draftChanges?: boolean | null
  editUrl: string | null
  consoleUrl: string
  screensUrl?: string | null
  inboxUrl?: string | null
  ordersUrl?: string | null
}

type Phase =
  | 'idle'
  | 'probing'
  | 'connecting'
  | 'resolving'
  | 'ready'
  | 'silent'
  | 'dismissed'

/** How long the silent probe may take before the bar gives up quietly. */
const PROBE_TIMEOUT_MS = 10_000

export const BAR_HEIGHT = 40

const barStyle: React.CSSProperties = {
  position: 'fixed',
  left: 0,
  right: 0,
  top: 0,
  height: BAR_HEIGHT,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '0 12px',
  background: '#111826',
  color: '#f5f7fa',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
  lineHeight: `${BAR_HEIGHT}px`,
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

const markStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  borderRadius: 5,
  background: 'linear-gradient(135deg, #4f7cff, #8ecbff)',
  color: '#0b1020',
  fontSize: 12,
  fontWeight: 800,
  lineHeight: '20px',
  flexShrink: 0,
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

const barButtonStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid rgba(245,247,250,0.35)',
  borderRadius: 5,
  color: '#f5f7fa',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  lineHeight: '20px',
  padding: '1px 8px',
  whiteSpace: 'nowrap',
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
  const [phase, setPhase] = useState<Phase>(autoConnect ? 'probing' : 'idle')
  const [context, setContext] = useState<EditContext | null>(null)
  const [identity, setIdentity] = useState<string | undefined>(undefined)
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
  useEffect(() => {
    if (phase !== 'ready') return undefined
    const html = document.documentElement
    const previousMargin = html.style.marginTop
    const previousScrollPadding = html.style.scrollPaddingTop
    html.style.marginTop = `${BAR_HEIGHT}px`
    html.style.scrollPaddingTop = `${BAR_HEIGHT}px`

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
          element.style.top = `${BAR_HEIGHT}px`
        })
    } catch {
      // A theme's exotic DOM must never break the page — worst case the
      // site header sits behind the bar until dismissed.
    }

    return () => {
      html.style.marginTop = previousMargin
      html.style.scrollPaddingTop = previousScrollPadding
      adjusted.forEach(({ element, previousTop }) => {
        element.style.top = previousTop
      })
    }
  }, [phase])

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
      style={barStyle}
      data-aglyn-admin-bar=""
      role="region"
      aria-label="Aglyn admin bar"
    >
      <a
        style={brandLinkStyle}
        href={context?.consoleUrl ?? consoleOrigin}
        target="_blank"
        rel="noreferrer"
        title="Open this site's console dashboard"
      >
        <span style={markStyle} aria-hidden="true">
          A
        </span>
        <strong
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 200,
          }}
        >
          {context?.siteName ?? 'This site'}
        </strong>
      </a>
      <span style={dividerStyle} aria-hidden="true" />
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: '#c3ccd9',
          minWidth: 0,
        }}
      >
        {context?.screenName ?? 'Unrouted page'}
      </span>
      {context?.draftChanges === true ? (
        <span style={draftStyle} title="This screen has a version newer than the published one">
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
      {context?.screensUrl ? (
        <a
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
          style={quietLinkStyle}
          href={context.ordersUrl}
          target="_blank"
          rel="noreferrer"
        >
          Orders
        </a>
      ) : null}
      {identity ? (
        <span style={identityStyle} title={`Connected as ${identity}`}>
          {identity}
        </span>
      ) : null}
      <button
        type="button"
        onClick={disconnect}
        style={barButtonStyle}
        title="Disconnect edit access in this browser (Cmd/Ctrl+Shift+E reconnects)"
      >
        Disconnect
      </button>
      <button
        type="button"
        onClick={() => setPhase('dismissed')}
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
    </div>
  )
}
