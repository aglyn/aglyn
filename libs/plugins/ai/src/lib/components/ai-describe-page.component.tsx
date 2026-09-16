'use client'

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

import type { ConsoleHostScreensZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Button } from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { AiPageBriefDialog } from './ai-page-brief-dialog.component'

/**
 * "Describe it" (AGL-2907): a page from a brief, beside Templates and Create
 * New Screen on a site's Screens page, mounted through the `hostScreens`
 * zone. The Assist panel's AI jobs opens the same dialog.
 */

type Verdict = 'checking' | 'ready' | 'hidden'

/**
 * Renders nothing until the jobs route has answered for this workspace: the
 * shell decided the plan and the member's permission before mounting it, and
 * the release flag is the route's to decide, so a 404 or a 403 there is this
 * control staying absent.
 */
export function AiDescribePageButton({ hostId, orgId }: ConsoleHostScreensZoneProps) {
  const { data: user } = useUser()
  // Held in a ref so the probe keys on WHO is signed in, never on the
  // identity of the object that says so.
  const userRef = useRef(user)
  userRef.current = user
  const uid = user?.uid ?? null
  const [verdict, setVerdict] = useState<Verdict>('checking')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!orgId || !uid) return
    let active = true
    void (async () => {
      try {
        const response = await authorizedFetch(
          userRef.current,
          `/api/ai/jobs?orgId=${encodeURIComponent(orgId)}&limit=1`,
        )
        if (active) {
          setVerdict(response.status === 404 || response.status === 403 ? 'hidden' : 'ready')
        }
      } catch {
        if (active) setVerdict('hidden')
      }
    })()
    return () => {
      active = false
    }
  }, [orgId, uid])

  if (verdict !== 'ready') return null
  return (
    <>
      <Button size="small" variant="outlined" onClick={() => setOpen(true)}>
        {'Describe it'}
      </Button>
      <AiPageBriefDialog
        open={open}
        onClose={() => setOpen(false)}
        orgId={orgId}
        hostId={hostId}
        user={user}
      />
    </>
  )
}

export default AiDescribePageButton
