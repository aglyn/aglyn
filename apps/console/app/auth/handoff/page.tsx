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

import { LoadingTextComponent } from '@aglyn/shared-ui-jsx/components/loading-text.component'
import { Button, CircularProgress } from '@mui/material'
import { useEffect, useState } from 'react'
import { useAuth } from '@aglyn/tenant-feature-instance'
import AuthFormComponent from '../../../components/auth-form.component'
import { mintSession } from '../../../hooks/use-session-cookie'
import {
  clearDelegationBounces,
  recordDelegationBounce,
} from '../../../utils/auth-delegation'
import {
  parseHandoffFragment,
  stripHandoffFragment,
} from '../../../utils/handoff-fragment'
import { signInWithPooledCustomToken } from '../../../utils/pooled-custom-token'

/**
 * `/auth/handoff` — the landing page on a CUSTOM CONSOLE DOMAIN (AGL-1902).
 *
 * The last leg. It reads `#{rid}.{S}` out of the fragment, strips it from the
 * address bar, POSTs it same-origin — where the `HttpOnly` verifier cookie
 * rides along, which a cross-site POST could never do — and exchanges the
 * custom token it gets back.
 *
 * ## The order here is the design, not a preference
 *
 * `signInWithPooledCustomToken` before `mintSession` before navigation, each
 * AWAITED. AGL-466 is a redirect loop caused by a fire-and-forget mint racing
 * a `location.replace`, and D5 says this call sits in the same place with the
 * same hazard. `signInWithPooledCustomToken` rather than a bare
 * `signInWithCustomToken` because a custom token carries the pool it was
 * minted for and a uid is unique only WITHIN a pool — the `tenantId` the
 * redeem response hands back is assigned UNCONDITIONALLY, since `null` means
 * the project pool and not "no opinion" (AGL-1993).
 *
 * ## Failure copy is classified, per D5
 *
 * The row that is easy to get wrong is *already redeemed AND a valid session
 * exists* → say nothing and continue, because the most likely way to reach it
 * is pressing Back onto a spent URL. Turning that into a scary error would
 * manufacture a failure out of a working session.
 *
 * A single silent retry is allowed for an expired or spent handoff with no
 * session, and it goes through `recordDelegationBounce()` — the AGL-465
 * breaker, reused rather than rewritten, because the design says in as many
 * words: do not write a second one.
 */

type Phase = 'working' | 'expired' | 'no-verifier' | 'failed' | 'capped'

function HandoffLanding() {
  const auth = useAuth()
  const [phase, setPhase] = useState<Phase>('working')

  useEffect(() => {
    let active = true
    void (async () => {
      const fragment = parseHandoffFragment(window.location.hash)
      stripHandoffFragment()
      if (!fragment) {
        // No fragment at all: either a direct visit or a Back onto a URL whose
        // fragment we already stripped. If a session exists this is the D5
        // "say nothing" row; otherwise start over.
        if (auth.currentUser) {
          window.location.replace('/')
          return
        }
        if (!recordDelegationBounce()) {
          if (active) setPhase('capped')
          return
        }
        window.location.replace('/auth/handoff/start')
        return
      }

      let body:
        | {
            ok?: boolean
            token?: string
            tenantId?: string | null
            continuePath?: string
            reason?: string
          }
        | null
      try {
        const response = await fetch('/api/auth/handoff/redeem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            handoff: fragment.requestId,
            secret: fragment.secret,
          }),
        })
        body = await response.json().catch(() => null)
        if (!response.ok) {
          if (!active) return
          if (body?.reason === 'bad-verifier') {
            // The browser that finished is not the browser that started —
            // cookies cleared, a different browser, or a QR to a phone. No
            // retry can fix that, so say what would.
            setPhase('no-verifier')
            return
          }
          if (
            body?.reason === 'already-redeemed' &&
            auth.currentUser
          ) {
            // D5's load-bearing row: a spent URL plus a live session is Back,
            // not an incident.
            window.location.replace('/')
            return
          }
          if (!recordDelegationBounce()) {
            setPhase('capped')
            return
          }
          setPhase('expired')
          window.location.replace('/auth/handoff/start')
          return
        }
      } catch {
        if (active) setPhase('failed')
        return
      }

      if (!body?.token) {
        if (active) setPhase('failed')
        return
      }
      try {
        await signInWithPooledCustomToken(auth, body.token, body.tenantId)
        // AWAITED. A mint that races the navigation is AGL-466.
        await mintSession(auth.currentUser, { current: null })
      } catch {
        if (active) setPhase('failed')
        return
      }
      clearDelegationBounces()
      window.location.replace(body.continuePath || '/')
    })()
    return () => {
      active = false
    }
  }, [auth])

  if (phase === 'no-verifier') {
    return (
      <AuthFormComponent
        headingTop={'Finish signing in from the same browser'}
        headingBottom={
          'This sign-in was started in a different browser, or its cookies ' +
          'were cleared. Start again here and it will complete.'
        }
        headingAfter={
          <Button
            variant="contained"
            onClick={() => window.location.replace('/auth/handoff/start')}
          >
            {'Start again'}
          </Button>
        }
      />
    )
  }

  if (phase === 'capped' || phase === 'failed') {
    return (
      <AuthFormComponent
        headingTop={'Could not finish signing in'}
        headingBottom={
          'Something went wrong completing your sign-in on this domain. ' +
          'Try again, or sign in on your workspace address instead.'
        }
        headingAfter={
          <Button
            variant="contained"
            onClick={() => window.location.replace('/auth/handoff/start')}
          >
            {'Try again'}
          </Button>
        }
      />
    )
  }

  return (
    <>
      {/*
        `<noscript>` gets an honest message rather than a spinner that never
        moves. The redemption leg needs JavaScript by construction — a fragment
        is only readable in the browser — and the console is a React app that
        is unusable without it regardless.
      */}
      <noscript>
        {'This page needs JavaScript to finish signing you in.'}
      </noscript>
      <AuthFormComponent
        headingTop={'Signing you in'}
        headingBottom={'Please wait'}
        headingBottomProps={{
          sx: { pb: 4 },
          component: LoadingTextComponent,
        }}
        headingAfter={<CircularProgress color="primary" />}
      />
    </>
  )
}

HandoffLanding.displayName = 'Page:HandoffLanding'

export default HandoffLanding
