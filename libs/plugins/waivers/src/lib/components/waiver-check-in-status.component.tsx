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
import { lazy, Suspense, useCallback, useEffect, useState, useSyncExternalStore } from 'react'
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
  /**
   * Whether a signature was matched to the rider at all (AGL-4042): by
   * email, else by name and date of birth. `false` with a `searchName` is
   * "not matched": no email match and no date of birth to match the name
   * with, so staff look by name rather than the screen guessing.
   */
  matched?: boolean
  searchName?: string | null
}

/** Finding a rider's waiver by name and date of birth, loaded when it is opened. */
const WaiverNameCheckDialog = lazy(() => import('./waiver-name-check-dialog.component'))

type State = { state: 'loading' } | { state: 'hidden' } | { state: 'ready'; status: StatusAnswer | null }

/** The register's customer display, when the page offers one (core's seam), or `null`. */
function useCustomerDisplay() {
  return useSyncExternalStore(subscribeCustomerDisplayHost, customerDisplayHost, () => null)
}

/**
 * A customer's waiver at check-in (AGL-4042): "Waiver signed", "Signed for
 * 2 of 3 riders" or "Waiver needed", matched by email first and, when the
 * email matches nothing, by name and date of birth together: the birth date
 * the site's CRM record of the customer keeps, when the register names them
 * by their contact (AGL-4042). A rider with no email match and no birth date
 * on file reads "Waiver not matched — check by name", and Find by name asks
 * for one and opens the signatures search on the name. Sign waiver opens the signing
 * form on this device, as at the window. When the register has a customer
 * display connected, Customer display sends the signing to it instead,
 * through core's customer display seam: the paired display is the
 * authorization, so nothing is opened or closed here. The waiver stays on
 * the display until the rider signs or staff show something else there,
 * however long that takes. **Check again** reads the status once more.
 * Draws nothing for a member who may not see signatures (the route refuses
 * them), so the register never shows a control they could not use.
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
  const [displayError, setDisplayError] = useState<string | null>(null)
  const [findingByName, setFindingByName] = useState(false)
  const name = props.name?.trim() || ''
  // Sent to the customer display from this row, until the status reads signed.
  const [sent, setSent] = useState(false)

  useEffect(() => {
    if (!ready) return
    if (!email && !contactId && !name) {
      setState({ state: 'ready', status: null })
      return
    }
    let live = true
    void request<StatusAnswer>(WAIVERS_API_ROUTES.status, {
      query: {
        hostId,
        dayKey,
        ...(email ? { email } : {}),
        // The CRM contact too (AGL-4042): with no email match, the route
        // matches by the name and birth date the site keeps on it.
        ...(contactId ? { contactId } : {}),
        // Matched by name only together with a date of birth; without one,
        // the route answers "not matched" with the name to search by.
        ...(name ? { name } : {}),
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
  }, [ready, request, hostId, email, contactId, name, dayKey, unitsDue, revision])

  const close = useCallback(() => {
    setSigning(false)
    setRevision((value) => value + 1)
  }, [])

  const showOnDisplay = useCallback(async () => {
    if (!display) return
    setDisplayError(null)
    // The site is the screen's one parameter: the display's own pairing is
    // what lets it sign, so nothing is minted for it here.
    const shown = await display
      .show({ pluginId: WAIVERS_PLUGIN_ID, path: WAIVERS_DISPLAY_PAGE_PATH, params: { host: hostId } })
      .catch(() => false)
    if (shown) setSent(true)
    else setDisplayError('The customer display didn’t answer. Check that it is on, or hand over this device.')
  }, [display, hostId])

  if (state.state === 'hidden') return null
  if (state.state === 'loading') return <CircularProgress size={16} aria-label="Checking the waiver" />

  const status = state.status
  const label = status ? status.label : 'Waiver not on file'
  const color = status?.signed && label === 'Waiver signed' ? 'success' : 'warning'
  const notMatched = status?.matched === false && Boolean(status.searchName)
  const needed = !status?.signed || label !== 'Waiver signed'
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
      <Chip size="small" color={color} variant={color === 'success' ? 'filled' : 'outlined'} label={label} />
      {notMatched ? (
        <Button size="small" onClick={() => setFindingByName(true)}>
          {'Find by name'}
        </Button>
      ) : null}
      {needed ? (
        <Button size="small" onClick={() => setSigning(true)}>
          {compact ? 'Sign' : 'Sign waiver'}
        </Button>
      ) : null}
      {display && needed ? (
        <Button size="small" onClick={() => void showOnDisplay()}>
          {'Customer display'}
        </Button>
      ) : null}
      {sent && needed ? (
        <>
          <Chip size="small" variant="outlined" label="Sent to the customer display" />
          <Button size="small" onClick={() => setRevision((value) => value + 1)}>
            {'Check again'}
          </Button>
        </>
      ) : null}
      {displayError ? (
        <Alert severity="warning" onClose={() => setDisplayError(null)}>
          {displayError}
        </Alert>
      ) : null}
      {findingByName && status?.searchName ? (
        <Suspense fallback={null}>
          <WaiverNameCheckDialog
            open
            hostId={hostId}
            dayKey={dayKey}
            name={status.searchName}
            onClose={() => {
              setFindingByName(false)
              setRevision((value) => value + 1)
            }}
          />
        </Suspense>
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
