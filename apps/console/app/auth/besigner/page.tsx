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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { LoadingTextComponent } from '@aglyn/shared-ui-jsx/components/loading-text.component'
import { useAuth } from '@aglyn/tenant-feature-instance'
import { CircularProgress } from '@mui/material'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import AuthFormComponent from '../../../components/auth-form.component'
import {
  besignerEntryNeedsSignIn,
  besignerEntryTarget,
  markNativeAppWebView,
} from '../../../utils/besigner-entry'
import { signInWithPooledCustomToken } from '../../../utils/pooled-custom-token'

/**
 * `/auth/besigner?continue=<Besigner path>` — how the native apps open the
 * Besigner in their in-app web view (AGL-3850).
 *
 * The app has already minted the console's `__session` cookie from its own ID
 * token and put it in the web view. This page turns that cookie into the
 * web view's Firebase sign-in (the same custom-token exchange a workspace
 * subdomain uses, `GET /api/auth/session`), and only then moves on to the
 * Besigner. Going there directly let the authenticated layout see a
 * signed-out web view and send it to `/signin` first, so the app showed a web
 * sign-in page instead of the editor.
 *
 * Nothing here signs anyone in who is not already signed in to the app: the
 * cookie is the app's own session, minted under every gate a browser sign-in
 * meets. A refused exchange stops here, with the reason, instead of falling
 * through to the web sign-in page.
 */
function BesignerEntry() {
  const auth = useAuth()
  const router = useRouter()
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    markNativeAppWebView()
    const target = besignerEntryTarget(
      new URLSearchParams(window.location.search).get('continue'),
    )
    if (!target) {
      setFailed('This link does not open a page in the Besigner.')
      return
    }
    void (async () => {
      try {
        await auth.authStateReady()
        const response = await fetch('/api/auth/session', { cache: 'no-store' })
        const payload = (await response.json().catch(() => null)) as {
          token?: string
          uid?: string
          tenantId?: string | null
        } | null
        if (!active) return
        if (!response.ok || !payload?.token) {
          setFailed(
            `Your ${PLATFORM_BRAND_NAME} session did not carry over. Close the Besigner and open it again from the app.`,
          )
          return
        }
        if (besignerEntryNeedsSignIn(payload, auth.currentUser)) {
          await signInWithPooledCustomToken(auth, payload.token, payload.tenantId)
        }
        if (active) router.replace(target)
      } catch (caught) {
        console.error('[auth/besigner] the session exchange failed', caught)
        if (active) {
          setFailed(
            `${PLATFORM_BRAND_NAME} could not be reached. Check the connection, then open the Besigner again.`,
          )
        }
      }
    })()
    return () => {
      active = false
    }
  }, [auth, router])

  if (failed) {
    return (
      <AuthFormComponent
        headingTop={'The Besigner did not open'}
        headingBottom={failed}
      />
    )
  }
  return (
    <AuthFormComponent
      headingTop={'One moment'}
      headingBottom={'Opening the Besigner'}
      headingBottomProps={{ sx: { pb: 4 }, component: LoadingTextComponent }}
      headingAfter={<CircularProgress color="primary" />}
    />
  )
}

BesignerEntry.displayName = 'Page:BesignerEntry'

export default BesignerEntry
