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

import { Box, CircularProgress } from '@mui/material'
import { notFound } from 'next/navigation'
import { type ReactNode } from 'react'
import {
  useHostId,
  useHostReady,
  useHostSubdomain,
} from './host-id-provider'

/**
 * `/[orgSlug]/hosts/[host]/…` resolution gate (AGL-622). The URL addresses the
 * host by SUBDOMAIN; HostIdProvider resolves it to a doc id. This guard lives
 * INSIDE the host route tree — below the route not-found boundary — so:
 *  - it holds a spinner until resolution settles (so useHostId() consumers
 *    never build a Firestore ref with a null id), then
 *  - renders the designed 404 for an unknown subdomain (one that is not one of
 *    the current org's hosts). Never a sign-out.
 * The provider can't do the 404 itself: it is global, above the boundaries, so
 * a notFound() there escapes to the error boundary instead.
 */
export function HostGuard({ children }: { children?: ReactNode }) {
  const subdomain = useHostSubdomain()
  const ready = useHostReady()
  const hostId = useHostId()

  if (subdomain && !ready) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }
  if (subdomain && !hostId) notFound()
  return <>{children}</>
}
HostGuard.displayName = 'HostGuard'

export default HostGuard
