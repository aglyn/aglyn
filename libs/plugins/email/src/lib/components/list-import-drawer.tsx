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
 * BRINGING AN EXISTING LIST IN — the screen.
 *
 * `docs/specs/email-competitive-gaps.md` G5: a customer arriving from another
 * product has a list and, until now, no way to bring it. The server half is
 * `server-list-import.ts`; this is the surface that walks an operator through
 * it.
 *
 * ## A drawer, because an import is three decisions and not a field
 *
 * Choose the file, read what is in it, then say whether you have these
 * people's permission. Stacked above the membership table those three steps
 * would have nowhere to grow — which is exactly how the audience card's
 * create form came to offer four of a rule's nine fields — and the middle
 * step is the one that must not be cramped: it is where the screening
 * warnings and the consent readout are shown, and both exist to be READ
 * before the operator attests.
 *
 * Creating is a drawer and picking is a dialog, so this composes
 * `NavigationDrawerComponent` directly, the same way the suppressions card's
 * Add does — the console's wrapper around it lives in an application a plugin
 * library may not import.
 *
 * ## The numbers on screen are the server's, always
 *
 * Nothing here parses a file, screens it, or decides anything about consent.
 * Every count and every sentence comes back from a route that read the
 * merchant's actual contacts and both suppression lists. A screen that
 * computed its own would be a second copy of the rule on the one surface
 * whose job is to tell the operator the truth about what is about to happen.
 *
 * ## The run is a loop of bounded requests, and it says so
 *
 * A large file is not one request. The drawer calls `email/list-import-run`
 * until it answers `complete`, showing the cursor against the total as it
 * goes, so an import of forty thousand addresses is a progress bar rather
 * than a spinner that either finishes or does not. Closing the drawer stops
 * the loop and loses nothing: the job is durable, and reopening offers to
 * resume it from where it stopped.
 */

import { LIST_IMPORT_MAX_CHARACTERS, pluginDocsHelp } from '@aglyn/aglyn'
import { HelpTip } from '@aglyn/shared-ui-jsx'
import { ICON_VARIANT_CLOSE } from '@aglyn/shared-data-enums'
import { Container, MdiIcon, SrOnly } from '@aglyn/shared-ui-jsx'
import { NavigationDrawerComponent } from '@aglyn/shared-ui-jsx/components/navigation-drawer.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  AlertTitle,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'

export interface ListImportDrawerProps {
  open: boolean
  onClose: () => void
  hostId: string
  listId: string
  listName: string
  /**
   * Called whenever the run enrolls anybody.
   *
   * The audience page's subscriber total is a server aggregate taken once, so
   * an import that ran to completion behind a stale count would read as
   * having done nothing. Fired per run rather than once at the end: a large
   * import is watched, and a total that only moves at the end is a total that
   * looks stuck.
   */
  onMembershipChanged?: () => void
}

/** One address's verdict, as the preview reports it. */
interface AddressVerdict {
  input: string
  email: string | null
  refusal: string | null
  requiresAttestation: boolean
  summary: string
}

/** What the mechanical screening found. Signals, not verdicts. */
interface Screening {
  roleAccounts: number
  roleAccountSamples: string[]
  purchaseTellColumns: string[]
  declaresBasis: boolean
}

/** `email/list-import-preview`'s answer. */
interface ImportPreview {
  columns: string[]
  usable: number
  unusable: number
  duplicates: number
  overCeiling: boolean
  ceiling: number
  unusableSamples: string[]
  screening: Screening
  sampleSize: number
  verdicts: AddressVerdict[]
  optedIn: number
  needAttestation: number
  refused: number
}

/** The durable job, as `status` and `run` report it. */
interface ImportJob {
  importId: string
  status: string
  total: number
  cursor: number
  enrolled: number
  refused: number
  refusals: Record<string, number>
  attested: boolean
}

