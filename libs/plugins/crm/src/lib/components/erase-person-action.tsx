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
  PERSON_ERASURE_NOT_REACHED,
  PERSON_ERASURE_REMOVES,
  PERSON_ERASURE_RETAINS,
  personErasureConfirmationMatches,
} from '@aglyn/aglyn'
import { mdiAccountOffOutline } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import type { RowActionsMenuItem } from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { useCanManageCrmSettings } from './settings-section'
import { useCrmApi } from './use-crm-api'

/** The record the action is offered on: which kind, its id, and its address. */
export type ErasePersonSubject =
  | { kind: 'contact'; id: string; email: string }
  | { kind: 'lead'; id: string; email: string }

export interface UseErasePersonActionProps {
  /**
   * The site the request is filed from — the route logs it on that site's
   * feed. At the organization level the record's own capturing site
   * (AGL-2630); `null` for a record no site has captured, which cannot be
   * filed from here.
   */
  hostId: string | null
  orgId: string | null | undefined
  /** Null while the record has not loaded; the item is then disabled. */
  subject: ErasePersonSubject | null
  /** The record's marker, when a request is already waiting. */
  requestedAtMs: number | null
}

export interface ErasePersonAction {
  /** Zero or one item, to spread into the record header's overflow menu. */
  menuItems: RowActionsMenuItem[]
  /** The pending banner, or null. Render it where the record's cards begin. */
  banner: ReactNode
  /** The dialog. Render it once, anywhere in the page. */
  dialog: ReactNode
  /**
   * When the waiting request was filed, or null while none waits: the
   * record's marker, or the route's answer until the listener carries the
   * marker. What a page gates its other acts on — Convert, on a lead — so
   * they close the moment the item does.
   */
  pendingSinceMs: number | null
}

/**
 * **Erase this person** on a record page (AGL-2623).
 *
 * Owned by a hook rather than a component because the overflow menu takes
 * items as data: the page spreads `menuItems` into its own list, renders
 * `banner` under the header and `dialog` at the end, and everything the
 * action knows — who may, whether a request is already waiting, what the
 * dialog says, what the route answers — lives here.
 *
 * Offered to workspace admins and owners only, and the item is present but
 * disabled for everyone else with the reason as its tooltip: an absent item
 * and an inapplicable one look alike, and a site editor who cannot find
 * the action should learn who can rather than conclude it does not exist.
 *
 * Takes the site from the page and the workspace from `useOrgDataScope`,
 * never a route, so an org-level mount can offer the same item.
 */
export function useErasePersonAction(props: UseErasePersonActionProps): ErasePersonAction {
  const { hostId, orgId, subject, requestedAtMs } = props
  const { canManage, ready } = useCanManageCrmSettings(orgId ?? undefined)
  const [open, setOpen] = useState(false)
  // The marker arrives on the record's own document, so a request filed on
  // this page shows as pending the moment the listener catches up — and,
  // until it does, the moment the route answered.
  const [filedAtMs, setFiledAtMs] = useState<number | null>(null)
  const pendingSince = requestedAtMs ?? filedAtMs

  const menuItems = useMemo<RowActionsMenuItem[]>(() => {
    const disabledReason = !subject
      ? 'The record has not loaded'
      : !hostId
        ? 'No site has captured this person to file from'
        : pendingSince
          ? 'An erasure is already pending for this person'
          : !ready
            ? 'Checking your workspace role'
            : !canManage
              ? 'Only a workspace admin can erase a person'
              : undefined
    return [
      {
        key: 'erase-person',
        label: 'Erase this person',
        icon: <MdiIcon path={mdiAccountOffOutline.path} size={0.8} />,
        destructive: true,
        disabled: Boolean(disabledReason),
        disabledReason,
        onClick: () => setOpen(true),
      },
    ]
  }, [canManage, hostId, pendingSince, ready, subject])

  const banner = pendingSince ? <ErasurePendingBanner requestedAtMs={pendingSince} /> : null
  const dialog = subject && hostId ? (
    <ErasePersonDialog
      open={open}
      onClose={() => setOpen(false)}
      hostId={hostId}
      subject={subject}
      onFiled={(atMs) => setFiledAtMs(atMs)}
    />
  ) : null

  return { menuItems, banner, dialog, pendingSinceMs: pendingSince }
}

