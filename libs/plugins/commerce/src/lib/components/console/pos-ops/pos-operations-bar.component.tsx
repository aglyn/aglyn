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

import { Box, Button, Chip, Stack, Typography } from '@mui/material'
import { useState } from 'react'
import { PosPinPad } from './pos-pin-pad.component'
import { PosReturnDialog } from './pos-return-dialog.component'
import { PosShiftPanel } from './pos-shift-panel.component'
import type { PosCashierState } from './use-pos-cashier'

export interface PosOperationsBarProps {
  hostId: string
  registerId: string
  registerName?: string
  cashier: PosCashierState
  /** Ring the exchange after a return: a new sale for the same customer. */
  onExchange?: (customer: { email: string | null; name: string | null }) => void
}

/**
 * The register's operations strip (AGL-3609): who is ringing (and a PIN
 * switch to someone else), the shift and drawer, returns, and the lock. Sits
 * above the basket; every control is a tablet-sized button.
 */
export function PosOperationsBar(props: PosOperationsBarProps) {
  const { hostId, registerId, cashier } = props
  const [switching, setSwitching] = useState(false)
  const [returning, setReturning] = useState(false)
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Chip
          size="small"
          variant="outlined"
          label={cashier.cashier ? `Cashier: ${cashier.cashier.name}` : 'Cashier: you'}
          {...(cashier.cashier ? { onDelete: cashier.signOutCashier } : {})}
        />
        <Button size="small" onClick={() => setSwitching(true)} disabled={!registerId}>
          {'Switch cashier'}
        </Button>
        <Button size="small" onClick={cashier.lock} disabled={!registerId}>
          {'Lock'}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="outlined" onClick={() => setReturning(true)} disabled={!registerId}>
          {'Return'}
        </Button>
      </Stack>
      {registerId ? (
        <PosShiftPanel
          hostId={hostId}
          registerId={registerId}
          {...(props.registerName ? { registerName: props.registerName } : {})}
          {...(cashier.assertion ? { cashierAssertion: cashier.assertion } : {})}
        />
      ) : null}
      <PosPinPad
        open={switching}
        hostId={hostId}
        registerId={registerId}
        purpose="cashier"
        onClose={() => setSwitching(false)}
        onVerified={(assertion) => {
          cashier.switchTo(assertion)
          setSwitching(false)
        }}
      />
      <PosPinPad
        open={cashier.locked}
        hostId={hostId}
        registerId={registerId}
        purpose="cashier"
        title="Register locked"
        prompt="Enter your PIN to use the register."
        dismissible={false}
        onClose={cashier.unlock}
        onVerified={cashier.switchTo}
      />
      <PosReturnDialog
        open={returning}
        hostId={hostId}
        registerId={registerId}
        {...(cashier.assertion ? { cashierAssertion: cashier.assertion } : {})}
        onClose={() => setReturning(false)}
        {...(props.onExchange ? { onExchange: props.onExchange } : {})}
      />
      {cashier.locked ? (
        <Typography variant="caption" color="text.secondary">
          {'Locked'}
        </Typography>
      ) : null}
    </Stack>
  )
}

PosOperationsBar.displayName = 'PosOperationsBar'

export default PosOperationsBar
