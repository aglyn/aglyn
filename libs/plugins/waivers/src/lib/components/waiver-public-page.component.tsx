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
import { Alert, Box, Container } from '@mui/material'
import { useEffect, useState } from 'react'
import { WaiverSignFlow } from './waiver-sign-flow.component'

/**
 * The share link's page (AGL-4042), at `/kiosk/waivers/sign?host=…&waiver=…`:
 * a signer on their own phone, before they arrive, with no account. The page
 * reads only what the public route serves, a published waiver of that site,
 * and signs through the public door.
 */
export function WaiverPublicPage(_props: ConsolePublicPageProps) {
  const [params, setParams] = useState<{ hostId: string; waiverId: string | null } | null>(null)
  useEffect(() => {
    const search = new URLSearchParams(window.location.search)
    setParams({ hostId: search.get('host') ?? '', waiverId: search.get('waiver') })
  }, [])
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: { xs: 2, sm: 4 } }}>
      <Container maxWidth="sm">
        {params === null ? null : params.hostId ? (
          <WaiverSignFlow hostId={params.hostId} waiverId={params.waiverId} mode="online" />
        ) : (
          <Alert severity="info">{'This link is missing the waiver it was for. Ask the business for a new link.'}</Alert>
        )}
      </Container>
    </Box>
  )
}

export default WaiverPublicPage
