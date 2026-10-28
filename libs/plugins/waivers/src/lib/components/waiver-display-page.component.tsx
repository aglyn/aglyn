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
import {
  customerDisplayCredential,
  customerDisplayReturnPath,
} from '@aglyn/aglyn/plugin-manager/plugin-customer-display'
import { Alert, Box, Button, Container, Stack } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { WAIVERS_API_ROUTES } from '../constants/bundle-common'
import type { SigningResult } from './signing-form.component'
import { WaiverSignFlow } from './waiver-sign-flow.component'
import { publicWaiversRequest } from './waivers-api'

/**
 * How long the thank-you shows after a signing before the display goes back
 * to the register's screen, if nobody taps Done or Next signer. It runs only
 * once the rider has signed: an unsigned waiver never leaves on its own.
 */
export const WAIVER_DISPLAY_THANKS_MS = 10_000
/** How often the page asks whether the register still shows this waiver, to follow it. */
export const WAIVER_DISPLAY_FOLLOW_MS = 3_000

/** Leaves for the display's own screen; an object so a spec can watch it. */
export const waiverDisplayNavigation = {
  leave(path: string): void {
    window.location.replace(path)
  },
}

function ThanksActions(props: { reset: () => void; back: () => void }) {
  const { back } = props
  useEffect(() => {
    const timer = window.setTimeout(back, WAIVER_DISPLAY_THANKS_MS)
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
 * `/kiosk/waivers/display-sign?host=…`: the page core's customer display
 * seam opens when staff choose **Customer display** beside a customer at
 * check-in. The rider reads and signs as at the window.
 *
 * The paired display is the authorization: the page sends the display's own
 * credential (core keeps it on the display) with the signing, and the server
 * checks, through core's display verifier, that this display is paired to
 * the store and still shows its waiver. The record names the staff member
 * who sent it.
 *
 * It stays until the rider signs, however long that takes: nothing on it
 * runs out, and there is nothing to close. It follows the register, so once
 * staff show something else on the display, the display goes back to the
 * register's screen. After a signing it says thank you, offers **Next
 * signer** and **Done**, and goes back on its own a few seconds later.
 */
export function WaiverDisplayPage(_props: ConsolePublicPageProps) {
  const [params, setParams] = useState<{ hostId: string; display: string | null; returnTo: string | null } | null>(
    null,
  )
  useEffect(() => {
    const search = window.location.search
    setParams({
      hostId: new URLSearchParams(search).get('host') ?? '',
      display: customerDisplayCredential(),
      returnTo: customerDisplayReturnPath(search),
    })
  }, [])
  const returnTo = params?.returnTo ?? null
  const hostId = params?.hostId ?? ''
  const display = params?.display ?? ''
  const back = useCallback(() => {
    if (returnTo) waiverDisplayNavigation.leave(returnTo)
  }, [returnTo])

  // Follows the register: once it shows something else on this display, go
  // back to it. A missed answer is asked again, never a reason to leave.
  useEffect(() => {
    if (!hostId || !display || !returnTo) return undefined
    let live = true
    const timer = window.setInterval(() => {
      void publicWaiversRequest<{ showing: boolean }>(WAIVERS_API_ROUTES.displayScreen, { body: { hostId, display } })
        .then((answer) => {
          if (live && answer.showing === false) back()
        })
        .catch(() => undefined)
    }, WAIVER_DISPLAY_FOLLOW_MS)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [hostId, display, returnTo, back])

  const submit = useCallback(
    (payload: Record<string, unknown>) =>
      publicWaiversRequest<SigningResult>(WAIVERS_API_ROUTES.signOnDisplay, {
        body: { ...payload, hostId, display },
      }),
    [hostId, display],
  )

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default', py: { xs: 2, sm: 4 } }}>
      <Container maxWidth="sm">
        {params === null ? null : !hostId || !display ? (
          <Stack spacing={2}>
            <Alert severity="info">{'This screen isn’t paired with the store’s register. Ask staff for help.'}</Alert>
            {returnTo ? (
              <div>
                <Button onClick={back}>{'Back'}</Button>
              </div>
            ) : null}
          </Stack>
        ) : (
          <WaiverSignFlow
            hostId={hostId}
            mode="at_window"
            submit={submit}
            doneActions={(reset) => <ThanksActions reset={reset} back={back} />}
          />
        )}
      </Container>
    </Box>
  )
}

export default WaiverDisplayPage
