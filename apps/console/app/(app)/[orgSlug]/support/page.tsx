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

import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { Box, CircularProgress } from '@mui/material'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import useSupportApi from '../../../../hooks/use-support-api'
import { useOrgSlug } from '../../../../hooks/use-org-scope'
import { supportLandingRoute } from '../../../../utils/support-surfaces'

/**
 * Support, the umbrella (AGL-1158).
 *
 * Tickets and the community forum used to be two cards on this page. They are
 * two features: gated differently (AGL-1103 — tickets need a first-response
 * commitment, from Pro; the forum is open to every tier including Free) and
 * failing independently, which one page hid. AGL-1157 was a single bad line in
 * the loader they shared, and it emptied BOTH lists at once.
 *
 * They now own a route each. This page keeps the name, the nav tab and the
 * docs topic pointing at one place, and forwards to whichever channel the
 * workspace's tier makes primary — so a Free or Starter org lands on a whole
 * forum rather than on a half-empty page beside a ticket card it cannot use.
 *
 * `replace`, not `push`: this URL resolves to a destination rather than being
 * one, so leaving it in history gives Back a step that immediately forwards
 * again.
 */
const SupportIndex: NextPageWithLayout<Record<string, never>> = () => {
  const orgSlug = useOrgSlug()
  const router = useRouter()
  const { commitment, ready } = useSupportApi()

  // `null` until the plan is a trustworthy answer, and that is the whole
  // contract of this page. `org` is undefined both in flight and when there is
  // no doc, so forwarding early would send an Enterprise workspace to the
  // forum and present it as their support channel — the same shape as reading
  // a loading default as the free tier.
  const target = supportLandingRoute(commitment, orgSlug, ready)

  useEffect(() => {
    if (target) router.replace(target)
  }, [target, router])

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
      <CircularProgress />
    </Box>
  )
}
SupportIndex.displayName = 'Page:SupportIndex'

export default SupportIndex
