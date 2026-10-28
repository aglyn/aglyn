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
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Container,
  FormControlLabel,
  Stack,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { POS_DISPLAY_ENDPOINT, POS_DISPLAY_TOKEN_HEADER, readStoredToken } from './pos-display/pos-display-api'

/** What the display is shown: the terms of sale, and the sale they are for. */
interface TermsAnswer {
  version: string
  sections: string
  url: string
  summary: string[]
  items: string[]
  acceptance: { method: string; atMs: number } | null
}

/** How long the thank-you shows before the display goes back to the register. */
export const POS_HARDWARE_TERMS_DONE_MS = 4_000

/** Leaves for the display's own screen; an object so a spec can watch it. */
export const posHardwareTermsNavigation = {
  leave(path: string): void {
    window.location.replace(path)
  },
}

async function displayCall<T>(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; value?: T; error?: string }> {
  const token = readStoredToken()
  try {
    const response = await fetch(POS_DISPLAY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { [POS_DISPLAY_TOKEN_HEADER]: token } : {}) },
      cache: 'no-store',
      body: JSON.stringify(body),
    })
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
    return response.ok
      ? { ok: true, status: response.status, value: (payload ?? {}) as T }
      : { ok: false, status: response.status, error: String(payload?.['error'] ?? 'Something went wrong. Try again.') }
  } catch {
    return { ok: false, status: 0, error: 'No connection. Try again.' }
  }
}

/**
 * `/kiosk/commerce/hardware-terms` (AGL-4038): the terms of sale for a card
 * reader sold at the platform's register, on the register's customer
 * display, where the register put them through core's display seam. The
 * buyer reads the summary, ticks the box and accepts before paying; the
 * display then goes back to the register's own screen. The display's own
 * token is the only key, and the route answers only for the sale the
 * register is showing on this display.
 */
export function PosHardwareTermsPage(_props: ConsolePublicPageProps) {
  const [params, setParams] = useState<{ order: string; returnTo: string | null } | null>(null)
  const [terms, setTerms] = useState<TermsAnswer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const search = window.location.search
    setParams({ order: new URLSearchParams(search).get('order') ?? '', returnTo: customerDisplayReturnPath(search) })
  }, [])
  const returnTo = params?.returnTo ?? null
  const back = useCallback(() => {
    if (returnTo) posHardwareTermsNavigation.leave(returnTo)
  }, [returnTo])

  useEffect(() => {
    if (!params?.order) return undefined
    let live = true
    void displayCall<TermsAnswer>({ action: 'hardware-terms', order: params.order }).then((answer) => {
      if (!live) return
      if (answer.ok && answer.value) setTerms(answer.value)
      // The register moved on, or this display is not the one: go back.
      else if (answer.status === 409 || answer.status === 401) back()
      else setError(answer.error ?? 'The terms could not be shown.')
    })
    return () => {
      live = false
    }
  }, [params, back])

  useEffect(() => {
    if (!done) return undefined
    const timer = window.setTimeout(back, POS_HARDWARE_TERMS_DONE_MS)
    return () => window.clearTimeout(timer)
  }, [done, back])

  const accept = async () => {
    if (!params?.order) return
    setBusy(true)
    const answer = await displayCall({ action: 'accept-hardware-terms', order: params.order, accept: true })
    setBusy(false)
    if (answer.ok) setDone(true)
    else if (answer.status === 409) back()
    else setError(answer.error ?? 'That did not go through. Try again.')
  }

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default', py: { xs: 2, sm: 4 } }}>
      <Container maxWidth="sm">
        {done ? (
          <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center', py: 6 }}>
            <Typography variant="h5">{'Thank you'}</Typography>
            <Typography variant="body1">{'You accepted the terms of sale. The cashier will take your payment.'}</Typography>
          </Stack>
        ) : error ? (
          <Stack spacing={2}>
            <Alert severity="warning">{error}</Alert>
            {returnTo ? (
              <div>
                <Button onClick={back}>{'Back'}</Button>
              </div>
            ) : null}
          </Stack>
        ) : !terms ? (
          <Stack sx={{ alignItems: 'center', py: 6 }}>
            <CircularProgress aria-label="Loading the terms of sale" />
          </Stack>
        ) : (
          <Stack spacing={2}>
            <Typography variant="h5" component="h1">
              {'Terms of sale for your card reader hardware'}
            </Typography>
            {terms.items.length ? (
              <Typography variant="body2" color="text.secondary">
                {terms.items.join(' · ')}
              </Typography>
            ) : null}
            <Typography variant="body1">
              {`This purchase is made under our Terms, Sections ${terms.sections}. In short:`}
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 3, display: 'flex', flexDirection: 'column', gap: 1 }}>
              {terms.summary.map((line) => (
                <Typography key={line} component="li" variant="body2">
                  {line}
                </Typography>
              ))}
            </Box>
            <Typography variant="body2" color="text.secondary">
              {`The full Terms are at ${terms.url.replace(/^https?:\/\//, '')}.`}
            </Typography>
            {terms.acceptance && terms.acceptance.method !== 'notice' ? (
              <Alert severity="success">{'You have already accepted these terms for this purchase.'}</Alert>
            ) : (
              <>
                <FormControlLabel
                  control={<Checkbox checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />}
                  label={`I have read the terms of sale (Sections ${terms.sections}) and accept them for this purchase.`}
                />
                <Stack direction="row" spacing={1}>
                  {returnTo ? <Button onClick={back}>{'Not now'}</Button> : null}
                  <Button variant="contained" disabled={!agreed || busy} onClick={() => void accept()}>
                    {'Accept'}
                  </Button>
                </Stack>
              </>
            )}
          </Stack>
        )}
      </Container>
    </Box>
  )
}

export default PosHardwareTermsPage
