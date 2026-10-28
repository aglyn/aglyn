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

import { Alert, Button, CircularProgress, List, ListItemButton, ListItemText, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { WAIVERS_API_ROUTES } from '../constants/bundle-common'
import { SigningForm, type SignableWaiver, type SigningResult } from './signing-form.component'
import { publicWaiversRequest } from './waivers-api'

/*==========================================
 * CHOOSE, THEN SIGN (AGL-4042): what the share link's page, the site's Sign
 * waiver element and the window's tablet all do. A named waiver opens
 * straight to its form; otherwise the site's published waivers are listed,
 * and one of them opens straight away.
 *=========================================*/

export interface WaiverToSign {
  site: { name: string; contact?: string | null }
  waiver: SignableWaiver
  consent: { heading?: string; text: string; version: number }
  adultAge: number
}

export interface WaiverSignFlowProps {
  hostId: string
  waiverId?: string | null
  mode: 'online' | 'at_window'
  /** Sends a signing; the public door unless the window's own is given. */
  submit?: (payload: Record<string, unknown>) => Promise<SigningResult>
  doneActions?: (reset: () => void) => ReactNode
  /** Heading over the list of waivers, when more than one is published. */
  heading?: string
  /** What staff already know of the signer. */
  initial?: { name?: string | null; email?: string | null }
}

type State =
  | { state: 'loading' }
  | { state: 'error'; error: string }
  | { state: 'choose'; siteName: string; waivers: Array<{ id: string; title: string }> }
  | { state: 'sign'; answer: WaiverToSign; listed: boolean }

export function WaiverSignFlow(props: WaiverSignFlowProps) {
  const { hostId, mode } = props
  const [chosen, setChosen] = useState<string | null>(props.waiverId ?? null)
  const [state, setState] = useState<State>({ state: 'loading' })
  const listed = useRef(false)

  useEffect(() => setChosen(props.waiverId ?? null), [props.waiverId])

  useEffect(() => {
    let live = true
    setState({ state: 'loading' })
    void (async () => {
      try {
        if (chosen) {
          const answer = await publicWaiversRequest<WaiverToSign>(WAIVERS_API_ROUTES.publicWaiver, {
            query: { hostId, waiverId: chosen },
          })
          if (live) setState({ state: 'sign', answer, listed: listed.current })
          return
        }
        const list = await publicWaiversRequest<{ site: { name: string }; waivers: Array<{ id: string; title: string }> }>(
          WAIVERS_API_ROUTES.publicWaiver,
          { query: { hostId } },
        )
        if (!live) return
        if (list.waivers.length === 1) {
          setChosen(list.waivers[0].id)
          return
        }
        listed.current = true
        setState({ state: 'choose', siteName: list.site.name, waivers: list.waivers })
      } catch (caught) {
        if (live) setState({ state: 'error', error: caught instanceof Error ? caught.message : 'This waiver is not available.' })
      }
    })()
    return () => {
      live = false
    }
  }, [hostId, chosen])

  const submit = useCallback(
    (payload: Record<string, unknown>) =>
      props.submit
        ? props.submit(payload)
        : publicWaiversRequest<SigningResult>(WAIVERS_API_ROUTES.publicSign, {
            body: { ...payload, hostId },
          }),
    [props, hostId],
  )

  if (state.state === 'loading') {
    return (
      <Stack sx={{ alignItems: 'center', py: 6 }}>
        <CircularProgress aria-label="Loading the waiver" />
      </Stack>
    )
  }
  if (state.state === 'error') return <Alert severity="info">{state.error}</Alert>
  if (state.state === 'choose') {
    return (
      <Stack spacing={2}>
        <Typography variant="overline" color="text.secondary">
          {state.siteName}
        </Typography>
        <Typography variant="h5" component="h1">
          {props.heading || 'Choose your waiver'}
        </Typography>
        {state.waivers.length ? (
          <List disablePadding>
            {state.waivers.map((waiver) => (
              <ListItemButton key={waiver.id} divider onClick={() => setChosen(waiver.id)}>
                <ListItemText primary={waiver.title} />
              </ListItemButton>
            ))}
          </List>
        ) : (
          <Alert severity="info">{'There is no waiver to sign here right now.'}</Alert>
        )}
      </Stack>
    )
  }
  return (
    <Stack spacing={2}>
      {state.listed ? (
        <div>
          <Button size="small" onClick={() => setChosen(null)}>
            {'Choose a different waiver'}
          </Button>
        </div>
      ) : null}
      <SigningForm
        key={`${state.answer.waiver.id}-${state.answer.waiver.version}`}
        siteName={state.answer.site.name}
        siteContact={state.answer.site.contact ?? null}
        waiver={state.answer.waiver}
        consentText={state.answer.consent.text}
        consentHeading={state.answer.consent.heading}
        adultAge={state.answer.adultAge}
        mode={mode}
        submit={submit}
        doneActions={props.doneActions}
        initial={props.initial}
      />
    </Stack>
  )
}

export default WaiverSignFlow
