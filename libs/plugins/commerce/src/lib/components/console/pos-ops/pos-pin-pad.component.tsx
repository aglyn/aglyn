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
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useCallback, useEffect, useState } from 'react'
import { callPosOps } from './pos-ops-api'

/** What a right PIN buys: a signed statement that this member is at this register. */
export interface PosStaffAssertion {
  assertion: string
  expiresAtMs: number
  memberUid: string
  name: string
  purpose: 'cashier' | 'manager'
}

export interface PosPinPadProps {
  open: boolean
  hostId: string
  registerId: string
  /** `cashier` switches who is ringing; `manager` approves one action. */
  purpose: 'cashier' | 'manager'
  title?: string
  /** Why a manager is being asked, shown above the pad. */
  prompt?: string
  /** A lock screen cannot be dismissed without a PIN. */
  dismissible?: boolean
  onClose: () => void
  onVerified: (assertion: PosStaffAssertion) => void
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'] as const

/**
 * The PIN pad (AGL-3609): pick your name, tap your PIN. Built for a tablet —
 * every key a full-size button — and for a keyboard, which types digits,
 * Backspace and Enter straight into it.
 */
export function PosPinPad(props: PosPinPadProps) {
  const { open, hostId, registerId, purpose, onClose, onVerified } = props
  const { data: user } = useUser()
  const [members, setMembers] = useState<Array<{ uid: string; name: string }> | null>(null)
  const [memberUid, setMemberUid] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || !user) return
    let active = true
    setPin('')
    setError('')
    void callPosOps<{ members?: Array<{ uid: string; name: string }> }>(user, 'pos-staff-pin', {
      hostId,
      action: 'roster',
    }).then((answer) => {
      if (!active) return
      if (!answer.ok) {
        setError(answer.body.error ?? 'Could not load the staff list.')
        setMembers([])
        return
      }
      const list = answer.body.members ?? []
      setMembers(list)
      if (list.length === 1) setMemberUid(list[0]!.uid)
    })
    return () => {
      active = false
    }
  }, [open, user, hostId])

  const submit = useCallback(
    async (value: string) => {
      if (!memberUid || value.length < 4 || busy) return
      setBusy(true)
      setError('')
      const answer = await callPosOps<Partial<PosStaffAssertion>>(user, 'pos-staff-pin', {
        hostId,
        registerId,
        action: 'verify',
        purpose,
        memberUid,
        pin: value,
      })
      setBusy(false)
      setPin('')
      if (!answer.ok || !answer.body.assertion) {
        setError(answer.body.error ?? 'That PIN did not work.')
        return
      }
      onVerified(answer.body as PosStaffAssertion)
    },
    [memberUid, busy, user, hostId, registerId, purpose, onVerified],
  )

  const press = useCallback(
    (key: (typeof KEYS)[number] | 'enter') => {
      if (key === 'clear') return setPin('')
      if (key === 'back') return setPin((value) => value.slice(0, -1))
      if (key === 'enter') return void submit(pin)
      setPin((value) => (value.length >= 6 ? value : value + key))
    },
    [pin, submit],
  )

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (/^\d$/.test(event.key)) press(event.key as (typeof KEYS)[number])
    else if (event.key === 'Backspace') press('back')
    else if (event.key === 'Enter') press('enter')
  }

  // A lock nobody can open is no lock: with no PINs set on the site, the
  // pad can always be closed.
  const dismissible = props.dismissible !== false || (members !== null && members.length === 0)
  return (
    <Dialog
      open={open}
      onClose={dismissible ? onClose : undefined}
      maxWidth="xs"
      fullWidth
      onKeyDown={onKeyDown}
    >
      <DialogTitle>
        {props.title ?? (purpose === 'manager' ? 'Manager approval' : 'Switch cashier')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {props.prompt ? (
            <Typography variant="body2" color="text.secondary">
              {props.prompt}
            </Typography>
          ) : null}
          {members && members.length === 0 && !error ? (
            <Alert severity="info">
              {'Nobody has a register PIN on this site yet. Set yours under Commerce → ' +
                'Settings → Staff PINs.'}
            </Alert>
          ) : null}
          <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
            {(members ?? []).map((member) => (
              <Chip
                key={member.uid}
                label={member.name}
                color={member.uid === memberUid ? 'primary' : 'default'}
                variant={member.uid === memberUid ? 'filled' : 'outlined'}
                onClick={() => {
                  setMemberUid(member.uid)
                  setError('')
                }}
              />
            ))}
          </Stack>
          <Typography
            variant="h4"
            component="div"
            aria-label="PIN entered"
            sx={{ textAlign: 'center', letterSpacing: '0.5em', minHeight: '1.5em' }}
          >
            {'•'.repeat(pin.length) || ' '}
          </Typography>
          {error ? <Alert severity="warning">{error}</Alert> : null}
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
            {KEYS.map((key) => (
              <Button
                key={key}
                variant={key === 'clear' || key === 'back' ? 'text' : 'outlined'}
                size="large"
                disabled={busy || !memberUid}
                onClick={() => press(key)}
                aria-label={key === 'back' ? 'Delete digit' : key === 'clear' ? 'Clear' : key}
                sx={{ minHeight: 56 }}
              >
                {key === 'back' ? '⌫' : key === 'clear' ? 'Clear' : key}
              </Button>
            ))}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        {dismissible ? <Button onClick={onClose}>{'Cancel'}</Button> : null}
        <Button
          variant="contained"
          disabled={busy || !memberUid || pin.length < 4}
          onClick={() => press('enter')}
        >
          {purpose === 'manager' ? 'Approve' : 'Continue'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

PosPinPad.displayName = 'PosPinPad'

export default PosPinPad
