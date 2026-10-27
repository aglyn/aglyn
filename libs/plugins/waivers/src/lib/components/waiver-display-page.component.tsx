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
import { customerDisplayReturnPath } from '@aglyn/aglyn/plugin-manager/plugin-customer-display'
import { Alert, Box, Button, Container, Stack } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { WAIVERS_API_ROUTES } from '../constants/bundle-common'
import { WaiverSignFlow } from './waiver-sign-flow.component'
import { publicWaiversRequest } from './waivers-api'

/** How long the display waits on a screen nobody is touching before it goes back. */
export const WAIVER_DISPLAY_IDLE_MS = 5 * 60 * 1000
/** And after a signing, if nobody taps Done. */
export const WAIVER_DISPLAY_DONE_MS = 60 * 1000

/** Leaves for the display's own screen; an object so a spec can watch it. */
export const waiverDisplayNavigation = {
  leave(path: string): void {
    window.location.replace(path)
  },
}

function DoneActions(props: { reset: () => void; back: () => void }) {
  const { back } = props
  useEffect(() => {
    const timer = window.setTimeout(back, WAIVER_DISPLAY_DONE_MS)
    return () => window.clearTimeout(timer)
  }, [back])
  return (
    <Stack direction="row" spacing={1}>
      <Button onClick={props.reset}>{'Next signer'}</Button>
      <Button variant="contained" onClick={back}>
        {'Done'}
      </Button>
    </Stack>
  )
}

/**
 * Signing on a register's customer display (AGL-4042), at
 * `/kiosk/waivers/display-sign`: the page core's customer display seam opens
 * when staff choose **Customer display** beside a customer at check-in. The
 * rider reads and signs as at the window; the signing carries the grant the
 * console minted for that staff member, so the record names them. **Done**,
 * **Cancel**, a minute after a signing or five minutes untouched sends the
 * display back to the register's screen it came from.
 */
export function WaiverDisplayPage(_props: ConsolePublicPageProps) {
  const [params, setParams] = useState<{ hostId: string; grant: string; returnTo: string | null } | null>(null)
  useEffect(() => {
    const search = window.location.search
    const query = new URLSearchParams(search)
    setParams({ hostId: query.get('host') ?? '', grant: query.get('grant') ?? '', returnTo: customerDisplayReturnPath(search) })
  }, [])
  const returnTo = params?.returnTo ?? null
  const back = useCallback(() => {
    if (returnTo) waiverDisplayNavigation.leave(returnTo)
  }, [returnTo])

  // Nobody touching the screen for a while: it goes back to the register's.
  useEffect(() => {
    if (!returnTo) return undefined
    let last = Date.now()
    const touched = () => {
      last = Date.now()
    }
    const events = ['pointerdown', 'keydown'] as const
    for (const event of events) window.addEventListener(event, touched)
    const timer = window.setInterval(() => {
      if (Date.now() - last > WAIVER_DISPLAY_IDLE_MS) back()
    }, 15_000)
    return () => {
      for (const event of events) window.removeEventListener(event, touched)
      window.clearInterval(timer)
    }
  }, [returnTo, back])

  const submit = useCallback(
    (payload: Record<string, unknown>) =>
      publicWaiversRequest<{ people: string[]; window: string; emailed: boolean }>(WAIVERS_API_ROUTES.signOnDisplay, {
        body: { ...payload, hostId: params?.hostId ?? '', grant: params?.grant ?? '' },
      }),
    [params],
  )

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default', py: { xs: 2, sm: 4 } }}>
      <Container maxWidth="sm">
        {params === null ? null : !params.hostId || !params.grant ? (
          <Stack spacing={2}>
            <Alert severity="info">{'This screen has expired. Ask staff to show the waiver again.'}</Alert>
            {returnTo ? (
              <div>
                <Button onClick={back}>{'Back'}</Button>
              </div>
            ) : null}
          </Stack>
        ) : (
          <Stack spacing={2}>
            {returnTo ? (
              <div>
                <Button onClick={back}>{'Cancel'}</Button>
              </div>
            ) : null}
            <WaiverSignFlow
              hostId={params.hostId}
              mode="at_window"
              submit={submit}
              doneActions={(reset) => <DoneActions reset={reset} back={back} />}
            />
          </Stack>
        )}
      </Container>
    </Box>
  )
}

export default WaiverDisplayPage
