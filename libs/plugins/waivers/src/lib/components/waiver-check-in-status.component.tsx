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
  Alert,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  useMediaQuery,
} from '@mui/material'
import {
  customerDisplayHost,
  subscribeCustomerDisplayHost,
} from '@aglyn/aglyn/plugin-manager/plugin-customer-display'
import { useTheme } from '@mui/material/styles'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { WAIVERS_API_ROUTES, WAIVERS_DISPLAY_PAGE_PATH, WAIVERS_PLUGIN_ID } from '../constants/bundle-common'
import { WaiverSignFlow } from './waiver-sign-flow.component'
import { useWaiversFetch, WaiversRequestError } from './waivers-api'
import { useWindowSigning } from './use-window-signing'

/**
 * What the register's `posCheckIn` zone hands a widget (AGL-4043), restated
 * here because a plugin never imports the plugin that hosts a zone: one
 * customer at the window on one day.
 */
export interface PosCheckInZoneProps {
  hostId: string
  orgId: string | undefined
  contactId: string | null
  /** Lower case, or `null`. */
  email: string | null
  /** `YYYY-MM-DD` in the site's time zone. */
  dayKey: string
  name: string | null
  /** The people due to check in, when the register knows. */
  unitsDue: number | null
  placement: 'check-in-row' | 'check-in-customer' | 'register-customer'
}

interface StatusAnswer {
  signed: boolean
  coveredNames: string[]
  label: string
}

type State = { state: 'loading' } | { state: 'hidden' } | { state: 'ready'; status: StatusAnswer | null }

/** How often the status is read again while a rider signs on the customer display, and for how long. */
const DISPLAY_RECHECK_MS = 5_000
const DISPLAY_RECHECK_FOR_MS = 10 * 60 * 1000

/** The register's customer display, when the page offers one (core's seam), or `null`. */
function useCustomerDisplay() {
  return useSyncExternalStore(subscribeCustomerDisplayHost, customerDisplayHost, () => null)
}

/**
 * A customer's waiver at check-in (AGL-4042): "Waiver signed", "Signed for
 * 2 of 3 riders" or "Waiver needed", with Sign waiver opening the signing
 * form on this device, as at the window. When the register has a customer
 * display connected, Customer display puts the signing on it instead,
 * through core's customer display seam, and the status is read again until
 * it is signed. Draws nothing for a member who may not see signatures (the
 * route refuses them), so the register never shows a control they could
 * not use.
 */
export function WaiverCheckInStatus(props: PosCheckInZoneProps) {
  const { hostId, email, contactId, dayKey, unitsDue } = props
  const { ready, request } = useWaiversFetch()
  const [state, setState] = useState<State>({ state: 'loading' })
  const [signing, setSigning] = useState(false)
  const [revision, setRevision] = useState(0)
  const submit = useWindowSigning(hostId)
  const theme = useTheme()
  const narrow = useMediaQuery(theme.breakpoints.down('sm'))
  const compact = props.placement === 'check-in-row'
  const display = useCustomerDisplay()
  const [onDisplay, setOnDisplay] = useState<{ untilMs: number } | null>(null)
  const [displayError, setDisplayError] = useState<string | null>(null)

  useEffect(() => {
    if (!ready) return
    if (!email && !contactId) {
      setState({ state: 'ready', status: null })
      return
    }
    let live = true
    void request<StatusAnswer>(WAIVERS_API_ROUTES.status, {
      query: {
        hostId,
        dayKey,
        ...(email ? { email } : { contactId: contactId ?? undefined }),
        ...(unitsDue && unitsDue > 1 ? { people: String(unitsDue) } : {}),
      },
    })
      .then((status) => live && setState({ state: 'ready', status }))
      .catch((caught: unknown) => {
        if (!live) return
        // Not this member's to see, or no plan with waivers: say nothing.
        if (caught instanceof WaiversRequestError && (caught.status === 403 || caught.status === 404)) {
          setState({ state: 'hidden' })
        } else {
          setState({ state: 'ready', status: null })
        }
      })
    return () => {
      live = false
    }
  }, [ready, request, hostId, email, contactId, dayKey, unitsDue, revision])

  const close = useCallback(() => {
    setSigning(false)
    setRevision((value) => value + 1)
  }, [])

  // While the rider signs on the display, read the status again now and
  // then, until it is signed or a while has passed.
  const signed = state.state === 'ready' && state.status?.signed === true && state.status.label === 'Waiver signed'
  useEffect(() => {
    if (!onDisplay) return undefined
    if (signed || Date.now() > onDisplay.untilMs) {
      setOnDisplay(null)
      return undefined
    }
    const timer = window.setTimeout(() => setRevision((value) => value + 1), DISPLAY_RECHECK_MS)
    return () => window.clearTimeout(timer)
  }, [onDisplay, signed, revision])

  const showOnDisplay = useCallback(async () => {
    if (!display) return
    setDisplayError(null)
    try {
      const { grant } = await request<{ grant: string }>(WAIVERS_API_ROUTES.displayGrant, { body: { hostId } })
      const shown = await display.show({
        pluginId: WAIVERS_PLUGIN_ID,
        path: WAIVERS_DISPLAY_PAGE_PATH,
        params: { host: hostId, grant },
      })
      if (!shown) throw new Error('The customer display didn’t answer. Check that it is on, or hand over this device.')
      setOnDisplay({ untilMs: Date.now() + DISPLAY_RECHECK_FOR_MS })
    } catch (caught) {
      setDisplayError(caught instanceof Error ? caught.message : 'The customer display didn’t answer.')
    }
  }, [display, request, hostId])

  if (state.state === 'hidden') return null
  if (state.state === 'loading') return <CircularProgress size={16} aria-label="Checking the waiver" />

  const status = state.status
  const label = status ? status.label : 'Waiver not on file'
  const color = status?.signed && label === 'Waiver signed' ? 'success' : 'warning'
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
      <Chip size="small" color={color} variant={color === 'success' ? 'filled' : 'outlined'} label={label} />
      {!status?.signed || label !== 'Waiver signed' ? (
        <Button size="small" onClick={() => setSigning(true)}>
          {compact ? 'Sign' : 'Sign waiver'}
        </Button>
      ) : null}
      {display && (!status?.signed || label !== 'Waiver signed') ? (
        <Button size="small" onClick={() => void showOnDisplay()} disabled={Boolean(onDisplay)}>
          {onDisplay ? 'On the customer display' : 'Customer display'}
        </Button>
      ) : null}
      {displayError ? (
        <Alert severity="warning" onClose={() => setDisplayError(null)}>
          {displayError}
        </Alert>
      ) : null}
      <Dialog open={signing} onClose={close} fullWidth maxWidth="sm" fullScreen={narrow}>
        <DialogTitle>{'Sign a waiver'}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Alert severity="info">{'Hand the device to the rider. Take it back when it says signed.'}</Alert>
            <WaiverSignFlow
              hostId={hostId}
              mode="at_window"
              submit={submit}
              initial={{ name: props.name, email: props.email }}
              doneActions={(reset) => (
                <Stack direction="row" spacing={1}>
                  <Button onClick={reset}>{'Next signer'}</Button>
                  <Button variant="contained" onClick={close}>
                    {'Done'}
                  </Button>
                </Stack>
              )}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>{'Close'}</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

export default WaiverCheckInStatus
