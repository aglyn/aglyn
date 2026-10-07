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

import { trackEvent } from '@aglyn/aglyn/app-utils/analytics-events'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { Button, Typography } from '@mui/material'
import { useCallback, useRef, useState } from 'react'
import {
  AI_SITE_STARTER_FALLBACK_LABEL,
  aiSiteStarterFallbackOffered,
} from '../model/ai-job-failure-copy'
import type { AiJobSummary } from '../model/ai-jobs.types'

/**
 * Asks the console for the site's starter (AGL-3594): `POST
 * /api/hosts/starter`, the same route leaving the guided start for a blank
 * site calls. A no-op on a site that has a page already. Reports the
 * starter's published Home as the site's first publish, only when one was
 * written. Never throws.
 */
export async function requestAiStarterSite(
  user: Parameters<typeof authorizedFetch>[0],
  hostId: string,
): Promise<'provisioned' | 'unchanged' | 'failed'> {
  try {
    const response = await authorizedFetch(user, '/api/hosts/starter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostId }),
    })
    if (!response.ok) return 'failed'
    const payload = (await response.json().catch(() => null)) as { provisioned?: boolean } | null
    if (payload?.provisioned !== true) return 'unchanged'
    trackEvent('site_published', { first_publish: true })
    return 'provisioned'
  } catch {
    return 'failed'
  }
}

/**
 * "Use the starter site instead" (AGL-3594): the one action a guided start
 * that did not work out offers — a site job that failed, was canceled, or
 * stopped for review — while it has built nothing. Draws nothing for any
 * other job. The AI jobs drawer places it on a failed or canceled row; the
 * plan card places it beside Try again when it is handed the signed-in user.
 * The user is a prop rather than read here, so a surface drawn outside the
 * console's Firebase provider still renders.
 */
export function AiSiteStarterFallback({
  job,
  user,
}: {
  job: AiJobSummary
  user: Parameters<typeof authorizedFetch>[0]
}): JSX.Element | null {
  const userRef = useRef(user)
  userRef.current = user
  const [state, setState] = useState<'idle' | 'busy' | 'provisioned' | 'unchanged' | 'failed'>('idle')
  const use = useCallback(async () => {
    if (!job.hostId) return
    setState('busy')
    setState(await requestAiStarterSite(userRef.current, job.hostId))
  }, [job.hostId])
  if (!aiSiteStarterFallbackOffered(job)) return null
  if (state === 'provisioned') {
    return (
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
        {'Your site now has the starter home page, live at its address.'}
      </Typography>
    )
  }
  return (
    <>
      <Button size="small" variant="text" disabled={state === 'busy'} onClick={() => void use()} sx={{ mt: 1, ml: 1 }}>
        {AI_SITE_STARTER_FALLBACK_LABEL}
      </Button>
      {state === 'unchanged' && (
        <Typography variant="caption" color="text.secondary" component="div">
          {'This site already has pages, so the starter was not added.'}
        </Typography>
      )}
      {state === 'failed' && (
        <Typography variant="caption" color="error" component="div">
          {'The starter site could not be added. Try again.'}
        </Typography>
      )}
    </>
  )
}

export default AiSiteStarterFallback