export interface ErasurePendingBannerProps {
  requestedAtMs: number
}

/**
 * The state a record wears between the request and the run. Says when it
 * was asked and what will happen, so a reader arriving cold neither files
 * it again nor keeps working the record.
 */
export function ErasurePendingBanner(props: ErasurePendingBannerProps) {
  const { requestedAtMs } = props
  return (
    <Alert severity="warning" data-testid="erasure-pending-banner">
      <strong>{'Erasure pending. '}</strong>
      {`Requested ${new Date(requestedAtMs).toLocaleString()}. The nightly erasure ` +
        'job removes this person from every site in the workspace; until then the ' +
        'record is kept only so the request can be seen. Nothing new should be added ' +
        'to it.'}
    </Alert>
  )
}
ErasurePendingBanner.displayName = 'ErasurePendingBanner'

export interface ErasePersonDialogProps {
  open: boolean
  onClose: () => void
  hostId: string
  subject: ErasePersonSubject
  /** Called with the request's queue time once the route has filed it. */
  onFiled: (pendingSinceMs: number) => void
}

/**
 * The confirmation: everything the request removes, everything it keeps
 * and how, what it does not reach, and the two facts that follow the click
 * — the address is closed to capture at once, and the sweep runs with the
 * nightly job. The admin types the address back; the route checks the same
 * match before it files anything.
 */
export function ErasePersonDialog(props: ErasePersonDialogProps) {
  const { open, onClose, hostId, subject, onFiled } = props
  const call = useCrmApi(hostId)
  const { enqueueSnackbar } = useSnackbar()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setTyped('')
  }, [open])
  const confirmed = personErasureConfirmationMatches(typed, subject.email)

  const submit = async () => {
    if (!confirmed || busy) return
    setBusy(true)
    try {
      const { response, payload } = await call('erase-person', {
        ...(subject.kind === 'contact' ? { contactId: subject.id } : { leadId: subject.id }),
        email: typed.trim(),
      })
      if (!response.ok) {
        throw new Error(String(payload['error'] ?? 'The erasure could not be filed'))
      }
      onFiled(Number(payload['pendingSinceMs'] ?? Date.now()))
      enqueueSnackbar(
        payload['alreadyPending']
          ? 'An erasure was already pending for this person'
          : 'Erasure requested — it runs with the nightly job',
        { variant: 'success', persist: false },
      )
      onClose()
    } catch (error) {
      enqueueSnackbar(error instanceof Error ? error.message : 'The erasure could not be filed', {
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{`Erase ${subject.email} from this workspace?`}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          {'This is a privacy erasure, not a delete: the person is removed from every ' +
            'site in the workspace, whoever captured them, and it cannot be undone. ' +
            'The request is filed now and runs with the nightly erasure job; from this ' +
            'moment the address is closed, so a later form fill or order cannot ' +
            'recreate the record, and no campaign is sent to it.'}
        </DialogContentText>
        <Stack spacing={2}>
          <ListBlock heading="Removed across the workspace" lines={PERSON_ERASURE_REMOVES} />
          <ListBlock heading="Kept, with the person taken off" lines={PERSON_ERASURE_RETAINS} />
          <ListBlock heading="Not reached — finish these by hand" lines={PERSON_ERASURE_NOT_REACHED} />
          <TextField
            label="Type the email address to confirm"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            fullWidth
            autoFocus
            autoComplete="off"
            slotProps={{ htmlInput: { 'aria-label': 'Type the email address to confirm' } }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {'Cancel'}
        </Button>
        <Button
          variant="contained"
          color="error"
          onClick={() => void submit()}
          disabled={!confirmed || busy}
        >
          {busy ? 'Filing…' : 'Erase permanently'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
ErasePersonDialog.displayName = 'ErasePersonDialog'

function ListBlock(props: { heading: string; lines: readonly string[] }) {
  return (
    <div>
      <Typography variant="subtitle2">{props.heading}</Typography>
      <List dense disablePadding>
        {props.lines.map((line) => (
          <ListItem key={line} disableGutters sx={{ py: 0 }}>
            <ListItemText
              primary={line}
              slotProps={{ primary: { variant: 'body2', color: 'text.secondary' } }}
            />
          </ListItem>
        ))}
      </List>
    </div>
  )
}
