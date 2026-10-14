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
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useCallback, useState, type ReactNode } from 'react'
import * as CommerceModel from '../../../model'
import { posDisplayCall, PosRequestError } from './pos-api'

type User = Parameters<typeof posDisplayCall>[0]

/** A code on screen, and the register and kind of device it pairs. */
export interface PosPairingState {
  registerId: string
  registerName?: string
  mode: CommerceModel.PosDeviceMode
  code: string
  expiresAtMs: number
}

/**
 * A fresh six-digit code that pairs a tablet to one register, as a customer
 * display or a self-service kiosk (AGL-3608, AGL-3623). The server holds the
 * gate: the register's role and `managePos` checks and the plan's `pos`.
 */
export function requestPosPairingCode(
  user: User,
  hostId: string,
  registerId: string,
  mode: CommerceModel.PosDeviceMode = 'display',
): Promise<{ code: string; expiresAtMs: number }> {
  return posDisplayCall<{ code: string; expiresAtMs: number }>(user, {
    action: 'pairing-code',
    hostId,
    registerId,
    mode,
  })
}

/** The address a tablet opens to enter the code. */
export function posPairingAddress(mode: CommerceModel.PosDeviceMode): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  return `${origin}/kiosk/commerce/${mode === 'kiosk' ? 'pos-kiosk' : 'pos-display'}`
}

const TTL_MINUTES = Math.round(CommerceModel.POS_DISPLAY_PAIRING_TTL_MS / 60_000)

export interface PosPairingDialogProps {
  pairing: PosPairingState | null
  onModeChange: (mode: CommerceModel.PosDeviceMode) => void
  onClose: () => void
}

/** The code, the address to enter it at, and the display-or-kiosk choice. */
export function PosPairingDialog({ pairing, onModeChange, onClose }: PosPairingDialogProps) {
  const mode = pairing?.mode ?? 'display'
  return (
    <Dialog open={Boolean(pairing)} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        {mode === 'kiosk' ? 'Pair a self-service kiosk' : 'Pair a customer display'}
        {pairing?.registerName ? (
          <Typography component="span" variant="body2" color="text.secondary" sx={{ display: 'block' }}>
            {`For ${pairing.registerName}`}
          </Typography>
        ) : null}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <ToggleButtonGroup
          exclusive
          fullWidth
          size="small"
          value={mode}
          onChange={(_event, next: CommerceModel.PosDeviceMode | null) => {
            if (next && next !== mode) onModeChange(next)
          }}
          sx={{ mt: 1 }}
        >
          <ToggleButton value="display">{'Customer display'}</ToggleButton>
          <ToggleButton value="kiosk">{'Self-service kiosk'}</ToggleButton>
        </ToggleButtonGroup>
        <Typography variant="body2" color="text.secondary">
          {(mode === 'kiosk'
            ? 'On the tablet customers order from, open this address and enter the code. '
            : 'On the tablet facing your customer, open this address and enter the code. ') +
            `The code works once and expires in ${TTL_MINUTES} minutes.`}
        </Typography>
        <Typography variant="body1" sx={{ wordBreak: 'break-all' }}>
          {posPairingAddress(mode)}
        </Typography>
        <Typography variant="h3" component="p" sx={{ textAlign: 'center', letterSpacing: 8 }}>
          {pairing?.code}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Done'}</Button>
      </DialogActions>
    </Dialog>
  )
}
PosPairingDialog.displayName = 'PosPairingDialog'

export interface UsePosPairingOptions {
  user: User | null | undefined
  hostId: string
  /** Told the reason a code could not be made. */
  onError: (message: string) => void
}

/**
 * The one pairing flow, for the register and the POS devices card alike:
 * `open(registerId)` asks for a code and shows it; switching between
 * customer display and kiosk asks for a code of that kind. Render `dialog`.
 */
export function usePosPairing({ user, hostId, onError }: UsePosPairingOptions): {
  pairing: PosPairingState | null
  open: (registerId: string, mode?: CommerceModel.PosDeviceMode, registerName?: string) => Promise<void>
  close: () => void
  dialog: ReactNode
} {
  const [pairing, setPairing] = useState<PosPairingState | null>(null)

  const open = useCallback(
    async (registerId: string, mode: CommerceModel.PosDeviceMode = 'display', registerName?: string) => {
      if (!user || !registerId) return
      try {
        const answer = await requestPosPairingCode(user, hostId, registerId, mode)
        setPairing({ ...answer, registerId, mode, ...(registerName ? { registerName } : {}) })
      } catch (error) {
        onError(error instanceof PosRequestError ? error.message : 'Could not make a code')
      }
    },
    [user, hostId, onError],
  )
  const close = useCallback(() => setPairing(null), [])

  const dialog = (
    <PosPairingDialog
      pairing={pairing}
      onClose={close}
      onModeChange={(mode) => {
        if (pairing) void open(pairing.registerId, mode, pairing.registerName)
      }}
    />
  )
  return { pairing, open, close, dialog }
}

/** The element id the POS registers card carries, for a link that lands on it. */
export const POS_REGISTERS_ANCHOR = 'pos-registers'

/**
 * Where a register is created — the POS registers card, under Products →
 * Settings — from the register page's own console path (`…/pos`). Undefined
 * when that path is not the register's.
 */
export function posRegistersSettingsHref(posBasePath: string | undefined): string | undefined {
  if (!posBasePath || !/\/pos\/?$/.test(posBasePath)) return undefined
  return `${posBasePath.replace(/\/pos\/?$/, '/products/settings')}#${POS_REGISTERS_ANCHOR}`
}
