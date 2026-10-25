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
import { useTheme } from '@mui/material/styles'
import { useCallback, useEffect, useState } from 'react'
import { WAIVERS_API_ROUTES } from '../constants/bundle-common'
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

/**
 * A customer's waiver at check-in (AGL-4042): "Waiver signed", "Signed for
 * 2 of 3 riders" or "Waiver needed", with Sign waiver opening the signing
 * form on this device, as at the window. Draws nothing for a member who may
 * not see signatures (the route refuses them), so the register never shows
 * a control they could not use.
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
