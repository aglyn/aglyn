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

// Deep import, not the `@aglyn/aglyn` barrel (AGL-2170): the barrel pulls
// shared-data-enums -> firebase-auth into every consumer's module graph, which
// breaks specs that mock firebase wholesale (AuthErrorCodes reads undefined).
// One brand string is not worth that edge.
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { Box, Button, Stack, Typography } from '@mui/material'
import { signOut } from 'firebase/auth'
import { useEffect, useState } from 'react'
import { useAuth } from '@aglyn/tenant-feature-instance'
import { useIsStaff } from '../hooks/use-is-staff'

interface PlatformLockdownNotice {
  locked: boolean
  reason?: string
  title?: string
  message?: string
  contact?: string
  untilMs?: number
}

/**
 * The console face of a PLATFORM lockdown (AGL-1501). The ENFORCEMENT is
 * server-side — the session mint/exchange and the API routes refuse locked
 * callers with 423 whatever this component renders — so this is the notice
 * layer: instead of an app where every request mysteriously fails, a locked
 * visitor gets the reason and a working sign-out.
 *
 * Two deliberate asymmetries:
 *  - **Staff pass through, and so does "still resolving".** The gate only
 *    replaces the app when the staff answer is a definite `false` — a
 *    loading default that answered "not staff" would flash the lockdown
 *    screen at the operator trying to lift it (the un-panic invariant,
 *    client edition; and the gate-on-`ready` lesson).
 *  - **Fail open.** A failed status fetch renders the app. This surface is
 *    decoration by design; refusing to render on a network blip would make
 *    the notice layer an outage of its own.
 */
export function PlatformLockdownGate({
  children,
}: {
  children: React.ReactNode
}) {
  const isStaff = useIsStaff()
  const firebaseAuth = useAuth()
  const [notice, setNotice] = useState<PlatformLockdownNotice | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch('/api/lockdown-status')
      .then(async (response) => (response.ok ? response.json() : null))
      .then((payload: PlatformLockdownNotice | null) => {
        if (!cancelled && payload?.locked) setNotice(payload)
      })
      .catch(() => {
        // Fail open.
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!notice || isStaff !== false) return <>{children}</>

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: 3,
        bgcolor: 'background.default',
      }}
    >
      <Stack spacing={2} sx={{ maxWidth: 480, textAlign: 'center' }}>
        <Typography variant="h5">
          {notice.title ?? 'Temporarily unavailable'}
        </Typography>
        <Typography variant="body1" color="text.secondary">
          {notice.message ??
            `${PLATFORM_BRAND_NAME} is temporarily unavailable. Please check back shortly.`}
        </Typography>
        {notice.untilMs ? (
          <Typography variant="body2" color="text.secondary">
            {`Expected back by ${new Date(notice.untilMs).toLocaleString()}.`}
          </Typography>
        ) : null}
        {notice.contact ? (
          <Typography variant="body2" color="text.secondary">
            {'Questions? '}
            <a href={`mailto:${notice.contact}`}>{notice.contact}</a>
          </Typography>
        ) : null}
        <Button
          variant="outlined"
          onClick={() => void signOut(firebaseAuth).catch(() => undefined)}
          sx={{ alignSelf: 'center' }}
        >
          {'Sign out'}
        </Button>
      </Stack>
    </Box>
  )
}

export default PlatformLockdownGate
