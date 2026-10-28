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
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState, type FormEvent } from 'react'
import { formatPosHardwareCents } from '../../../model/pos-hardware'
import { PosHardwareRequestError } from './pos-hardware-api'
import {
  posHardwareAttach,
  posHardwareFindBuyer,
  posHardwareSaleStatus,
  posHardwareToAttach,
  type BuyerChoice,
  type BuyerFindResult,
  type BuyerWorkspace,
  type ToAttachRow,
} from './pos-hardware-sale-api'

type User = Parameters<typeof posHardwareSaleStatus>[0]
type Notify = (message: string, variant: 'success' | 'info' | 'warning' | 'error') => void

export interface PosHardwareBuyerProps {
  user: User
  hostId: string
  /** The sale open (or just paid) on this register, when it has a card reader. */
  saleOrderId: string | null
  notify: Notify
}

/** One choice of where the hardware goes, keyed for the radio group. */
interface Option {
  key: string
  label: string
  detail: string | null
  choice: BuyerChoice
}

function newKey(): string {
  return `attach-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** The ways one workspace can take the hardware: each store, or the store chosen at setup. */
function workspaceOptions(uid: string, workspace: BuyerWorkspace, who: string): Option[] {
  const plan = workspace.posPlan ? null : 'No point of sale plan yet: they add it when they set the reader up'
  return [
    ...workspace.stores.map((store) => ({
      key: `${uid}:${workspace.orgId}:${store.hostId}`,
      label: `${who} · ${workspace.name} · ${store.name}`,
      detail:
        [plan, store.hasLocation ? null : 'No card reader location on this store yet'].filter(Boolean).join('. ') ||
        null,
      choice: { uid, orgId: workspace.orgId, hostId: store.hostId },
    })),
    {
      key: `${uid}:${workspace.orgId}:`,
      label: `${who} · ${workspace.name} · choose the store at setup`,
      detail: plan,
      choice: { uid, orgId: workspace.orgId },
    },
  ]
}

/** Every option an answer offers, people first. */
function optionsOf(found: BuyerFindResult): Option[] {
  const options: Option[] = []
  for (const person of found.people) {
    const who = `${person.name || 'No name'} (${person.email})`
    if (!person.workspaces.length) {
      options.push({
        key: `${person.uid}::`,
        label: `${who} · no workspace yet`,
        detail: 'It joins the workspace they create.',
        choice: { uid: person.uid },
      })
    }
    for (const workspace of person.workspaces) options.push(...workspaceOptions(person.uid, workspace, who))
  }
  for (const workspace of found.workspaces) {
    if (!workspace.owner) continue
    const who = `${workspace.owner.name || 'Owner'} (${workspace.owner.email})`
    for (const option of workspaceOptions(workspace.owner.uid, workspace, who)) {
      if (!options.some((held) => held.key === option.key)) options.push(option)
    }
  }
  return options
}

/**
 * Finding the buyer and saying whose the card reader is (AGL-4038): by an
 * exact email, a person's name or a workspace's name. Shows the least that
 * picks the right person — a name, a masked address, each workspace and its
 * stores, and what each still needs — and, for an address with no account,
 * offers to sell anyway and invite them.
 */
function AttachDialog(props: {
  user: User
  hostId: string
  target: { registerOrderId: string } | { orderId: string; row: ToAttachRow }
  onClose: () => void
  onAttached: (message: string) => void
  notify: Notify
}) {
  const { user, hostId, target, onClose, onAttached, notify } = props
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<BuyerFindResult | null>(null)
  const [searched, setSearched] = useState('')
  const [chosen, setChosen] = useState('')
  const [busy, setBusy] = useState(false)
  const [attemptKey] = useState(newKey)
  const options = found ? optionsOf(found) : []

  const search = async (event?: FormEvent) => {
    event?.preventDefault()
    const text = query.trim()
    if (text.length < 2) return
    setBusy(true)
    try {
      setFound(await posHardwareFindBuyer(user, hostId, text))
      setSearched(text)
      setChosen('')
    } catch (caught) {
      notify(caught instanceof PosHardwareRequestError ? caught.message : 'The lookup did not answer', 'warning')
    } finally {
      setBusy(false)
    }
  }

  const attach = async (choice: BuyerChoice) => {
    setBusy(true)
    try {
      const answer = await posHardwareAttach(user, attemptKey, {
        hostId,
        buyer: choice,
        ...('registerOrderId' in target ? { registerOrderId: target.registerOrderId } : { orderId: target.orderId }),
      })
      onAttached(
        answer.outcome === 'waiting'
          ? 'Buyer attached. The card reader joins their workspace as soon as the sale is paid.'
          : answer.outcome === 'attached'
            ? 'Card reader attached to the buyer’s workspace.'
            : 'email' in choice
              ? 'Invitation sent. The card reader joins their workspace when they sign up.'
              : 'Attached to their account. It joins the workspace they create.',
      )
    } catch (caught) {
      notify(caught instanceof PosHardwareRequestError ? caught.message : 'The card reader could not be attached', 'warning')
    } finally {
      setBusy(false)
    }
  }

  const option = options.find((candidate) => candidate.key === chosen)
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{'Who is the card reader for?'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {'row' in target ? (
          <Typography variant="body2" color="text.secondary">
            {`${target.row.lines.map((line) => `${line.quantity} × ${line.name}`).join(', ')} · ${formatPosHardwareCents(target.row.totalCents)}`}
          </Typography>
        ) : null}
        <Stack component="form" direction="row" spacing={1} onSubmit={search} sx={{ mt: 1 }}>
          <TextField
            label="Email, name or workspace"
            size="small"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            sx={{ flex: 1 }}
            autoFocus
          />
          <Button type="submit" variant="outlined" disabled={busy || query.trim().length < 2}>
            {'Search'}
          </Button>
        </Stack>
        {found?.noAccount ? (
          <Alert
            severity="info"
            action={
              <Button disabled={busy} onClick={() => void attach({ email: searched })}>
                {'Invite them'}
              </Button>
            }
          >
            {`No account uses ${searched}. Sell anyway: we email them an invitation, and the card reader joins their workspace when they sign up.`}
          </Alert>
        ) : null}
        {found && !found.noAccount && !options.length ? (
          <Typography variant="body2" color="text.secondary">
            {'Nobody matches. Try their exact email address.'}
          </Typography>
        ) : null}
        {options.length ? (
          <RadioGroup value={chosen} onChange={(event) => setChosen(event.target.value)} aria-label="Buyer">
            {options.map((candidate) => (
              <FormControlLabel
                key={candidate.key}
                value={candidate.key}
                control={<Radio size="small" />}
                label={
                  <Stack>
                    <Typography variant="body2">{candidate.label}</Typography>
                    {candidate.detail ? (
                      <Typography variant="caption" color="text.secondary">
                        {candidate.detail}
                      </Typography>
                    ) : null}
                  </Stack>
                }
              />
            ))}
          </RadioGroup>
        ) : null}
        <Typography variant="caption" color="text.secondary">
          {'Every lookup is recorded. Ask the buyer before you search for them.'}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Cancel'}</Button>
        <Button variant="contained" disabled={busy || !option} onClick={() => option && void attach(option.choice)}>
          {'Attach'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/**
 * The To attach list (AGL-4038): card readers sold here that nobody has said
 * whose they are yet — at the kiosk, while the register was offline, or to a
 * buyer with no account or no workspace yet — newest first.
 */
function ToAttachDialog(props: {
  user: User
  hostId: string
  onClose: () => void
  onPick: (row: ToAttachRow) => void
  notify: Notify
}) {
  const { user, hostId, onClose, onPick, notify } = props
  const [rows, setRows] = useState<ToAttachRow[] | null>(null)
  useEffect(() => {
    let live = true
    posHardwareToAttach(user, hostId)
      .then((answer) => live && setRows(answer.orders))
      .catch((caught) => {
        if (!live) return
        setRows([])
        notify(caught instanceof PosHardwareRequestError ? caught.message : 'The list could not be read', 'warning')
      })
    return () => {
      live = false
    }
  }, [user, hostId, notify])
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{'Card reader sales to attach'}</DialogTitle>
      <DialogContent>
        {rows && !rows.length ? (
          <Typography variant="body2" color="text.secondary">
            {'Every card reader sold here is attached to its buyer.'}
          </Typography>
        ) : null}
        <List dense>
          {(rows ?? []).map((row) => (
            <ListItem
              key={row.id}
              secondaryAction={
                <Button size="small" onClick={() => onPick(row)}>
                  {'Attach'}
                </Button>
              }
            >
              <ListItemText
                primary={`${row.lines.map((line) => `${line.quantity} × ${line.name}`).join(', ')} · ${formatPosHardwareCents(row.totalCents)}`}
                secondary={[
                  row.registerNumber ? `Sale #${row.registerNumber}` : row.number,
                  new Date(row.createdAtMs).toLocaleString(),
                  row.kiosk ? 'at the kiosk' : null,
                  row.offline ? 'rung offline' : null,
                  row.invited ? `invited ${row.contactEmail ?? ''}`.trim() : row.contactEmail,
                  row.awaitingWorkspace ? 'has an account, no workspace yet' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            </ListItem>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Close'}</Button>
      </DialogActions>
    </Dialog>
  )
}

