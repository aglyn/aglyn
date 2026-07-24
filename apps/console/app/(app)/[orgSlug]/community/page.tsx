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

import { CircularProgress } from '@mui/material'
import Box from '@mui/material/Box'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { buildRoute, Route } from '../../../../constants/route-links'
import { useOrgSlug } from '../../../../hooks/use-org-scope'

/**
 * Retired surface (AGL-798): the seller area — publisher profile, listings,
 * payouts and sales — was folded into the Marketplace › Publish tab so the
 * whole marketplace lives in one section.
 *
 * Kept as a redirect rather than deleted because this path is baked into
 * Stripe Connect return URLs and older notification links — both frozen at
 * write time — so removing it would 404 people mid-flow. The incoming query
 * (e.g. `?connect=done`) rides along, with `tab=publish` added so the redirect
 * lands directly on the seller area.
 */
export default function OrgCommunityRedirect() {
  const router = useRouter()
  const orgSlug = useOrgSlug()

  useEffect(() => {
    if (!orgSlug) return void router.replace('/')
    const params = new URLSearchParams(
      typeof window === 'undefined' ? '' : window.location.search,
    )
    params.set('tab', 'publish')
    router.replace(
      `${buildRoute(Route.ORG_MARKETPLACE, { orgSlug })}?${params.toString()}`,
    )
  }, [router, orgSlug])

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
      <CircularProgress />
    </Box>
  )
}