/** What a refusal reason is called on screen. */
const REFUSAL_LABELS: Record<string, string> = {
  declined: 'Declined marketing email',
  'no-basis': 'No opt-in on record',
  'suppressed-host': 'Unsubscribed from this site',
  'suppressed-platform': 'Bounced or reported as spam',
  'unroutable-address': 'Not a valid address',
  'no-address': 'No address',
}

export function ListImportDrawer(props: ListImportDrawerProps) {
  const { open, onClose, hostId, listId, listName, onMembershipChanged } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()

  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [attested, setAttested] = useState(false)
  const [job, setJob] = useState<ImportJob | null>(null)
  const [busy, setBusy] = useState(false)
  /**
   * Set when the drawer closes mid-run, read by the loop.
   *
   * A ref and not state: the loop is an `async` function that has already
   * captured its closure, so a state value it read would be the value from
   * the render that started it — the loop would go on issuing requests after
   * the operator closed the drawer, which is the one thing "closing stops it"
   * has to mean.
   */
  const abandoned = useRef(false)

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

  /*
   * An unfinished import is looked for when the DRAWER OPENS and at no other
   * time — never on the page's mount. A merchant reading their audiences pays
   * nothing for a feature they did not reach for, which is the read-cost rule
   * `emails-console-read-cost.spec.tsx` meters.
   */
  useEffect(() => {
    if (!open) return undefined
    abandoned.current = false
    let active = true
    void post('list-import-status', {}).then(({ ok, payload }) => {
      if (!active || !ok) return
      const found = payload?.job as ImportJob | null
      if (found && found.status !== 'complete') setJob(found)
    })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const reset = useCallback(() => {
    setText('')
    setFileName('')
    setPreview(null)
    setAttested(false)
    setJob(null)
  }, [])

  const handleClose = useCallback(() => {
    // Stops the loop; the job survives and the next open offers to resume it.
    abandoned.current = true
    onClose()
  }, [onClose])

  const handleFile = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return
      const contents = await file.text().catch(() => '')
      if (contents.length > LIST_IMPORT_MAX_CHARACTERS) {
        return void enqueueSnackbar(
          'That file is too large to read in one go. Split it and import the ' +
            'pieces.',
          { variant: 'warning', allowDuplicate: true },
        )
      }
      setFileName(file.name)
      setText(contents)
      setPreview(null)
      setAttested(false)
    },
    [enqueueSnackbar],
  )

  const handlePreview = useCallback(async () => {
    if (busy || !text.trim()) return
    setBusy(true)
    try {
      const { ok, payload } = await post('list-import-preview', { text })
      if (!ok) {
        return void enqueueSnackbar(
          payload?.error ?? 'The file could not be read.',
          { variant: 'warning', allowDuplicate: true },
        )
      }
      setPreview(payload as ImportPreview)
      setAttested(false)
    } catch {
      enqueueSnackbar('The file could not be read.', {
        variant: 'warning',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }, [busy, text, post, enqueueSnackbar])

  /**
   * Drives one job to completion, one bounded request at a time.
   *
   * The loop's exit conditions are `complete`, an error, and the operator
   * closing the drawer. It never guesses how many runs a file needs — the
   * server answers `complete` when the cursor has reached the total, which is
   * the only party that knows.
   */
  const runToCompletion = useCallback(
    async (importId: string) => {
      setBusy(true)
      try {
        for (;;) {
          if (abandoned.current) return
          const { ok, payload } = await post('list-import-run', { importId })
          if (!ok) {
            return void enqueueSnackbar(
              payload?.error ?? 'The import could not continue.',
              { variant: 'warning', allowDuplicate: true },
            )
          }
          setJob((previous) => ({
            importId,
            status: payload?.complete ? 'complete' : 'running',
            total: Number(payload?.total ?? previous?.total ?? 0),
            cursor: Number(payload?.cursor ?? 0),
            enrolled:
              (previous?.enrolled ?? 0) + Number(payload?.ranEnrolled ?? 0),
            refused:
              (previous?.refused ?? 0) + Number(payload?.ranRefused ?? 0),
            refusals: mergeCounts(
              previous?.refusals ?? {},
              (payload?.refusals ?? {}) as Record<string, number>,
            ),
            attested: previous?.attested ?? false,
          }))
          if (Number(payload?.ranEnrolled ?? 0)) onMembershipChanged?.()
          if (payload?.complete) {
            return void enqueueSnackbar('Import finished', {
              variant: 'success',
              persist: false,
            })
          }
        }
      } finally {
        setBusy(false)
      }
    },
    [post, enqueueSnackbar, onMembershipChanged],
  )

  const handleStart = useCallback(async () => {
    if (busy || !preview) return
    setBusy(true)
    try {
      const { ok, payload } = await post('list-import-start', {
        text,
        // The operator's assertion, not a basis they named: the server derives
        // a pass-through from each person's own record, and this flag can only
        // ever add the attributable kind.
        attestConsent: attested,
      })
      if (!ok) {
        setBusy(false)
        return void enqueueSnackbar(
          payload?.error ?? 'The import could not be started.',
          { variant: 'warning', allowDuplicate: true },
        )
      }
      const started: ImportJob = {
        importId: String(payload?.importId ?? ''),
        status: 'running',
        total: Number(payload?.total ?? 0),
        cursor: 0,
        enrolled: 0,
        refused: 0,
        refusals: {},
        attested: payload?.attested === true,
      }
      setJob(started)
      setBusy(false)
      await runToCompletion(started.importId)
    } catch {
      setBusy(false)
      enqueueSnackbar('The import could not be started.', {
        variant: 'warning',
        allowDuplicate: true,
      })
    }
  }, [busy, preview, text, attested, post, enqueueSnackbar, runToCompletion])

  const running = !!job && job.status !== 'complete'
  const finished = !!job && job.status === 'complete'

  return (
    <NavigationDrawerComponent
      open={open}
      anchor="right"
      variant="temporary"
      onClose={handleClose}
      AppBarProps={{ color: 'surface' }}
      appBarLeft={
        <>
          <IconButton
            color="inherit"
            edge="start"
            onClick={handleClose}
            sx={{ mr: 2 }}
          >
            <MdiIcon path={ICON_VARIANT_CLOSE.path} />
            <SrOnly>{'close drawer'}</SrOnly>
          </IconButton>
          <Typography variant="h6" component="div">
            {`Import into "${listName}"`}
          </Typography>
          {/*
            The help affordance every console surface carries, pointed at the
            section that explains what happens to an imported address — which
            is the question an operator has at exactly this moment.
           */}
          <HelpTip
            {...pluginDocsHelp('emailCampaigns', { anchor: '#import-a-list' })}
          />
        </>
      }
      appBarRight={
        <Button variant="outlined" color="inherit" onClick={handleClose}>
          {finished ? 'Done' : 'Cancel'}
        </Button>
      }
    >
      <Container gutterY>
        <Stack spacing={2}>
          {job ? (
            <ImportProgressPanel
              job={job}
              busy={busy}
              onResume={() => void runToCompletion(job.importId)}
              onAnother={reset}
            />
          ) : (
            <>
              <Typography variant="body2" color="text.secondary">
                {'A CSV with an email column, or one address per line. Every ' +
                  'address goes through the same checks as one you type in ' +
                  'by hand: anyone who unsubscribed, bounced, or told you ' +
                  'they do not want marketing email is refused, and nothing ' +
                  'you upload can override that.'}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Button variant="outlined" component="label" disabled={busy}>
                  {'Choose file'}
                  <input
                    type="file"
                    accept=".csv,.txt,text/csv,text/plain"
                    hidden
                    onChange={(event) =>
                      void handleFile(event.target.files?.[0])
                    }
                  />
                </Button>
                {fileName ? (
                  <Chip size="small" variant="outlined" label={fileName} />
                ) : null}
              </Stack>
              <TextField
                label="Or paste the list"
                value={text}
                onChange={(event) => {
                  setText(event.target.value)
                  setFileName('')
                  /*
                   * Any edit invalidates the answer. A preview belongs to the
                   * exact text it was run for, and leaving a stale one on
                   * screen would show counts, and an attestation checkbox,
                   * for a file the operator has since changed.
                   */
                  setPreview(null)
                  setAttested(false)
                }}
                multiline
                minRows={4}
                maxRows={12}
                fullWidth
                helperText={
                  'One address per line, or paste the whole CSV including ' +
                  'its header row.'
                }
              />
              {preview ? (
                <ImportReviewPanel
                  preview={preview}
                  attested={attested}
                  onAttestedChange={setAttested}
                />
              ) : null}
              <Stack
                direction="row"
                spacing={1}
                sx={{ justifyContent: 'flex-end' }}
              >
                {preview ? (
                  <Button
                    variant="contained"
                    disabled={busy || preview.usable === 0}
                    onClick={() => void handleStart()}
                  >
                    {attested
                      ? `Import ${preview.usable} addresses`
                      : `Import the ${preview.optedIn} with an opt-in`}
                  </Button>
                ) : (
                  <Button
                    variant="contained"
                    disabled={busy || !text.trim()}
                    onClick={() => void handlePreview()}
                  >
                    {busy ? 'Checking…' : 'Check this file'}
                  </Button>
                )}
              </Stack>
            </>
          )}
        </Stack>
      </Container>
    </NavigationDrawerComponent>
  )
}
ListImportDrawer.displayName = 'ListImportDrawer'

/** Adds two refusal tallies together. */
function mergeCounts(
  base: Record<string, number>,
  extra: Record<string, number>,
): Record<string, number> {
  const merged = { ...base }
  for (const [key, value] of Object.entries(extra)) {
    merged[key] = (merged[key] ?? 0) + Number(value ?? 0)
  }
  return merged
}

/**
 * WHAT IS IN THE FILE, and the one question the operator has to answer.
 *
 * Three blocks in the order they should be read: what the file contains, what
 * the screening noticed, and what the consent gate said about a sample. The
 * attestation control comes last on purpose — it is the act, and an act
 * offered above its own evidence is an act taken without it.
 */
function ImportReviewPanel(props: {
  preview: ImportPreview
  attested: boolean
  onAttestedChange: (value: boolean) => void
}) {
  const { preview, attested, onAttestedChange } = props
  const { screening } = preview
  return (
    <Stack spacing={2}>
      <Alert severity="info">
        <AlertTitle>{`${preview.usable} addresses in this file`}</AlertTitle>
        <Stack spacing={0.5}>
          {preview.duplicates ? (
            <Typography variant="body2">
              {`${preview.duplicates} repeated addresses were collapsed — the ` +
                'same person twice is one member.'}
            </Typography>
          ) : null}
          {preview.unusable ? (
            <Typography variant="body2">
              {`${preview.unusable} lines are not email addresses and will be ` +
                `skipped${
                  preview.unusableSamples.length
                    ? `, starting with: ${preview.unusableSamples
                        .slice(0, 3)
                        .join(', ')}`
                    : ''
                }.`}
            </Typography>
          ) : null}
          {preview.overCeiling ? (
            <Typography variant="body2">
              {`This file names more than ${preview.ceiling} addresses. Only ` +
                'the first are staged — split the file and import the rest ' +
                'separately. Nothing already on the list is affected.'}
            </Typography>
          ) : null}
        </Stack>
      </Alert>

      {screening.purchaseTellColumns.length ? (
        <Alert severity="warning">
          <AlertTitle>{'This file looks bought or appended'}</AlertTitle>
          {`Its columns include ${screening.purchaseTellColumns.join(', ')}. ` +
            'Purchased, rented and appended lists are not allowed, and ' +
            'importing one puts every site sending through this domain at ' +
            'risk. If the column name is a coincidence, carry on.'}
        </Alert>
      ) : null}

      {screening.roleAccounts ? (
        <Alert severity="warning">
          <AlertTitle>
            {`${screening.roleAccounts} shared mailboxes`}
          </AlertTitle>
          {`Addresses like ${screening.roleAccountSamples
            .slice(0, 3)
            .join(', ')} reach a mailbox several people read, or nobody. ` +
            'They are a common sign of a list built by collecting addresses ' +
            'rather than by people signing up. They will be imported if you ' +
            'go ahead.'}
        </Alert>
      ) : null}

      <Alert severity={preview.needAttestation ? 'warning' : 'success'}>
        <AlertTitle>
          {preview.sampleSize < preview.usable
            ? `Checked the first ${preview.sampleSize} of ${preview.usable}`
            : 'Checked every address'}
        </AlertTitle>
        <Stack spacing={0.5}>
          <Typography variant="body2">
            {`${preview.optedIn} already have an opt-in on record, ` +
              `${preview.needAttestation} have no opt-in on record, and ` +
              `${preview.refused} cannot be added at all.`}
          </Typography>
          {preview.sampleSize < preview.usable ? (
            <Typography variant="body2">
              {'The rest are checked the same way as the import runs, and ' +
                'the result is reported as it goes.'}
            </Typography>
          ) : null}
        </Stack>
      </Alert>

      {preview.verdicts.length ? (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{'Address'}</TableCell>
              <TableCell>{'What we know'}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {preview.verdicts.slice(0, 10).map((verdict, index) => (
              <TableRow key={`${verdict.input}-${index}`}>
                <TableCell>{verdict.email ?? verdict.input}</TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">
                    {verdict.summary}
                  </Typography>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      {preview.needAttestation ? (
        <FormControlLabel
          control={
            <Checkbox
              checked={attested}
              onChange={(event) => onAttestedChange(event.target.checked)}
            />
          }
          label={
            <Typography variant="body2">
              {'I have these people’s permission to send them marketing ' +
                'email, and I can produce the record of it if asked. This ' +
                'statement is stored against my account, with today’s date, ' +
                'on every address it admits.'}
              {screening.declaresBasis
                ? ' The opt-in source and date your file declares are kept with it.'
                : ''}
            </Typography>
          }
        />
      ) : null}
      {preview.needAttestation && !attested ? (
        <Typography variant="body2" color="text.secondary">
          {'Without that statement the import adds only the addresses that ' +
            'already have an opt-in on record. Nobody else is added, and ' +
            'nothing is deleted.'}
        </Typography>
      ) : null}
    </Stack>
  )
}

/** How far the run has got, and what it did. */
function ImportProgressPanel(props: {
  job: ImportJob
  busy: boolean
  onResume: () => void
  onAnother: () => void
}) {
  const { job, busy, onResume, onAnother } = props
  const done = job.status === 'complete'
  const percent = job.total ? Math.min((job.cursor / job.total) * 100, 100) : 0
  const refusals = Object.entries(job.refusals).filter(([, count]) => count > 0)
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {done
          ? `Finished. ${job.enrolled} of ${job.total} addresses were added.`
          : `${job.cursor} of ${job.total} addresses checked.`}
      </Typography>
      <LinearProgress
        variant="determinate"
        value={percent}
        sx={{ borderRadius: 1 }}
      />
      {refusals.length ? (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{'Not added'}</TableCell>
              <TableCell align="right">{'Addresses'}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {refusals.map(([reason, count]) => (
              <TableRow key={reason}>
                <TableCell>{REFUSAL_LABELS[reason] ?? reason}</TableCell>
                <TableCell align="right">{count}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      {!done ? (
        <Alert severity="info">
          {'Large files are added in batches, so this takes a few minutes. ' +
            'You can close this — the import picks up where it stopped when ' +
            'you come back.'}
        </Alert>
      ) : null}
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
        {done ? (
          <Button variant="outlined" onClick={onAnother}>
            {'Import another file'}
          </Button>
        ) : (
          <Button variant="contained" disabled={busy} onClick={onResume}>
            {busy ? 'Importing…' : 'Resume import'}
          </Button>
        )}
      </Stack>
    </Stack>
  )
}

export default ListImportDrawer
