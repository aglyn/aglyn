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
import type { SigningResult } from './signing-form.component'
import { WaiverSignFlow } from './waiver-sign-flow.component'
import { publicWaiversRequest } from './waivers-api'

/** How long after a signing the display goes back, if nobody taps Done or Next signer. */
export const WAIVER_DISPLAY_DONE_MS = 60 * 1000
/** How often the display asks whether staff closed its screen. */
export const WAIVER_DISPLAY_CHECK_MS = 5_000

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
 * console minted for that staff member, so the record names them.
 *
 * It stays until it is closed, with no timer while the rider reads: staff
 * close it from the check-in (the page asks every few seconds and goes back),
 * or **Done**, **Cancel**, or a minute after a signing sends the display
 * back to the register's screen it came from, closing the grant as it goes.
 */
export function WaiverDisplayPage(_props: ConsolePublicPageProps) {
  const [params, setParams] = useState<{ hostId: string; grant: string; returnTo: string | null } | null>(null)
  useEffect(() => {
    const search = window.location.search
    const query = new URLSearchParams(search)
    setParams({ hostId: query.get('host') ?? '', grant: query.get('grant') ?? '', returnTo: customerDisplayReturnPath(search) })
  }, [])
  const returnTo = params?.returnTo ?? null
  const hostId = params?.hostId ?? ''
  const grant = params?.grant ?? ''
  const [closed, setClosed] = useState(false)
  const leave = useCallback(() => {
    if (returnTo) waiverDisplayNavigation.leave(returnTo)
  }, [returnTo])
  // Going back closes the grant, so nothing signs under it again; the
  // display leaves whether or not the close was heard (staff can close it too).
  const back = useCallback(() => {
    if (!grant || !hostId) return leave()
    void publicWaiversRequest(WAIVERS_API_ROUTES.displayGrantState, { body: { grant, hostId, close: true } })
      .catch(() => undefined)
      .finally(leave)
  }, [grant, hostId, leave])

  // Staff closed it from the check-in: say so and go back.
  useEffect(() => {
    if (!grant || !hostId) return undefined
    let live = true
    const check = async () => {
      try {
        const answer = await publicWaiversRequest<{ open: boolean }>(WAIVERS_API_ROUTES.displayGrantState, {
          body: { grant, hostId },
        })
        if (live && !answer.open) {
          setClosed(true)
          leave()
        }
      } catch {
        // A missed check is asked again on the next tick.
      }
    }
    const timer = window.setInterval(() => void check(), WAIVER_DISPLAY_CHECK_MS)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [grant, hostId, leave])

  const submit = useCallback(
    (payload: Record<string, unknown>) =>
      publicWaiversRequest<SigningResult>(WAIVERS_API_ROUTES.signOnDisplay, {
        body: { ...payload, hostId: params?.hostId ?? '', grant: params?.grant ?? '' },
      }),
    [params],
  )

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default', py: { xs: 2, sm: 4 } }}>
      <Container maxWidth="sm">
        {params === null ? null : !params.hostId || !params.grant || closed ? (
          <Stack spacing={2}>
            <Alert severity="info">{'Staff closed this screen. Ask them to show the waiver again.'}</Alert>
            {returnTo ? (
              <div>
                <Button onClick={leave}>{'Back'}</Button>
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
