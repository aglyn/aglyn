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
import AuthFormComponent from '../../../../components/auth-form.component'
// One declaration of the workspace apex, for the AGL-1135 reason recorded on
// the constant itself.
import { WORKSPACE_DOMAIN } from '../../../../constants/workspace-domain'
import { mintSession } from '../../../../hooks/use-session-cookie'

/**
 * `/auth/handoff/continue` — the AUTH HOST leg (AGL-1902).
 *
 * The custom domain sent the visitor to `/signin?continue=/auth/handoff/
 * continue?handoff={rid}`, so this page runs on `app.aglyn.com` immediately
 * after a normal, unchanged sign-in. It authorizes the handoff and navigates
 * to the custom domain with the return secret in the fragment.
 *
 * ## Why a page of its own rather than a hook in the sign-in page
 *
 * The sign-in page is the most-used surface in the product and every provider
 * path funnels through it. Adding a branch there would put the handoff on the
 * critical path of every sign-in in the product, including the ones that have
 * nothing to do with custom domains. Landing on a separate page after sign-in
 * costs one navigation, changes nothing for anyone else, and — the part that
 * matters — makes D5's ordering the natural shape rather than a discipline:
 * this page can AWAIT the `.aglyn.com` `__session` mint before the
 * cross-origin navigation, which is exactly the AGL-466 lesson.
 *
 * ## Where the refusals are shown
 *
 * Here, deliberately, under our own branding. "You do not have access to that
 * workspace" has to be said on an origin the person can trust, and the custom
 * domain may be the very thing that is suspended.
 */

type Phase = 'working' | 'not-a-member' | 'inactive' | 'failed'

function HandoffContinue() {
  const auth = useAuth()
  const [phase, setPhase] = useState<Phase>('working')
  const [orgSlug, setOrgSlug] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const user = auth.currentUser
    if (!user) return
    void (async () => {
      const handoff = new URLSearchParams(window.location.search).get('handoff')
      if (!handoff) {
        window.location.replace('/')
        return
      }
      // AWAITED, before anything navigates. AGL-466 is a redirect loop caused
      // by a mint that raced a `location.replace`, and this call sits in the
      // same place with the same hazard. A failed mint does NOT stop the
      // handoff: the custom domain mints its own host-only cookie anyway, and
      // this one only governs `.aglyn.com`.
      await mintSession(user, { current: null })
      try {
        const idToken = await user.getIdToken()
        const response = await fetch('/api/auth/handoff/authorize', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ handoff }),
        })
        const body = await response.json().catch(() => null)
        if (!active) return
        if (!response.ok || !body?.url) {
          setOrgSlug(typeof body?.orgSlug === 'string' ? body.orgSlug : null)
          setPhase(
            body?.reason === 'not-a-member'
              ? 'not-a-member'
              : body?.reason === 'domain-inactive'
                ? 'inactive'
                : 'failed',
          )
          return
        }
        // `location.replace`, never a server 302: a `Location` header would
        // put the return secret back into our own access logs, which is the
        // single channel the fragment exists to avoid. `replace` also leaves
        // no history entry pointing at the secret.
        window.location.replace(body.url)
      } catch {
        if (active) setPhase('failed')
      }
    })()
    return () => {
      active = false
    }
  }, [auth])

  const workspace = orgSlug
    ? `https://${orgSlug}.${WORKSPACE_DOMAIN}/`
    : `https://app.${WORKSPACE_DOMAIN}/`

  if (phase === 'not-a-member') {
    return (
      <AuthFormComponent
        headingTop={'You do not have access to that workspace'}
        headingBottom={
          'Your account is signed in, but it is not a member of the ' +
          'organization that owns this address. Ask an administrator there ' +
          'to invite you.'
        }
        headingAfter={
          <Button
            variant="contained"
            onClick={() => window.location.replace(`https://app.${WORKSPACE_DOMAIN}/`)}
          >
            {'Go to your workspaces'}
          </Button>
        }
      />
    )
  }

  if (phase === 'inactive') {
    return (
      <AuthFormComponent
        headingTop={'That address is not active right now'}
        headingBottom={
          'The custom console address for this organization is not serving ' +
          'at the moment. Your workspace address still works.'
        }
        headingAfter={
          <Button variant="contained" onClick={() => window.location.replace(workspace)}>
            {'Continue to your workspace'}
          </Button>
        }
      />
    )
  }

  if (phase === 'failed') {
    return (
      <AuthFormComponent
        headingTop={'Could not finish signing in'}
        headingBottom={
          'Something went wrong handing your sign-in to the custom address. ' +
          'Your workspace address still works.'
        }
        headingAfter={
          <Button variant="contained" onClick={() => window.location.replace(workspace)}>
            {'Continue to your workspace'}
          </Button>
        }
      />
    )
  }

  return (
    <AuthFormComponent
      headingTop={'Signing you in'}
      headingBottom={'Please wait'}
      headingBottomProps={{ sx: { pb: 4 }, component: LoadingTextComponent }}
      headingAfter={<CircularProgress color="primary" />}
    />
  )
}

HandoffContinue.displayName = 'Page:HandoffContinue'

export default HandoffContinue
