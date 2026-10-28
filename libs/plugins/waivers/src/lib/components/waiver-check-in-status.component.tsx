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

/** How often the status, and whether the display's grant is still open, are read while a rider signs on the display. */
const DISPLAY_RECHECK_MS = 5_000

/**
 * The customer display grant this row opened (AGL-4042), kept in the tab's
 * session so a reload of the register still offers **Close display**: it lasts until
 * staff close it, with no timer, so it must never be forgotten here.
 */
function displayGrantKey(hostId: string, who: string): string {
  return `aglyn.waivers.displayGrant:${hostId}:${who}`
}

function readDisplayGrant(key: string): string | null {
  try {
    const value = window.sessionStorage.getItem(key)
    return value && /^[a-f0-9]{32}$/.test(value) ? value : null
  } catch {
    return null
  }
}

function writeDisplayGrant(key: string, grantId: string | null): void {
  try {
    if (grantId) window.sessionStorage.setItem(key, grantId)
    else window.sessionStorage.removeItem(key)
  } catch {
    // A browser that refuses storage forgets it on reload; the display's own Cancel still closes it.
  }
}

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
 * display connected, Customer display puts the signing on it instead,
 * through core's customer display seam. It stays there until it is closed,
 * with no timer: **Close display** here revokes its grant on the server and takes it
 * off the display, and the display closes it itself after a signing or a
 * Cancel. Meanwhile the status is read again every few seconds, and so is
 * whether the grant is still open. Draws nothing for a member who may not see signatures (the
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
  const [displayError, setDisplayError] = useState<string | null>(null)
  const [findingByName, setFindingByName] = useState(false)
  const name = props.name?.trim() || ''
  const grantKey = displayGrantKey(hostId, email || contactId || name.toLowerCase() || 'walk-in')
  // The grant this row has open on the customer display, by its id.
  const [onDisplay, setOnDisplay] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : readDisplayGrant(grantKey),
  )
  const keepOnDisplay = useCallback(
    (grantId: string | null) => {
      writeDisplayGrant(grantKey, grantId)
      setOnDisplay(grantId)
    },
    [grantKey],
  )

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

  // While the rider signs on the display, read the status and the grant
  // again every few seconds, for as long as the grant is open: once the
  // display closes it (after a signing, or a Cancel), this row lets go.
  useEffect(() => {
    if (!onDisplay || !ready) return undefined
    let live = true
    const timer = window.setInterval(() => {
      void request<{ open: boolean }>(WAIVERS_API_ROUTES.displayGrant, {
        body: { hostId, action: 'state', grantId: onDisplay },
      })
        .then((answer) => {
          if (live && !answer.open) keepOnDisplay(null)
        })
        .catch(() => undefined)
        .finally(() => live && setRevision((value) => value + 1))
    }, DISPLAY_RECHECK_MS)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [onDisplay, ready, request, hostId, keepOnDisplay])

  const showOnDisplay = useCallback(async () => {
    if (!display) return
    setDisplayError(null)
    try {
      const { grant, grantId } = await request<{ grant: string; grantId: string }>(WAIVERS_API_ROUTES.displayGrant, {
        body: { hostId },
      })
      const shown = await display.show({
        pluginId: WAIVERS_PLUGIN_ID,
        path: WAIVERS_DISPLAY_PAGE_PATH,
        params: { host: hostId, grant },
      })
      if (!shown) {
        // Never left open behind a display that did not take it.
        await request(WAIVERS_API_ROUTES.displayGrant, { body: { hostId, action: 'close', grantId } }).catch(() => undefined)
        throw new Error('The customer display didn’t answer. Check that it is on, or hand over this device.')
      }
      keepOnDisplay(grantId)
    } catch (caught) {
      setDisplayError(caught instanceof Error ? caught.message : 'The customer display didn’t answer.')
    }
  }, [display, request, hostId, keepOnDisplay])

  // Staff close it: the grant signs no more, the display goes back.
  const closeOnDisplay = useCallback(async () => {
    if (!onDisplay) return
    setDisplayError(null)
    try {
      await request(WAIVERS_API_ROUTES.displayGrant, { body: { hostId, action: 'close', grantId: onDisplay } })
      keepOnDisplay(null)
      await display?.close?.(WAIVERS_PLUGIN_ID)
      setRevision((value) => value + 1)
    } catch (caught) {
      setDisplayError(caught instanceof Error ? caught.message : 'The customer display screen could not be closed.')
    }
  }, [onDisplay, request, hostId, keepOnDisplay, display])

  if (state.state === 'hidden') return null
  if (state.state === 'loading') return <CircularProgress size={16} aria-label="Checking the waiver" />

  const status = state.status
  const label = status ? status.label : 'Waiver not on file'
  const color = status?.signed && label === 'Waiver signed' ? 'success' : 'warning'
  const notMatched = status?.matched === false && Boolean(status.searchName)
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
      <Chip size="small" color={color} variant={color === 'success' ? 'filled' : 'outlined'} label={label} />
      {notMatched ? (
        <Button size="small" onClick={() => setFindingByName(true)}>
          {'Find by name'}
        </Button>
      ) : null}
      {!status?.signed || label !== 'Waiver signed' ? (
        <Button size="small" onClick={() => setSigning(true)}>
          {compact ? 'Sign' : 'Sign waiver'}
        </Button>
      ) : null}
      {onDisplay ? (
        <>
          <Chip size="small" variant="outlined" label="On the customer display" />
          <Button size="small" onClick={() => void closeOnDisplay()}>
            {'Close display'}
          </Button>
        </>
      ) : display && (!status?.signed || label !== 'Waiver signed') ? (
        <Button size="small" onClick={() => void showOnDisplay()}>
          {'Customer display'}
        </Button>
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
