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

/**
 * Put people from the CRM onto an email audience (AGL-2603).
 *
 * ## The same door the Emails console uses
 *
 * A list membership carries the consent basis that says why this person may
 * be mailed, and the rules make its create API-only for exactly that reason:
 * a client that could write one could mint a consent record by pressing a
 * button. So this dialog does not write a membership. It calls the two
 * routes the audience page's own add form calls — `email/list-members-preview`
 * to say, per address, what adding them would do, and `email/list-members-add`
 * to do it — with the same body and the same single attestation over the
 * count the operator was shown. Whoever is refused there is refused here, for
 * the same reason, in the same words.
 *
 * ## Check, then add
 *
 * The attestation is a statement about people, so the people are counted in
 * front of the operator before the checkbox exists: how many already opted
 * in, how many have nothing on record, how many cannot be added at all. The
 * routes take a hundred addresses a call, so a large selection is sent in
 * hundreds and the verdicts are summed — the number on screen is the whole
 * selection's, not the first page's.
 *
 * ## The audiences are a bounded lookup
 *
 * Fifty by name, the window the Emails console's own pickers use. A list is
 * org-shared, readable by an org-wide member and by nobody else, and the
 * route refuses a caller who is not one — so a collaborator scoped to one
 * site sees the listen refused and a sentence saying who manages audiences,
 * rather than an empty picker.
 */

import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { collection, limit, orderBy, query } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
  useUser,
} from '@aglyn/tenant-feature-instance'

/**
 * How many addresses one call to the membership routes takes — their
 * `readAddresses` cap. Named here because a request over it is refused
 * whole, and a refusal of the whole selection reads as nobody being addable.
 */
export const LIST_MEMBER_REQUEST_CHUNK = 100

/** The audience picker's window; the Emails console's own pickers use it. */
export const AUDIENCE_PICKER_LIMIT = 50

/** What `email/list-members-preview` answers for one address. */
interface AddressVerdict {
  input: string
  email: string | null
  refusal: string | null
  requiresAttestation: boolean
  summary: string
}

/** The preview, summed over every chunk sent. */
interface Preview {
  verdicts: AddressVerdict[]
  optedIn: number
  needAttestation: number
  refused: number
}

/** What one address's outcome was, after the add. */
interface AddResult {
  input: string
  email: string | null
  enrolled: boolean
  error?: string
}

interface AudienceRow {
  $id: string
  name?: string
  kind?: 'manual' | 'dynamic'
}

export interface AddToListDialogProps {
  open: boolean
  onClose: () => void
  hostId: string
  /** `['orgs', orgId]`, or `null` while the org is still being resolved. */
  scope: readonly [string, string] | null
  /** The people to add — a selection's addresses, or one person's. */
  emails: readonly string[]
  /** Called once with how many were enrolled, when at least one was. */
  onAdded?: (added: number) => void
}

/** The addresses, deduplicated the way the route will deduplicate them. */
const distinctAddresses = (emails: readonly string[]): string[] => [
  ...new Set(
    emails.map((email) => String(email ?? '').trim().toLowerCase()).filter(Boolean),
  ),
]

const chunk = <T,>(items: readonly T[], size: number): T[][] => {
  const chunks: T[][] = []
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size))
  }
  return chunks
}

