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

import {
  customerDisplayHost,
  subscribeCustomerDisplayHost,
} from '@aglyn/aglyn/plugin-manager/plugin-customer-display'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Link,
  Stack,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { BUNDLE_ID } from '../../../constants/bundle-common'
import { PosHardwareRequestError } from './pos-hardware-api'
import {
  posHardwareAcceptTerms,
  posHardwareTerms,
  posHardwareTermsOnDisplay,
  posHardwareTermsStatus,
  type PosHardwareTermsAcceptanceView,
  type PosHardwareTermsView,
} from './pos-hardware-sale-api'

type User = Parameters<typeof posHardwareTerms>[0]
type Notify = (message: string, variant: 'success' | 'info' | 'warning' | 'error') => void

/** The display page the terms open at, beneath `/kiosk/commerce` (`server/pos-display.ts`). */
export const POS_HARDWARE_TERMS_SCREEN_PATH = '/hardware-terms'

/** The printable booth sign, a public page of this plugin. */
export const POS_HARDWARE_TERMS_SIGN_HREF = `/kiosk/${BUNDLE_ID}/hardware-terms-sign`

/** How often the register asks whether the buyer accepted on the display. */
export const POS_HARDWARE_TERMS_POLL_MS = 2_500

const METHOD_LABEL: Record<PosHardwareTermsAcceptanceView['method'], string> = {
  tablet: 'on this tablet',
  display: 'on the customer display',
  notice: 'by the receipt and booth sign',
}

function useDisplayHost() {
  return useSyncExternalStore(subscribeCustomerDisplayHost, customerDisplayHost, () => null)
}

/**
 * The buyer accepts the terms of sale before paying (AGL-4038, Terms 4.28):
 * on the customer display, which the register shows them on through core's
 * display seam, or on this tablet, handed to them. Where neither can be
 * used, every receipt of the sale and the booth sign state the terms, and
 * paying is agreeing; the sign prints from here.
 */
export function PosHardwareSaleTerms(props: { user: User; hostId: string; saleOrderId: string; notify: Notify }) {
  const { user, hostId, saleOrderId, notify } = props
  const host = useDisplayHost()
  const [acceptance, setAcceptance] = useState<PosHardwareTermsAcceptanceView | null>(null)
  const [waiting, setWaiting] = useState(false)
  const [tablet, setTablet] = useState<PosHardwareTermsView | null>(null)
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const answer = await posHardwareTermsStatus(user, hostId, saleOrderId).catch(() => null)
    if (answer) setAcceptance(answer.acceptance)
    return answer?.acceptance ?? null
  }, [user, hostId, saleOrderId])

  useEffect(() => {
    setAcceptance(null)
    setWaiting(false)
    void refresh()
  }, [refresh])

  // Waiting on the display: asked until the buyer accepts there.
  useEffect(() => {
    if (!waiting) return undefined
    const timer = window.setInterval(() => {
      void refresh().then((held) => {
        if (held && held.method !== 'notice') {
          setWaiting(false)
          notify('The buyer accepted the terms of sale on the display.', 'success')
        }
      })
    }, POS_HARDWARE_TERMS_POLL_MS)
    return () => window.clearInterval(timer)
  }, [waiting, refresh, notify])

  const fail = (caught: unknown, fallback: string) =>
    notify(caught instanceof PosHardwareRequestError ? caught.message : fallback, 'warning')

  const showOnDisplay = async () => {
    if (!host) return
    setBusy(true)
    try {
      await posHardwareTermsOnDisplay(user, hostId, saleOrderId)
      const shown = await host.show({ pluginId: BUNDLE_ID, path: POS_HARDWARE_TERMS_SCREEN_PATH, params: { order: saleOrderId } })
      if (!shown) throw new Error('not shown')
      setWaiting(true)
    } catch (caught) {
      fail(caught, 'The terms could not be shown on the display. Hand them this tablet instead.')
    } finally {
      setBusy(false)
    }
  }

  const takeOff = async () => {
    setWaiting(false)
    await host?.close?.(BUNDLE_ID)
  }

  const openTablet = async () => {
    setBusy(true)
    try {
      setAgreed(false)
      setTablet(await posHardwareTerms(user, hostId))
    } catch (caught) {
      fail(caught, 'The terms could not be shown.')
    } finally {
      setBusy(false)
    }
  }

  const acceptOnTablet = async () => {
    setBusy(true)
    try {
      const answer = await posHardwareAcceptTerms(user, hostId, saleOrderId)
      setAcceptance(answer.acceptance)
      setTablet(null)
      notify('The buyer accepted the terms of sale.', 'success')
    } catch (caught) {
      fail(caught, 'The acceptance did not go through. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const accepted = acceptance && acceptance.method !== 'notice' ? acceptance : null
  return (
    <>
      <Alert
        severity={accepted ? 'success' : 'info'}
        action={
          accepted ? undefined : (
            <Stack direction="row" spacing={1}>
              {host ? (
                waiting ? (
                  <Button size="small" onClick={() => void takeOff()}>
                    {'Take off display'}
                  </Button>
                ) : (
                  <Button size="small" disabled={busy} onClick={() => void showOnDisplay()}>
                    {'Show on display'}
                  </Button>
                )
              ) : null}
              <Button size="small" disabled={busy} onClick={() => void openTablet()}>
                {'Accept on this tablet'}
              </Button>
            </Stack>
          )
        }
      >
        {accepted
          ? `Terms of sale accepted ${METHOD_LABEL[accepted.method]} at ${new Date(accepted.atMs).toLocaleTimeString()}.`
          : waiting
            ? 'Waiting for the buyer to accept the terms of sale on the display…'
            : 'Before the buyer pays, have them accept the terms of sale. If no screen can be used, the receipt and the booth sign state the terms, and paying is agreeing.'}
      </Alert>
      <Typography variant="caption" color="text.secondary">
        <Link href={POS_HARDWARE_TERMS_SIGN_HREF} target="_blank" rel="noopener">
          {'Print the booth sign'}
        </Link>
      </Typography>
      <Dialog open={Boolean(tablet)} onClose={() => setTablet(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{'Terms of sale for your card reader hardware'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography variant="body2">
            {`Hand this tablet to the buyer. This purchase is made under our Terms, Sections ${tablet?.sections ?? ''}. In short:`}
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 3, display: 'flex', flexDirection: 'column', gap: 1 }}>
            {(tablet?.summary ?? []).map((line) => (
              <Typography key={line} component="li" variant="body2">
                {line}
              </Typography>
            ))}
          </Box>
          <Typography variant="body2" color="text.secondary">
            {'The full Terms: '}
            <Link href={tablet?.url} target="_blank" rel="noopener">
              {tablet?.url.replace(/^https?:\/\//, '')}
            </Link>
          </Typography>
          <FormControlLabel
            control={<Checkbox checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />}
            label={`I have read the terms of sale (Sections ${tablet?.sections ?? ''}) and accept them for this purchase.`}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTablet(null)}>{'Not now'}</Button>
          <Button variant="contained" disabled={!agreed || busy} onClick={() => void acceptOnTablet()}>
            {'Accept'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

export default PosHardwareSaleTerms
