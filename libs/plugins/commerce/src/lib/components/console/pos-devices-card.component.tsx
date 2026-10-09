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
import { useFirestore, useFirestoreCollection, useUser } from '@aglyn/tenant-feature-instance'
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { collection, limit, query } from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import { posDisplayCall, posReadersCall, PosRequestError } from './pos/pos-api'

interface ReaderRow {
  id: string
  label: string
  registerId: string | null
  deviceType: string | null
  serialNumber: string | null
  status: string
  livemode: boolean
}

interface ReadersAnswer {
  available: boolean
  testMode: boolean
  locationReady: boolean
  readers: ReaderRow[]
}

interface DisplayRow {
  id: string
  label: string
  createdAtMs: number
  lastSeenAtMs: number
}

export interface PosDevicesCardProps {
  hostId: string
}

const EMPTY_ADDRESS = { line1: '', line2: '', city: '', state: '', postalCode: '', country: 'US' }

/**
 * The register's hardware (AGL-3607, AGL-3608): Stripe Terminal card readers
 * — registered with the code a reader shows, bound to a register, renamed,
 * removed — and the customer displays paired to each register, which can be
 * signed out. Readers appear only where card readers are offered at all.
 */
export function PosDevicesCard({ hostId }: PosDevicesCardProps) {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { data: registerDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'registers'), limit(25)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const registers = [...(registerDocs ?? [])].sort((a: any, b: any) =>
    String(a.name ?? '').localeCompare(String(b.name ?? '')),
  )
  const [answer, setAnswer] = useState<ReadersAnswer | null>(null)
  const [displays, setDisplays] = useState<Record<string, DisplayRow[]>>({})
  const [adding, setAdding] = useState(false)
  const [code, setCode] = useState('')
  const [label, setLabel] = useState('')
  const [registerId, setRegisterId] = useState('')
  const [address, setAddress] = useState(EMPTY_ADDRESS)
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null)

  const notify = useCallback(
    (error: unknown, fallback: string) =>
      enqueueSnackbar(error instanceof PosRequestError ? error.message : fallback, {
        variant: 'warning',
        persist: false,
      }),
    [enqueueSnackbar],
  )

  const load = useCallback(
    async (refresh = false) => {
      if (!user) return
      try {
        setAnswer(await posReadersCall<ReadersAnswer>(user, { action: 'list', hostId, refresh }))
      } catch {
        setAnswer(null)
      }
    },
    [user, hostId],
  )
  const uid = user?.uid ?? ''
  useEffect(() => {
    void load(true)
    // Keyed on the person, not the session object (see the register page).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, hostId])

  const registerIds = registers.map((register: any) => register.$id).join(',')
  useEffect(() => {
    if (!user || !registerIds) return
    let active = true
    void Promise.all(
      registerIds.split(',').map(async (id) => {
        const result = await posDisplayCall<{ displays: DisplayRow[] }>(user, {
          action: 'displays',
          hostId,
          registerId: id,
        }).catch(() => ({ displays: [] as DisplayRow[] }))
        return [id, result.displays] as const
      }),
    ).then((entries) => {
      if (active) setDisplays(Object.fromEntries(entries))
    })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, hostId, registerIds])

  const registerName = (id: string | null) =>
    registers.find((register: any) => register.$id === id)?.name ?? null

  const addReader = async () => {
    if (!user) return
    setBusy(true)
    try {
      await posReadersCall(user, {
        action: 'register',
        hostId,
        registrationCode: code.trim(),
        label: label.trim(),
        ...(registerId ? { registerId } : {}),
        ...(answer?.locationReady ? {} : { address }),
      })
      setAdding(false)
      setCode('')
      setLabel('')
      setRegisterId('')
      await load()
    } catch (error) {
      notify(error, 'The reader could not be added')
    } finally {
      setBusy(false)
    }
  }

  const readers = answer?.readers ?? []
  const showReaders = Boolean(answer?.available)

  return (
    <CardDisplay
      header={'POS devices'}
      help={pluginDocsHelp('pos', { anchor: '#card-readers' })}
      HeaderProps={
        showReaders
          ? {
              action: (
                <Button size="small" onClick={() => setAdding(true)}>
                  {'Add card reader'}
                </Button>
              ),
            }
          : undefined
      }
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        {showReaders ? (
          <Stack spacing={1}>
            <Typography variant="subtitle2">{'Card readers'}</Typography>
            {readers.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {answer?.testMode
                  ? 'No card readers yet. In test mode, add one with the code "simulated-wpe" to try a simulated reader.'
                  : 'No card readers yet. Add a Stripe Reader S700 or BBPOS WisePOS E with the code it shows on screen.'}
              </Typography>
            ) : (
              readers.map((reader) => (
                <Stack
                  key={reader.id}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
                >
                  <Typography variant="body2" sx={{ flex: 1, minWidth: 160 }}>
                    {reader.label}
                    <Typography component="span" variant="caption" color="text.secondary">
                      {` · ${registerName(reader.registerId) ?? 'Any register'}` +
                        (reader.livemode ? '' : ' · test')}
                    </Typography>
                  </Typography>
                  <Chip
                    size="small"
                    label={reader.status === 'online' ? 'Online' : 'Offline'}
                    color={reader.status === 'online' ? 'success' : 'default'}
                  />
                  <TextField
                    select
                    size="small"
                    label="Register"
                    value={reader.registerId ?? ''}
                    onChange={async (event) => {
                      if (!user) return
                      try {
                        await posReadersCall(user, {
                          action: 'update',
                          hostId,
                          readerId: reader.id,
                          registerId: event.target.value,
                        })
                        await load()
                      } catch (error) {
                        notify(error, 'The reader could not be updated')
                      }
                    }}
                    sx={{ minWidth: 140 }}
                  >
                    <MenuItem value="">{'Any register'}</MenuItem>
                    {registers.map((register: any) => (
                      <MenuItem key={register.$id} value={register.$id}>
                        {register.name}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Button
                    size="small"
                    onClick={() => setRenaming({ id: reader.id, label: reader.label })}
                  >
                    {'Rename'}
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    onClick={async () => {
                      const confirmed = await confirm({
                        title: 'Remove this card reader?',
                        description:
                          `"${reader.label}" is removed from your account and stops taking payments. ` +
                          'To use it again, register it with a new code.',
                        confirmationText: 'Remove',
                        confirmationButtonProps: { color: 'error' },
                      })
                        .then(() => true)
                        .catch(() => false)
                      if (!confirmed || !user) return
                      try {
                        await posReadersCall(user, { action: 'remove', hostId, readerId: reader.id })
                        await load()
                      } catch (error) {
                        notify(error, 'The reader could not be removed')
                      }
                    }}
                  >
                    {'Remove'}
                  </Button>
                </Stack>
              ))
            )}
          </Stack>
        ) : null}
        <Stack spacing={1}>
          <Typography variant="subtitle2">{'Customer displays and kiosks'}</Typography>
          <Typography variant="body2" color="text.secondary">
            {'Pair a tablet from the register: tap Pair display, choose Customer display or Self-service kiosk, and enter the code on the tablet.'}
          </Typography>
          {registers.flatMap((register: any) =>
            (displays[register.$id] ?? []).map((display) => (
              <Stack key={`${register.$id}:${display.id}`} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="body2" sx={{ flex: 1 }}>
                  {`${display.label} · ${register.name}`}
                </Typography>
                <Chip
                  size="small"
                  label={Date.now() - display.lastSeenAtMs < 120_000 ? 'Connected' : 'Not connected'}
                  color={Date.now() - display.lastSeenAtMs < 120_000 ? 'success' : 'default'}
                />
                <Button
                  size="small"
                  color="error"
                  onClick={async () => {
                    if (!user) return
                    try {
                      await posDisplayCall(user, {
                        action: 'revoke',
                        hostId,
                        registerId: register.$id,
                        displayId: display.id,
                      })
                      setDisplays((prev) => ({
                        ...prev,
                        [register.$id]: (prev[register.$id] ?? []).filter((entry) => entry.id !== display.id),
                      }))
                    } catch (error) {
                      notify(error, 'The display could not be signed out')
                    }
                  }}
                >
                  {'Sign out'}
                </Button>
              </Stack>
            )),
          )}
        </Stack>
      </Stack>

      <Dialog open={Boolean(renaming)} onClose={() => setRenaming(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{'Rename card reader'}</DialogTitle>
        <DialogContent>
          <TextField
            label="Name"
            value={renaming?.label ?? ''}
            onChange={(event) => setRenaming((prev) => (prev ? { ...prev, label: event.target.value } : prev))}
            fullWidth
            autoFocus
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenaming(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            disabled={!renaming?.label.trim()}
            onClick={async () => {
              if (!renaming || !user) return
              try {
                await posReadersCall(user, {
                  action: 'update',
                  hostId,
                  readerId: renaming.id,
                  label: renaming.label.trim(),
                })
                setRenaming(null)
                await load()
              } catch (error) {
                notify(error, 'The reader could not be renamed')
              }
            }}
          >
            {'Save'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={adding} onClose={() => setAdding(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{'Add a card reader'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {'On the reader, open Settings and choose Generate pairing code, then enter the code it shows.'}
          </Typography>
          <TextField
            label="Registration code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoFocus
            slotProps={{ htmlInput: { autoComplete: 'off' } }}
          />
          <TextField label="Name" placeholder="Front counter reader" value={label} onChange={(event) => setLabel(event.target.value)} />
          <TextField select label="Register" value={registerId} onChange={(event) => setRegisterId(event.target.value)}>
            <MenuItem value="">{'Any register'}</MenuItem>
            {registers.map((register: any) => (
              <MenuItem key={register.$id} value={register.$id}>
                {register.name}
              </MenuItem>
            ))}
          </TextField>
          {answer && !answer.locationReady ? (
            <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
              <Typography variant="body2" color="text.secondary" sx={{ gridColumn: '1 / -1' }}>
                {'Where the reader is used. Stripe sets the reader up for this country.'}
              </Typography>
              <TextField label="Street" value={address.line1} onChange={(event) => setAddress({ ...address, line1: event.target.value })} sx={{ gridColumn: '1 / -1' }} />
              <TextField label="City" value={address.city} onChange={(event) => setAddress({ ...address, city: event.target.value })} />
              <TextField label="State" value={address.state} onChange={(event) => setAddress({ ...address, state: event.target.value })} />
              <TextField label="Postal code" value={address.postalCode} onChange={(event) => setAddress({ ...address, postalCode: event.target.value })} />
              <TextField
                label="Country"
                value={address.country}
                onChange={(event) => setAddress({ ...address, country: event.target.value.toUpperCase().slice(0, 2) })}
              />
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAdding(false)}>{'Cancel'}</Button>
          <Button variant="contained" disabled={busy || !code.trim()} onClick={() => void addReader()}>
            {'Add reader'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
PosDevicesCard.displayName = 'PosDevicesCard'

export default PosDevicesCard