export function AddToListDialog(props: AddToListDialogProps) {
  const { open, onClose, hostId, scope, emails, onAdded } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()

  const addresses = useMemo(() => distinctAddresses(emails), [emails])

  const { data: audienceRows, status: audiencesStatus } =
    useFirestoreCollection<AudienceRow>(
      () =>
        open && scope
          ? query(
              collection(firestore, scope[0], scope[1], 'lists'),
              orderBy('name'),
              limit(AUDIENCE_PICKER_LIMIT),
            )
          : null,
      [firestore, scope, open],
      { idField: '$id' },
    )
  const audiences = audienceRows ?? []

  const [listId, setListId] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [attested, setAttested] = useState(false)
  const [results, setResults] = useState<AddResult[] | null>(null)
  const [busy, setBusy] = useState(false)

  /*
   * A preview belongs to the list and the addresses it was run for. Change
   * either and the count on screen — and the attestation offered under it —
   * would be about a different set, so both go.
   */
  useEffect(() => {
    setPreview(null)
    setAttested(false)
    setResults(null)
  }, [listId, addresses])

  const post = useCallback(
    async (route: string, body: Record<string, unknown>) => {
      const response = await authorizedFetch(user, `/api/email/${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId, listId, ...body }),
      })
      const payload = await response.json().catch(() => ({}))
      return { ok: response.ok, payload }
    },
    [user, hostId, listId],
  )

  const handleCheck = useCallback(async () => {
    if (busy || !listId || !addresses.length) return
    setBusy(true)
    try {
      const summed: Preview = {
        verdicts: [],
        optedIn: 0,
        needAttestation: 0,
        refused: 0,
      }
      for (const batch of chunk(addresses, LIST_MEMBER_REQUEST_CHUNK)) {
        const { ok, payload } = await post('list-members-preview', {
          emails: batch,
        })
        if (!ok) {
          return void enqueueSnackbar(
            payload?.error ?? 'The addresses could not be checked.',
            { variant: 'warning', allowDuplicate: true },
          )
        }
        const page = payload as Preview
        summed.verdicts.push(...(page.verdicts ?? []))
        summed.optedIn += Number(page.optedIn ?? 0)
        summed.needAttestation += Number(page.needAttestation ?? 0)
        summed.refused += Number(page.refused ?? 0)
      }
      setPreview(summed)
    } catch {
      enqueueSnackbar('The addresses could not be checked.', {
        variant: 'warning',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }, [busy, listId, addresses, post, enqueueSnackbar])

  const handleAdd = useCallback(async () => {
    if (busy || !preview) return
    setBusy(true)
    try {
      const all: AddResult[] = []
      for (const batch of chunk(addresses, LIST_MEMBER_REQUEST_CHUNK)) {
        const { ok, payload } = await post('list-members-add', {
          emails: batch,
          // The operator's assertion, applied per address by the route to
          // the people who need it; a stored opt-in keeps its own basis.
          attestConsent: attested,
        })
        if (!ok) {
          return void enqueueSnackbar(
            payload?.error ?? 'Nobody was added to the list',
            { variant: 'warning', allowDuplicate: true },
          )
        }
        all.push(...((payload?.results ?? []) as AddResult[]))
      }
      const added = all.filter((result) => result.enrolled).length
      setResults(all)
      setPreview(null)
      if (added) onAdded?.(added)
      enqueueSnackbar(
        added === 1 ? 'One person added' : `${added} people added`,
        { variant: added ? 'success' : 'warning', persist: false },
      )
    } catch {
      enqueueSnackbar('Nobody was added to the list', {
        variant: 'warning',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }, [busy, preview, addresses, attested, post, enqueueSnackbar, onAdded])

  const enrollable = preview ? preview.optedIn + preview.needAttestation : 0
  const chosen = audiences.find((row) => row.$id === listId)

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {addresses.length === 1
          ? 'Add to an audience'
          : `Add ${addresses.length} people to an audience`}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {'Every address is checked against its consent record and both ' +
              'suppression lists before anyone is added — the same check the ' +
              "audience's own page runs."}
          </Typography>
          {audiencesStatus === 'error' ? (
            <Alert severity="warning">
              {'Audiences are managed by members with access to every site ' +
                'in the workspace. Ask one of them to add these people.'}
            </Alert>
          ) : (
            <TextField
              select
              size="small"
              label="Audience"
              value={listId}
              onChange={(event) => setListId(event.target.value)}
              disabled={busy}
              helperText={
                chosen?.kind === 'dynamic'
                  ? 'A live audience. Whoever you add stays, whether or not the rule matches them.'
                  : audiences.length
                    ? undefined
                    : 'No audiences yet — create one under Emails.'
              }
            >
              {audiences.map((row) => (
                <MenuItem key={row.$id} value={row.$id}>
                  {row.name ?? row.$id}
                </MenuItem>
              ))}
            </TextField>
          )}
          {preview ? (
            <Stack spacing={1}>
              <Alert severity={enrollable ? 'info' : 'warning'}>
                {[
                  preview.optedIn ? `${preview.optedIn} already opted in` : '',
                  preview.needAttestation
                    ? `${preview.needAttestation} with no opt-in on record`
                    : '',
                  preview.refused ? `${preview.refused} cannot be added at all` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Alert>
              {/*
                The hard refusals only, by address. An address that merely
                needs the attestation is not a refusal, and listing it here
                would put the people the checkbox is about under a heading
                that says they cannot be added.
               */}
              {preview.verdicts
                .filter((verdict) => verdict.refusal)
                .map((verdict) => (
                  <Typography
                    key={verdict.input}
                    variant="caption"
                    color="text.secondary"
                  >
                    {`${verdict.input} — ${verdict.summary}`}
                  </Typography>
                ))}
              {preview.needAttestation ? (
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={attested}
                      onChange={(event) => setAttested(event.target.checked)}
                    />
                  }
                  label={
                    <Typography variant="body2">
                      {'I have permission to send marketing email to the ' +
                        `${preview.needAttestation} ` +
                        `${preview.needAttestation === 1 ? 'person' : 'people'} ` +
                        'with no opt-in on record. This is recorded against my ' +
                        'account, with the date.'}
                    </Typography>
                  }
                />
              ) : null}
            </Stack>
          ) : null}
          {results?.length ? (
            <Stack spacing={0.5}>
              {results
                .filter((result) => !result.enrolled)
                .map((result) => (
                  <Typography
                    key={result.input}
                    variant="caption"
                    color="text.secondary"
                  >
                    {`${result.input} — not added. ${result.error ?? ''}`}
                  </Typography>
                ))}
            </Stack>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {results ? 'Done' : 'Cancel'}
        </Button>
        {preview ? (
          <Button
            variant="contained"
            disabled={
              busy || !enrollable || (preview.needAttestation > 0 && !attested)
            }
            onClick={() => void handleAdd()}
          >
            {busy ? 'Adding…' : `Add ${enrollable}`}
          </Button>
        ) : (
          <Button
            variant="contained"
            disabled={busy || !listId || !addresses.length || Boolean(results)}
            onClick={() => void handleCheck()}
          >
            {busy ? 'Checking…' : 'Check'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
AddToListDialog.displayName = 'AddToListDialog'

export default AddToListDialog
