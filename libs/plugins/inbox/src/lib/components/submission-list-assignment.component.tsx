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
 * "Add to a marketing list", inside the submission reader.
 *
 * ## Its own card, below the reply, and never part of it
 *
 * A reply is transactional and a list is marketing. Two cards rather than a
 * checkbox on the composer, because a checkbox beside Send is a control a
 * merchant ticks while thinking about the message — and the thing it would do
 * is put a person into an audience that will be mailed for as long as the
 * list exists. The separation on screen is the same one the routes and the
 * stored records keep.
 *
 * ## It states the consent facts before offering the control
 *
 * Every sentence here comes from the server, which read the person's actual
 * record. Nothing is computed locally: a component that decided for itself
 * whether somebody may be added would be a second copy of the rule, on the
 * one surface whose job is to tell the merchant the truth about what is about
 * to happen. That is the defect this feature was held back to avoid — a
 * screen claiming a check that did not happen.
 *
 * ## Nothing is read until the merchant asks
 *
 * The options are fetched by pressing the button, never on mount. The reader
 * dialog opens on every submission a merchant reads; charging all of them
 * three reads and a query for a feature most will not use is the
 * read-on-mount shape this codebase refuses.
 */

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'

export interface SubmissionListAssignmentProps {
  hostId: string
  /** The submission being read. Only its id is sent; the address is resolved
   * server-side from the stored record. */
  submission: { $id: string }
}

/** What `inbox/list-options` answers. Mirrors the handler's payload. */
interface ListOptions {
  to: string
  lists: Array<{ id: string; name: string }>
  listsTruncated?: boolean
  enrollable: boolean
  requiresAttestation: boolean
  summary: string
}

export function SubmissionListAssignment(props: SubmissionListAssignmentProps) {
  const { hostId, submission } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()

  const [options, setOptions] = useState<ListOptions | null>(null)
  const [loadError, setLoadError] = useState('')
  const [listId, setListId] = useState('')
  const [attested, setAttested] = useState(false)
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState('')

  /*
   * Every answer belongs to the submission that produced it. The reader keeps
   * this component mounted while the merchant moves between rows, so state
   * left over from the previous sender would offer one person's lists — and
   * one person's attestation — for the next.
   */
  useEffect(() => {
    setOptions(null)
    setLoadError('')
    setListId('')
    setAttested(false)
    setAdded('')
  }, [submission?.$id])

  const post = useCallback(
    async (route: string, body: Record<string, unknown>) => {
      const idToken = await (user as { getIdToken?: () => Promise<string> })
        ?.getIdToken?.()
      const response = await fetch(`/api/inbox/${route}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ hostId, submissionId: submission.$id, ...body }),
      })
      const payload = await response.json().catch(() => ({}))
      return { ok: response.ok, payload }
    },
    [user, hostId, submission?.$id],
  )

  const handleLoad = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const { ok, payload } = await post('list-options', {})
      if (!ok) {
        return setLoadError(payload?.error ?? 'The lists could not be read.')
      }
      setOptions(payload as ListOptions)
    } catch {
      setLoadError('The lists could not be read.')
    } finally {
      setBusy(false)
    }
  }, [busy, post])

  const handleAdd = useCallback(async () => {
    if (busy || !listId) return
    setBusy(true)
    try {
      const { ok, payload } = await post('assign-list', {
        listId,
        // Sent as the merchant's assertion, not as a basis they named: the
        // server derives a pass-through from the person's own record and this
        // flag can only ever add the attributable kind.
        attestConsent: attested,
      })
      if (!ok) {
        return void enqueueSnackbar(
          payload?.error ?? 'They were not added to the list',
          { variant: 'warning', allowDuplicate: true },
        )
      }
      setAdded(String(payload?.listName ?? 'the list'))
      enqueueSnackbar(`Added to ${payload?.listName ?? 'the list'}`, {
        variant: 'success',
        persist: false,
      })
    } catch {
      enqueueSnackbar('They were not added to the list', {
        variant: 'warning',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }, [busy, listId, attested, post, enqueueSnackbar])

  return (
    <CardDisplay title="Add to a marketing list">
      <Stack spacing={2}>
        {/*
          Said before anything is loaded, because it is the sentence that
          keeps the two acts apart in the merchant's head as well as in the
          data. Replying to somebody does not put them on a list, and this
          does not send them anything.
         */}
        <Typography variant="body2" color="text.secondary">
          {'A list is used by campaigns. Adding someone here sends them ' +
            'nothing now, and replying to them never adds them.'}
        </Typography>

        {added ? (
          <Alert severity="success">{`Added to ${added}.`}</Alert>
        ) : null}

        {!options && !loadError ? (
          <Box>
            <Button variant="outlined" disabled={busy} onClick={handleLoad}>
              {busy ? 'Checking…' : 'Add to a list'}
            </Button>
          </Box>
        ) : null}

        {loadError ? <Alert severity="warning">{loadError}</Alert> : null}

        {options ? (
          <Stack spacing={2}>
            {/*
              The consent facts, always, and above the control. A merchant who
              is about to add somebody to a marketing audience is entitled to
              know what the product actually knows about that person's
              permission — including, and especially, that it knows nothing.
             */}
            <Alert severity={options.enrollable ? 'info' : 'warning'}>
              {options.summary}
            </Alert>

            {options.enrollable ? (
              <>
                {options.lists.length ? (
                  <TextField
                    select
                    label="List"
                    value={listId}
                    onChange={(event) => setListId(event.target.value)}
                    fullWidth
                    size="small"
                  >
                    {options.lists.map((list) => (
                      <MenuItem key={list.id} value={list.id}>
                        {list.name}
                      </MenuItem>
                    ))}
                  </TextField>
                ) : (
                  <Alert severity="info">
                    {'This organization has no marketing lists yet.'}
                  </Alert>
                )}
                {options.listsTruncated ? (
                  <Typography variant="caption" color="text.secondary">
                    {'Showing the first lists only. This organization has more.'}
                  </Typography>
                ) : null}

                {/*
                  Shown on exactly one state: no record either way. A stored
                  opt-in needs no assertion, and a stored refusal is not
                  something an assertion may override — offering the control
                  there would present a door that is not there.
                 */}
                {options.requiresAttestation ? (
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={attested}
                        onChange={(event) => setAttested(event.target.checked)}
                      />
                    }
                    label={
                      <Typography variant="body2">
                        {`I have ${options.to}'s permission to send them ` +
                          'marketing email. This is recorded against my ' +
                          'account, with the date.'}
                      </Typography>
                    }
                  />
                ) : null}

                <Box>
                  <Button
                    variant="contained"
                    disabled={
                      busy ||
                      !listId ||
                      (options.requiresAttestation && !attested)
                    }
                    onClick={handleAdd}
                  >
                    {busy ? 'Adding…' : 'Add to list'}
                  </Button>
                </Box>
              </>
            ) : null}
          </Stack>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
SubmissionListAssignment.displayName = 'SubmissionListAssignment'

export default SubmissionListAssignment