/**
 * Selling a card reader at the platform's own store's register (AGL-4038):
 * on a sale that has one, the buyer is attached here, and every reader sold
 * without one waits on the To attach list. Draws nothing on any store but
 * the platform's own hardware seller. Loaded on its own, by the register.
 */
function PosHardwareBuyer(props: PosHardwareBuyerProps) {
  const { user, hostId, saleOrderId, notify } = props
  const [seller, setSeller] = useState(false)
  const [dialog, setDialog] = useState<
    null | { kind: 'list' } | { kind: 'sale' } | { kind: 'entry'; row: ToAttachRow }
  >(null)
  const [attached, setAttached] = useState<{ orderId: string; message: string } | null>(null)

  useEffect(() => {
    let live = true
    posHardwareSaleStatus(user, hostId)
      .then((status) => live && setSeller(status.seller))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [user, hostId])

  if (!seller) return null
  const attachedHere = attached && attached.orderId === saleOrderId ? attached : null
  return (
    <Stack spacing={1} sx={{ mt: 1 }}>
      {saleOrderId ? (
        <Alert
          severity={attachedHere ? 'success' : 'info'}
          action={
            <Button size="small" onClick={() => setDialog({ kind: 'sale' })}>
              {attachedHere ? 'Change' : 'Attach buyer'}
            </Button>
          }
        >
          {attachedHere?.message ?? 'This sale has a card reader. Attach it to the buyer’s workspace.'}
        </Alert>
      ) : null}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Chip size="small" variant="outlined" label="Card reader sales" />
        <Button size="small" onClick={() => setDialog({ kind: 'list' })}>
          {'To attach'}
        </Button>
      </Stack>
      {dialog?.kind === 'list' ? (
        <ToAttachDialog
          user={user}
          hostId={hostId}
          notify={notify}
          onClose={() => setDialog(null)}
          onPick={(row) => setDialog({ kind: 'entry', row })}
        />
      ) : null}
      {dialog?.kind === 'sale' && saleOrderId ? (
        <AttachDialog
          user={user}
          hostId={hostId}
          target={{ registerOrderId: saleOrderId }}
          notify={notify}
          onClose={() => setDialog(null)}
          onAttached={(message) => {
            setAttached({ orderId: saleOrderId, message })
            setDialog(null)
            notify(message, 'success')
          }}
        />
      ) : null}
      {dialog?.kind === 'entry' ? (
        <AttachDialog
          user={user}
          hostId={hostId}
          target={{ orderId: dialog.row.id, row: dialog.row }}
          notify={notify}
          onClose={() => setDialog(null)}
          onAttached={(message) => {
            setDialog({ kind: 'list' })
            notify(message, 'success')
          }}
        />
      ) : null}
    </Stack>
  )
}

export default PosHardwareBuyer
