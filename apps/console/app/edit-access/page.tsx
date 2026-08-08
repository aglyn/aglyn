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

import { useUser } from '@aglyn/tenant-feature-instance'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useRef, useState } from 'react'

/**
 * The first-party half of the tenant admin bar's connect flow (admin edit
 * bar, AGL-1302 follow-on).
 *
 * A published site cannot see the console session — different registrable
 * domain, third-party cookies gone — so the bar opens THIS page in a popup.
 * Here the session is first-party: the page proves the visitor to
 * `/api/edit-access/token`, which verifies edit access to the named host
 * server-side and mints a short-lived signed token. The token is
 * postMessaged back to the opener, but ONLY to an origin the server listed
 * as belonging to that host — a page that opened this popup under someone
 * else's hostId is not a valid delivery address and gets nothing.
 *
 * Deliberately no auto-redirect to /signin: the popup names the problem and
 * links there instead, so a signed-out visitor is never bounced through an
 * auth flow they did not ask for by a page they may not recognize.
 */

type Phase =
  | 'loading'
  | 'signed-out'
  | 'missing-params'
  | 'denied'
  | 'bad-origin'
  | 'sent'
  | 'error'

const MESSAGE_TYPE = 'aglyn-edit-access'

function EditAccessBody() {
  const params = useSearchParams()
  const hostId = params?.get('hostId') ?? ''
  const targetOrigin = params?.get('origin') ?? ''
  const { data: user } = useUser()
  const [phase, setPhase] = useState<Phase>('loading')
  const [detail, setDetail] = useState<string | undefined>(undefined)
  // One shot per mount — auth state can re-emit without the work needing
  // to run twice.
  const startedRef = useRef(false)

  useEffect(() => {
    if (!hostId || !targetOrigin) {
      setPhase('missing-params')
      return
    }
    if (user === undefined) return // auth still resolving
    if (user === null) {
      setPhase('signed-out')
      return
    }
    if (startedRef.current) return
    startedRef.current = true
    ;(async () => {
      try {
        const idToken = await user.getIdToken()
        const response = await fetch('/api/edit-access/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ hostId }),
        })
        if (response.status === 403) {
          setPhase('denied')
          return
        }
        if (!response.ok) {
          const payload = await response.json().catch(() => null)
          setDetail(payload?.error)
          setPhase('error')
          return
        }
        const payload = (await response.json()) as {
          token: string
          expiresAtMs: number
          origins: string[]
          siteName?: string
        }
        // The server said where this token may go. The opener's origin has
        // to be on that list, or the token stays here.
        if (!payload.origins?.includes(targetOrigin)) {
          setPhase('bad-origin')
          return
        }
        window.opener?.postMessage(
          {
            type: MESSAGE_TYPE,
            token: payload.token,
            expiresAtMs: payload.expiresAtMs,
            siteName: payload.siteName,
          },
          targetOrigin,
        )
        setPhase('sent')
        window.setTimeout(() => window.close(), 1200)
      } catch {
        setPhase('error')
      }
    })()
  }, [hostId, targetOrigin, user])

  const copy: Record<Phase, { title: string; body: string }> = {
    loading: {
      title: 'Checking your access…',
      body: 'Verifying your edit access with the console.',
    },
    'signed-out': {
      title: 'Sign in first',
      body: 'You are not signed in to the console. Sign in, then use the edit shortcut on the site again.',
    },
    'missing-params': {
      title: 'Nothing to connect',
      body: 'This page only works when a site opens it. Close this window.',
    },
    denied: {
      title: 'No edit access',
      body: 'Your account cannot edit this site, so there is nothing to connect.',
    },
    'bad-origin': {
      title: 'Connection refused',
      body: 'The page that opened this window does not belong to that site.',
    },
    sent: {
      title: 'Connected',
      body: 'Edit access confirmed — you can head back to the site. This window closes itself.',
    },
    error: {
      title: 'Something went wrong',
      body: detail ?? 'Could not verify edit access. Close this window and try again.',
    },
  }
  const { title, body } = copy[phase]

  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 420,
        margin: '15vh auto 0',
        padding: '0 24px',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>{title}</h1>
      <p style={{ fontSize: 14, lineHeight: 1.5, opacity: 0.8 }}>{body}</p>
      {phase === 'signed-out' ? (
        <p style={{ marginTop: 16 }}>
          <a href="/signin" style={{ fontSize: 14 }}>
            Go to sign in
          </a>
        </p>
      ) : null}
    </main>
  )
}

export default function EditAccessPage() {
  // useSearchParams needs a Suspense boundary under the App Router.
  return (
    <Suspense fallback={null}>
      <EditAccessBody />
    </Suspense>
  )
}
