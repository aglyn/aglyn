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

import type { ConsolePublicPageProps } from '@aglyn/aglyn'
import { Alert, Box, CircularProgress, Container, Stack } from '@mui/material'
import { useEffect, useState } from 'react'
import { WAIVERS_API_ROUTES } from '../constants/bundle-common'
import { WaiverSignFlow } from './waiver-sign-flow.component'
import { publicWaiversRequest } from './waivers-api'

/** How the page leaves for the store's site; an object so a spec can watch it. */
export const waiverPageNavigation = {
  replace(url: string): void {
    window.location.replace(url)
  },
}

/**
 * Where a share link handed out before AGL-4042's change still points, at
 * `/kiosk/waivers/sign?host=…&waiver=…`. A share link now opens on the
 * store's own site, so this page sends the signer there: it asks the public
 * route where the store's signing page is (`signUrl`) and replaces itself
 * with it, so the back button does not return here. A site with no public
 * address, or a waiver that is not available, is signed or refused right
 * here as before.
 */
export function WaiverPublicPage(_props: ConsolePublicPageProps) {
  const [params, setParams] = useState<{ hostId: string; waiverId: string | null } | null>(null)
  const [stay, setStay] = useState(false)
  useEffect(() => {
    const search = new URLSearchParams(window.location.search)
    setParams({ hostId: search.get('host') ?? '', waiverId: search.get('waiver') })
  }, [])
  useEffect(() => {
    if (!params?.hostId) return
    let live = true
    void publicWaiversRequest<{ signUrl?: string | null }>(WAIVERS_API_ROUTES.publicWaiver, {
      query: { hostId: params.hostId, waiverId: params.waiverId ?? undefined },
    })
      .then((answer) => {
        if (!live) return
        if (answer.signUrl && /^https:\/\//.test(answer.signUrl)) waiverPageNavigation.replace(answer.signUrl)
        else setStay(true)
      })
      .catch(() => live && setStay(true))
    return () => {
      live = false
    }
  }, [params])
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: { xs: 2, sm: 4 } }}>
      <Container maxWidth="sm">
        {params === null ? null : !params.hostId ? (
          <Alert severity="info">{'This link is missing the waiver it was for. Ask the business for a new link.'}</Alert>
        ) : stay ? (
          <WaiverSignFlow hostId={params.hostId} waiverId={params.waiverId} mode="online" />
        ) : (
          <Stack sx={{ alignItems: 'center', py: 6 }}>
            <CircularProgress aria-label="Opening the waiver" />
          </Stack>
        )}
      </Container>
    </Box>
  )
}

export default WaiverPublicPage
