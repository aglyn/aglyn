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
 * Retired surface (AGL-653): the community profile is the ORG's marketplace
 * identity now, so it lives at `/[orgSlug]/community`.
 *
 * Kept as a redirect rather than deleted because this path is baked into
 * Stripe Connect return URLs and older notification links — both frozen at
 * write time — so removing the route outright would 404 people mid-flow.
 * Query params ride along so `?connect=done` still lands correctly.
 */
export default function ManageCommunityRedirect() {
  const router = useRouter()
  const orgSlug = useOrgSlug()

  useEffect(() => {
    const search = typeof window === 'undefined' ? '' : window.location.search
    router.replace(
      orgSlug
        ? `${buildRoute(Route.MANAGE_COMMUNITY_PROFILE, { orgSlug })}${search}`
        : '/',
    )
  }, [router, orgSlug])

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
      <CircularProgress />
    </Box>
  )
}
