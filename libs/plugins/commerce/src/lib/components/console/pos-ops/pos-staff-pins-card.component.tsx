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

import { pluginDocsHelp } from '@aglyn/aglyn'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { collection, limit, query } from 'firebase/firestore'
import { useFirestore, useFirestoreCollection, useUser } from '@aglyn/tenant-feature-instance'
import { useCallback, useEffect, useState } from 'react'
import { posPinProblem } from '../../../model/commerce-pos-ops'
import { callPosOps } from './pos-ops-api'

export interface PosStaffPinsCardProps {
  hostId: string
}

/**
 * Staff PINs (AGL-3609). Each member who works the register sets their own
 * 4–6 digit PIN here; it switches the cashier on a shared tablet without
 * signing anybody out, and it never grants more than that member's role. A
 * workspace admin can reset or remove anyone's — which also lifts a lockout.
 */
export function PosStaffPinsCard(props: PosStaffPinsCardProps) {
  const { hostId } = props
  const { data: user } = useUser()
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  // PINs are for registers: a store with none has nothing to switch.
  const { data: registers, status: registersStatus } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'registers'), limit(1)),
    [firestore, hostId],
  )
  const { confirm } = useConfirmationContext()
  const [hasPin, setHasPin] = useState<boolean | null>(null)
  const [isManager, setIsManager] = useState(false)
  const [roster, setRoster] = useState<Array<{ uid: string; name: string }>>([])
  const [editing, setEditing] = useState<{ uid: string | null; name: string } | null>(null)
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')

  const load = useCallback(async () => {
    if (!user) return
    const status = await callPosOps<{ hasPin?: boolean; isManager?: boolean }>(user, 'pos-staff-pin', {
      hostId,
      action: 'status',
    })
    if (!status.ok) {
      setRefusal(status.body.error ?? '')
      return
    }
    setRefusal('')
    setHasPin(Boolean(status.body.hasPin))
    setIsManager(Boolean(status.body.isManager))
    if (status.body.isManager) {
      const answer = await callPosOps<{ members?: Array<{ uid: string; name: string }> }>(
        user,
        'pos-staff-pin',
        { hostId, action: 'roster' },
      )
      setRoster(answer.ok ? (answer.body.members ?? []) : [])
    }
  }, [user, hostId])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    const problem = posPinProblem(pin)
    if (problem) return setError(problem)
    if (pin !== confirmPin) return setError('The two PINs do not match.')
    setBusy(true)
    const answer = await callPosOps(user, 'pos-staff-pin', {
      hostId,
      action: 'set',
      pin,
      ...(editing?.uid ? { memberUid: editing.uid } : {}),
    })
    setBusy(false)
    if (!answer.ok) return setError(answer.body.error ?? 'Could not save the PIN.')
    enqueueSnackbar(editing?.uid ? `PIN reset for ${editing.name}` : 'Your PIN is set', {
      variant: 'success',
      persist: false,
    })
    setEditing(null)
    void load()
  }

  const remove = (uid: string | null, name: string) => async () => {
    const confirmed = await confirm({
      title: uid ? `Remove ${name}'s PIN?` : 'Remove your PIN?',
      description: 'They will not be able to switch in at the register until a PIN is set again.',
      confirmationText: 'Remove',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    const answer = await callPosOps(user, 'pos-staff-pin', {
      hostId,
      action: 'clear',
      ...(uid ? { memberUid: uid } : {}),
    })
    if (!answer.ok) {
      enqueueSnackbar(answer.body.error ?? 'Could not remove the PIN.', { variant: 'warning', persist: false })
      return
    }
    void load()
  }

  const startEdit = (uid: string | null, name: string) => () => {
    setEditing({ uid, name })
    setPin('')
    setConfirmPin('')
    setError('')
  }

  if (registersStatus === 'success' && !registers?.length) return null

  return (
    <CardDisplay
      header={'Staff PINs'}
      help={pluginDocsHelp('posOperations', { anchor: '#staff-pins' })}
      HeaderProps={{
        action:
          hasPin === null ? null : (
            <Button size="small" onClick={startEdit(null, 'you')}>
              {hasPin ? 'Change my PIN' : 'Set my PIN'}
            </Button>
          ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1}>
        {refusal ? (
          <Typography variant="body2" color="text.secondary">
            {refusal === 'Not permitted'
              ? 'Only members who can use the register have a PIN.'
              : refusal}
          </Typography>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {hasPin
              ? 'Your PIN switches you in at a shared register. Five wrong tries lock it for 15 minutes.'
              : 'Set a 4–6 digit PIN to switch in at a shared register without signing anyone out.'}
          </Typography>
        )}
        {hasPin ? (
          <Button size="small" color="error" onClick={remove(null, 'you')} sx={{ alignSelf: 'flex-start' }}>
            {'Remove my PIN'}
          </Button>
        ) : null}
        {isManager && roster.length ? (
          <Stack spacing={0.5}>
            <Typography variant="overline">{'Staff with a PIN'}</Typography>
            {roster.map((member) => (
              <Stack key={member.uid} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                  {member.name}
                </Typography>
                <Button size="small" onClick={startEdit(member.uid, member.name)}>
                  {'Reset'}
                </Button>
                <Button size="small" color="error" onClick={remove(member.uid, member.name)}>
                  {'Remove'}
                </Button>
              </Stack>
            ))}
          </Stack>
        ) : null}
      </Stack>
      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{editing?.uid ? `Reset ${editing.name}'s PIN` : 'Your register PIN'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              autoFocus
              label="PIN"
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <TextField
              label="PIN again"
              type="password"
              inputMode="numeric"
              value={confirmPin}
              onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            {error ? <Alert severity="warning">{error}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)}>{'Cancel'}</Button>
          <Button variant="contained" disabled={busy} onClick={save}>
            {'Save PIN'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}

PosStaffPinsCard.displayName = 'PosStaffPinsCard'

export default PosStaffPinsCard
