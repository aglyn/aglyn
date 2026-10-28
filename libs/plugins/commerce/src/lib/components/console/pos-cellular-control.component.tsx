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

import { BlockedControl } from '@aglyn/shared-ui-jsx/components/blocked-control.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import type { PosCellularView } from '../../model/pos-cellular'
import { posReadersCall, PosRequestError, usd } from './pos/pos-api'

export interface PosCellularControlProps {
  hostId: string
  cellular: PosCellularView
  /** Why the viewer may not change it ("Registers and devices"), or null. */
  blocked: string | null
  /** Reload the card once it changed. */
  onChanged: () => void | Promise<void>
}

const readersText = (count: number) => `${count} Stripe Reader S710${count === 1 ? '' : 's'}`

/**
 * 4G for a store's Stripe Reader S710s (AGL-4038), on the POS devices card.
 * Stripe turns cellular service on for a store's reader Location, so this is
 * one switch for the store: it says plainly that every S710 at the store
 * gets 4G and that each one is charged, and turning it on takes an explicit
 * agreement to the monthly price. Turning it ON is charged to the workspace,
 * so it also takes "Manage billing": without it the control says so rather
 * than hiding. A store whose 4G was turned off for an unpaid month says
 * which, and how to turn it back on. Loaded only where 4G is offered and the
 * store has an S710.
 */
export function PosCellularControl({ hostId, cellular, blocked, onChanged }: PosCellularControlProps) {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [dialog, setDialog] = useState<'on' | 'off' | null>(null)
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const price = usd(cellular.readerMonthlyCents)
  // Off needs only the card's key; on is charged to the workspace, so billing too.
  const reason = blocked ?? (cellular.enabled ? null : (cellular.turnOnBlocked ?? null))

  const change = async (enabled: boolean) => {
    if (!user) return
    setBusy(true)
    try {
      await posReadersCall(user, { action: 'cellular', hostId, enabled, ...(enabled ? { consent: agreed } : {}) })
      setDialog(null)
      setAgreed(false)
      enqueueSnackbar(enabled ? '4G is on for this store’s S710 readers' : '4G is off for this store', {
        variant: 'success',
        persist: false,
      })
      await onChanged()
    } catch (error) {
      enqueueSnackbar(error instanceof PosRequestError ? error.message : '4G could not be changed. Try again.', {
        variant: 'warning',
        persist: false,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
      <Box sx={{ flex: 1, minWidth: 220 }}>
        <Typography variant="body2" sx={{ fontWeight: 'fontWeightMedium' }}>
          {'4G (cellular)'}
        </Typography>
        <Typography variant="caption" color="text.secondary" component="p">
          {cellular.enabled
            ? `On for every Stripe Reader S710 at this store (${readersText(cellular.readers)} now). Each is charged ${price} a month.`
            : `A Stripe Reader S710 can use Stripe's 4G service when Wi-Fi drops. It turns on for every S710 at this store, at ${price} a month each.`}
        </Typography>
      </Box>
      <Chip size="small" label={cellular.enabled ? 'On' : 'Off'} color={cellular.enabled ? 'success' : 'default'} />
      <BlockedControl blocked={Boolean(reason)} reason={reason ?? ''}>
        <Button size="small" onClick={() => setDialog(cellular.enabled ? 'off' : 'on')}>
          {cellular.enabled ? 'Turn off 4G' : 'Turn on 4G'}
        </Button>
      </BlockedControl>
      {cellular.suspended ? (
        <Alert severity="warning" sx={{ flexBasis: '100%' }}>
          {`4G was turned off because the 4G charge for ${cellular.suspended.month} wasn't paid. Pay it on the Billing page, then turn 4G on again here.`}
        </Alert>
      ) : null}

      <Dialog open={dialog === 'on'} onClose={() => (busy ? undefined : setDialog(null))} maxWidth="sm" fullWidth>
        <DialogTitle>{'Turn on 4G for this store?'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography variant="body2">
            {`Every Stripe Reader S710 at this store gets Stripe's 4G service and uses it whenever Wi-Fi and Ethernet are not available. That is ${readersText(cellular.readers)} now, and any S710 you add here later.`}
          </Typography>
          <Typography variant="body2">
            {`Each S710 is charged ${price} a month, plus any sales tax, for every calendar month it has 4G. The charge goes to this workspace's card at the start of the next month. Turning 4G off stops the charge from the next month. If a month's charge isn't paid, 4G is turned off after a grace period, until it's paid and turned on again.`}
          </Typography>
          <FormControlLabel
            control={<Checkbox checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />}
            label={`I agree to ${price} a month for each Stripe Reader S710 at this store while 4G is on.`}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)} disabled={busy}>
            {'Cancel'}
          </Button>
          <Button variant="contained" disabled={busy || !agreed} onClick={() => void change(true)}>
            {'Turn on 4G'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialog === 'off'} onClose={() => (busy ? undefined : setDialog(null))} maxWidth="xs" fullWidth>
        <DialogTitle>{'Turn off 4G?'}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {'The S710 readers at this store stop using 4G the next time they connect, and use Wi-Fi or Ethernet only. This month is still charged for each reader that had 4G in it.'}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)} disabled={busy}>
            {'Cancel'}
          </Button>
          <Button variant="contained" disabled={busy} onClick={() => void change(false)}>
            {'Turn off 4G'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
PosCellularControl.displayName = 'PosCellularControl'

export default PosCellularControl
