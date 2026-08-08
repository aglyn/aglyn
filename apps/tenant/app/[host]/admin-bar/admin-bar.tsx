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
  EDIT_MESSAGE_TYPE,
  editTokenStorageKey,
  readStoredEditToken,
  type StoredEditToken,
} from './admin-bar-shared'

/**
 * The tenant admin bar (admin edit bar, AGL-1302 follow-on) — the lazily
 * loaded chunk behind `admin-bar-stub`. Two states:
 *
 * - No token yet: a small "Edit this site" pill. Clicking it (a user
 *   gesture, so no popup blocker) opens the console's first-party
 *   `/edit-access` popup, which verifies edit access server-side and
 *   postMessages back a short-lived signed token scoped to this host.
 * - Token in hand: the token is redeemed at `/api/edit-context`, which
 *   re-verifies it server-side and resolves the screen serving the current
 *   path. Only THEN does the bar render — nothing on this page ever trusts
 *   a client-side claim of access.
 *
 * Plain DOM and inline styles throughout: this chunk must not drag MUI or
 * the theme into a surface that sits on other people's websites.
 */

export interface AdminBarProps {
  hostId: string
  consoleOrigin: string
}

interface EditContext {
  siteName?: string
  screenId: string | null
  screenName: string | null
  versionId: string | null
  editUrl: string | null
  consoleUrl: string
}

type Phase = 'idle' | 'connecting' | 'resolving' | 'ready' | 'dismissed'

const BAR_HEIGHT = 44

const barStyle: React.CSSProperties = {
  position: 'fixed',
  left: 0,
  right: 0,
  bottom: 0,
  height: BAR_HEIGHT,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '0 16px',
  background: '#111826',
  color: '#f5f7fa',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
  lineHeight: `${BAR_HEIGHT}px`,
  zIndex: 2147483000,
  boxShadow: '0 -1px 6px rgba(0,0,0,0.35)',
}

const linkStyle: React.CSSProperties = {
  color: '#8ecbff',
  textDecoration: 'none',
  fontWeight: 600,
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

export default function AdminBar({ hostId, consoleOrigin }: AdminBarProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [context, setContext] = useState<EditContext | null>(null)
  const tokenRef = useRef<StoredEditToken | null>(null)
  const pathRef = useRef<string>('')

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
          // Expired, revoked, or wrong site — drop it and fall back to the
          // connect pill rather than showing a bar that lies.
          window.sessionStorage.removeItem(editTokenStorageKey(hostId))
          tokenRef.current = null
          setPhase('idle')
          return
        }
        if (!response.ok) {
          setPhase('idle')
          return
        }
        tokenRef.current = stored
        setContext((await response.json()) as EditContext)
        setPhase('ready')
      } catch {
        setPhase('idle')
      }
    },
    [hostId],
  )

  // A still-valid token from a previous connect skips the popup entirely.
  useEffect(() => {
    const stored = readStoredEditToken(hostId)
    if (stored) void resolveContext(stored)
  }, [hostId, resolveContext])

  // The console popup delivers the token here. Origin-checked against the
  // ONE console origin this page was built with — a message from anywhere
  // else, or of any other shape, is ignored.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== consoleOrigin) return
      const data = event.data as
        | { type?: string; token?: string; expiresAtMs?: number; siteName?: string }
        | undefined
      if (data?.type !== EDIT_MESSAGE_TYPE || !data.token) return
      const stored: StoredEditToken = {
        token: data.token,
        expiresAtMs: Number(data.expiresAtMs) || Date.now(),
        siteName: data.siteName,
      }
      try {
        // sessionStorage, deliberately: gone when the tab closes, and never
        // a cookie on the tenant domain.
        window.sessionStorage.setItem(
          editTokenStorageKey(hostId),
          JSON.stringify(stored),
        )
      } catch {
        // Storage refused (private mode quirks) — the bar still works for
        // this pageview from memory.
      }
      void resolveContext(stored)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [consoleOrigin, hostId, resolveContext])

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

  if (phase === 'dismissed') return null

  if (phase !== 'ready') {
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
    <div style={barStyle} role="region" aria-label="Aglyn admin bar">
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        <strong>{context?.siteName ?? 'This site'}</strong>
        {context?.screenName ? ` · ${context.screenName}` : ''}
      </span>
      <span style={{ flex: 1 }} />
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
      <a
        style={linkStyle}
        href={context?.consoleUrl ?? consoleOrigin}
        target="_blank"
        rel="noreferrer"
      >
        Open console
      </a>
      <button
        type="button"
        onClick={() => setPhase('dismissed')}
        aria-label="Hide admin bar"
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
