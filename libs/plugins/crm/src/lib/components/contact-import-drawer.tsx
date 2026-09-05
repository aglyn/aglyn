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
 * IMPORTING A CONTACT FILE — the screen (AGL-2602).
 *
 * The server half is `server/contacts-import.ts`; this is the surface that
 * walks an operator from a CSV on their disk to a result they can act on.
 * The email plugin's `list-import-drawer.tsx` is the shape it follows —
 * choose the file, read what is in it, run it in bounded requests with a
 * progress bar, report — with one difference the CRM forces: a contact
 * file has COLUMNS, and which column is the phone number is not something
 * any alias table can be sure of. So the middle step here is a mapping
 * table rather than a consent readout, and the preview shows the operator
 * the ten rows their mapping produces before anything is sent.
 *
 * ## The file is read in the browser, and judged on the server
 *
 * `parseCsv` — the same parser the list import and the dataset import run
 * — turns the file into cells here, so the operator can map and preview
 * without a round trip and without uploading a file they may still decide
 * not to import. Nothing is VALIDATED here beyond counting the rows whose
 * email cell is unusable, and that count is a courtesy: every row is judged
 * by the route, through the normalizers every other door uses, and the
 * numbers on the result panel are the server's.
 *
 * ## Bounded requests, and closing stops them
 *
 * Two hundred rows per request, as many requests as the file needs, and a
 * progress bar between them. Closing the drawer mid-run stops the loop
 * after the request in flight; the rows already written stay written and
 * the result panel says how far it got. There is no durable job to resume
 * — a contact import is idempotent by construction (the door dedupes on the
 * address), so running the same file again finishes what a closed drawer
 * left, reporting the earlier rows as merged.
 */

import {
  CONTACT_IMPORT_CHUNK_SIZE,
  CONTACT_IMPORT_FIELD_LABELS,
  CONTACT_IMPORT_FIELDS,
  CONTACT_IMPORT_MAX_ROWS,
  CONTACT_IMPORT_PREVIEW_ROWS,
  CONTACT_IMPORT_SKIP_LABELS,
  type ConsolePluginPageProps,
  type ContactFieldDefinition,
  type ContactImportChunkResult,
  type ContactImportMapping,
  type ContactImportSkipReason,
  type ContactImportTargetId,
  contactImportSkippedCsv,
  CRM_COLLECTIONS,
  consentGroupForHost,
  customImportTarget,
  customImportTargetKey,
  emptyContactImportResult,
  guessContactImportMapping,
  hostScopeToken,
  LIST_IMPORT_MAX_CHARACTERS,
  mapContactImportRow,
  MAX_SCOPE_HOSTS,
  mergeContactImportResults,
  normalizeContactEmail,
  ORG_SCOPE_TOKEN,
  parseCsv,
  pluginDocsHelp,
} from '@aglyn/aglyn'
import { ICON_VARIANT_CLOSE } from '@aglyn/shared-data-enums'
import { Container, HelpTip, MdiIcon, SrOnly } from '@aglyn/shared-ui-jsx'
import { NavigationDrawerComponent } from '@aglyn/shared-ui-jsx/components/navigation-drawer.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  useFirestore,
  useFirestoreCollection,
  useOrgDataScope,
  useUser,
} from '@aglyn/tenant-feature-instance'
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  IconButton,
  LinearProgress,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { collection, limit, query, where } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export interface ContactImportDrawerProps {
  open: boolean
  onClose: () => void
  hostId: string
  /**
   * The org document the shell passed, for the consent group's scope
   * tokens. Typed as the page prop it is forwarded from, so the contacts
   * list mounts the button with the value it already holds and no cast.
   */
  org?: ConsolePluginPageProps['org']
}

/** The value the mapping select shows for a column that is not imported. */
const SKIP_TARGET = ''

/** What a dropped-value field is called in the result panel. */
function droppedFieldLabel(
  field: string,
  fields: readonly Pick<ContactFieldDefinition, 'key' | 'label'>[],
): string {
  const customKey = customImportTargetKey(field)
  if (customKey) {
    return fields.find((entry) => entry.key === customKey)?.label ?? customKey
  }
  return (
    CONTACT_IMPORT_FIELD_LABELS[field as keyof typeof CONTACT_IMPORT_FIELD_LABELS]
      ?.replace(/ \(.*\)$/, '') ?? field
  )
}

/**
 * The holder's live custom-field definitions, read only while the drawer
 * is open.
 *
 * A local hook rather than a shared one because the Fields section that
 * will own these definitions is landing beside this drawer; when it ships a
 * `useContactFieldDefinitions`, this is the read to replace with it. Scoped
 * by `visibleTo` the way the contacts listener is, because the rules prove
 * a scoped member's query per document and refuse an unfiltered one.
 *
 * Ordered in memory rather than by the query: `array-contains-any` with an
 * `orderBy` on another field needs a composite index the collection does
 * not have, and a holder's field list fits in one page.
 */
function useImportFieldDefinitions(options: {
  orgId: string | null | undefined
  visibleToTokens: readonly string[]
  enabled: boolean
}): ContactFieldDefinition[] {
  const { orgId, visibleToTokens, enabled } = options
  const firestore = useFirestore()
  const { data } = useFirestoreCollection<ContactFieldDefinition & { $id: string }>(
    () =>
      enabled && orgId
        ? query(
            collection(firestore, 'orgs', orgId, CRM_COLLECTIONS.contactFields),
            where('visibleTo', 'array-contains-any', [...visibleToTokens]),
            limit(100),
          )
        : null,
    [firestore, orgId, visibleToTokens, enabled],
    { idField: '$id' },
  )
  return useMemo(
    () =>
      (data ?? [])
        .filter((field) => !!field.key && !field.retiredAt)
        .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0)),
    [data],
  )
}

export function ContactImportDrawer(props: ContactImportDrawerProps) {
  const { open, onClose, hostId, org } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { orgId } = useOrgDataScope({ hostId })
  const consentGroup = useMemo(
    () => consentGroupForHost((org ?? {}) as Record<string, unknown>, hostId),
    [org, hostId],
  )
  const visibleToTokens = useMemo(
    () =>
      [
        ORG_SCOPE_TOKEN,
        ...consentGroup.hostIds.map((id) => hostScopeToken(id)),
      ].slice(0, MAX_SCOPE_HOSTS),
    [consentGroup],
  )
  const fields = useImportFieldDefinitions({
    orgId,
    visibleToTokens,
    enabled: open,
  })

  const [fileName, setFileName] = useState('')
  const [columns, setColumns] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  /** How many rows the file had past the ceiling, so the drawer can say so. */
  const [overCeiling, setOverCeiling] = useState(0)
  const [mapping, setMapping] = useState<ContactImportMapping>({})
  const [result, setResult] = useState<ContactImportChunkResult | null>(null)
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(
    null,
  )
  const [busy, setBusy] = useState(false)
  /**
   * Set when the drawer closes mid-run, read by the loop.
   *
   * A ref and not state, for the reason the list import gives: the loop is
   * an `async` function that captured its closure when it started, and a
   * state value it read would be the one from that render.
   */
  const abandoned = useRef(false)

  useEffect(() => {
    if (open) abandoned.current = false
  }, [open])

  const reset = useCallback(() => {
    setFileName('')
    setColumns([])
    setRows([])
    setOverCeiling(0)
    setMapping({})
    setResult(null)
    setProgress(null)
  }, [])

  const handleClose = useCallback(() => {
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
      const table = parseCsv(contents).filter((cells) =>
        cells.some((cell) => String(cell ?? '').trim()),
      )
      if (table.length < 2) {
        return void enqueueSnackbar(
          'That file needs a header row and at least one contact under it.',
          { variant: 'warning', allowDuplicate: true },
        )
      }
      const header = table[0].map((cell) => String(cell ?? '').trim())
      const body = table.slice(1)
      setFileName(file.name)
      setColumns(header)
      setRows(body.slice(0, CONTACT_IMPORT_MAX_ROWS))
      setOverCeiling(Math.max(0, body.length - CONTACT_IMPORT_MAX_ROWS))
      setMapping(guessContactImportMapping(header, fields))
      setResult(null)
      setProgress(null)
    },
    [enqueueSnackbar, fields],
  )

  const emailMapped = Object.values(mapping).includes('email')
  /** Rows whose email cell the same normalizer the server runs would refuse. */
  const unusableEmails = useMemo(() => {
    const emailAt = Number(
      Object.entries(mapping).find(([, target]) => target === 'email')?.[0] ?? -1,
    )
    if (emailAt < 0) return rows.length
    return rows.filter((cells) => !normalizeContactEmail(cells[emailAt])).length
  }, [mapping, rows])

  const preview = useMemo(
    () =>
      rows
        .slice(0, CONTACT_IMPORT_PREVIEW_ROWS)
        .map((cells) => mapContactImportRow(cells, mapping)),
    [rows, mapping],
  )
  const mappedTargets = useMemo(
    () =>
      Object.entries(mapping)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, target]) => target),
    [mapping],
  )

  const targetLabel = useCallback(
    (target: ContactImportTargetId): string => {
      const customKey = customImportTargetKey(target)
      if (customKey) {
        return fields.find((field) => field.key === customKey)?.label ?? customKey
      }
      return CONTACT_IMPORT_FIELD_LABELS[target as keyof typeof CONTACT_IMPORT_FIELD_LABELS]
    },
    [fields],
  )

  const handleMap = useCallback((index: number, target: string) => {
    setMapping((previous) => {
      const next: ContactImportMapping = {}
      for (const [column, existing] of Object.entries(previous)) {
        // One column per target: choosing a target already taken moves it
        // here rather than importing one field from two columns.
        if (Number(column) !== index && existing !== target) {
          next[Number(column)] = existing
        }
      }
      if (target !== SKIP_TARGET) next[index] = target as ContactImportTargetId
      return next
    })
  }, [])

  /**
   * Runs the file, one bounded request at a time.
   *
   * Every chunk's result is folded into the running total as it arrives,
   * so a file that stops halfway — a lost connection, a closed drawer —
   * still reports what it did rather than nothing.
   */
  const handleImport = useCallback(async () => {
    if (busy || !rows.length || !emailMapped) return
    setBusy(true)
    let total = emptyContactImportResult()
    setResult(total)
    setProgress({ sent: 0, total: rows.length })
    try {
      for (let offset = 0; offset < rows.length; offset += CONTACT_IMPORT_CHUNK_SIZE) {
        if (abandoned.current) return
        const chunk = rows
          .slice(offset, offset + CONTACT_IMPORT_CHUNK_SIZE)
          .map((cells) => mapContactImportRow(cells, mapping))
        const response = await authorizedFetch(user, '/api/crm/contacts-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostId, rows: chunk }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          return void enqueueSnackbar(
            payload?.error ?? 'The import could not continue.',
            { variant: 'warning', allowDuplicate: true },
          )
        }
        total = mergeContactImportResults(
          total,
          payload as ContactImportChunkResult,
          offset,
        )
        setResult(total)
        setProgress({ sent: Math.min(offset + chunk.length, rows.length), total: rows.length })
      }
      enqueueSnackbar('Import finished', { variant: 'success', persist: false })
    } catch {
      enqueueSnackbar('The import could not continue.', {
        variant: 'warning',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }, [busy, rows, emailMapped, mapping, user, hostId, enqueueSnackbar])

  const handleDownloadSkipped = useCallback(() => {
    if (!result?.skipped.length) return
    const csv = contactImportSkippedCsv(
      columns,
      result.skipped.map((entry) => ({
        cells: rows[entry.index] ?? [],
        reason: entry.reason,
      })),
    )
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'skipped-contacts.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }, [result, columns, rows])

  const finished = !!result && !busy

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
            {'Import contacts from CSV'}
          </Typography>
          <HelpTip
            {...pluginDocsHelp('contacts', { anchor: '#import-from-csv' })}
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
          {result ? (
            <ImportResultPanel
              result={result}
              progress={progress}
              busy={busy}
              fields={fields}
              onDownloadSkipped={handleDownloadSkipped}
              onAnother={reset}
            />
          ) : (
            <>
              <Typography variant="body2" color="text.secondary">
                {'A CSV with a header row. Match its columns to contact ' +
                  'fields below, check the preview, then import. A person ' +
                  'already in your contacts is updated rather than added ' +
                  `twice. Up to ${CONTACT_IMPORT_MAX_ROWS.toLocaleString()} ` +
                  'rows per file — split a larger one.'}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Button variant="outlined" component="label" disabled={busy}>
                  {'Choose file'}
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    hidden
                    onChange={(event) => {
                      void handleFile(event.target.files?.[0])
                      event.target.value = ''
                    }}
                  />
                </Button>
                {fileName ? (
                  <Chip size="small" variant="outlined" label={fileName} />
                ) : null}
                {rows.length ? (
                  <Typography variant="body2" color="text.secondary">
                    {`${rows.length.toLocaleString()} rows`}
                  </Typography>
                ) : null}
              </Stack>
              {overCeiling > 0 ? (
                <Alert severity="warning">
                  {`This file has ${(rows.length + overCeiling).toLocaleString()} ` +
                    `rows. Only the first ${CONTACT_IMPORT_MAX_ROWS.toLocaleString()} ` +
                    'are imported — split the file and import the rest ' +
                    'separately.'}
                </Alert>
              ) : null}
              {columns.length ? (
                <ImportMappingTable
                  columns={columns}
                  sample={rows[0] ?? []}
                  mapping={mapping}
                  fields={fields}
                  onMap={handleMap}
                />
              ) : null}
              {columns.length > 0 && !emailMapped ? (
                <Alert severity="warning">
                  {'Choose which column holds the email address. It is the ' +
                    'one field every row needs.'}
                </Alert>
              ) : null}
              {columns.length > 0 && emailMapped ? (
                <ImportPreviewTable
                  targets={mappedTargets}
                  targetLabel={targetLabel}
                  preview={preview}
                  total={rows.length}
                  unusableEmails={unusableEmails}
                />
              ) : null}
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                <Button
                  variant="contained"
                  disabled={busy || !rows.length || !emailMapped}
                  onClick={() => void handleImport()}
                >
                  {rows.length
                    ? `Import ${rows.length.toLocaleString()} rows`
                    : 'Import'}
                </Button>
              </Stack>
            </>
          )}
        </Stack>
      </Container>
    </NavigationDrawerComponent>
  )
}
ContactImportDrawer.displayName = 'ContactImportDrawer'

/**
 * WHICH COLUMN IS WHICH.
 *
 * One row per column in the file: its header, the first row's value under
 * it so the operator can tell "Title" the job from "Title" the honorific,
 * and a select naming where it goes. The proposal came from the alias
 * table; every row of this table is the operator's to overrule.
 */
function ImportMappingTable(props: {
  columns: readonly string[]
  sample: readonly string[]
  mapping: ContactImportMapping
  fields: readonly ContactFieldDefinition[]
  onMap: (index: number, target: string) => void
}) {
  const { columns, sample, mapping, fields, onMap } = props
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">{'Columns'}</Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{'Column'}</TableCell>
            <TableCell>{'First row'}</TableCell>
            <TableCell>{'Imports as'}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {columns.map((column, index) => (
            <TableRow key={`${column}-${index}`}>
              <TableCell>{column || `Column ${index + 1}`}</TableCell>
              <TableCell>
                <Typography variant="body2" color="text.secondary" noWrap>
                  {String(sample[index] ?? '')}
                </Typography>
              </TableCell>
              <TableCell>
                <TextField
                  select
                  size="small"
                  value={mapping[index] ?? SKIP_TARGET}
                  onChange={(event) => onMap(index, event.target.value)}
                  sx={{ minWidth: 220 }}
                >
                  <MenuItem value={SKIP_TARGET}>{'Do not import'}</MenuItem>
                  {CONTACT_IMPORT_FIELDS.map((field) => (
                    <MenuItem key={field} value={field}>
                      {CONTACT_IMPORT_FIELD_LABELS[field]}
                    </MenuItem>
                  ))}
                  {fields.map((field) => (
                    <MenuItem key={field.key} value={customImportTarget(field.key)}>
                      {`${field.label} (custom)`}
                    </MenuItem>
                  ))}
                </TextField>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Stack>
  )
}

/**
 * The first ten rows, as the mapping reads them.
 *
 * Verbatim cell values under the fields they were mapped to — not the
 * normalized ones, because normalization is the server's and a preview that
 * showed a cleaned phone number would be promising a result the route may
 * refuse. What it does say is how many rows have no usable email, since
 * that is the one refusal the operator can fix before sending.
 */
function ImportPreviewTable(props: {
  targets: readonly ContactImportTargetId[]
  targetLabel: (target: ContactImportTargetId) => string
  preview: readonly ReturnType<typeof mapContactImportRow>[]
  total: number
  unusableEmails: number
}) {
  const { targets, targetLabel, preview, total, unusableEmails } = props
  const cell = (row: ReturnType<typeof mapContactImportRow>, target: ContactImportTargetId) => {
    const customKey = customImportTargetKey(target)
    if (customKey) {
      return String((row.custom as Record<string, string> | undefined)?.[customKey] ?? '')
    }
    return String(row[target as keyof typeof row] ?? '')
  }
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">
        {`Preview — first ${Math.min(preview.length, CONTACT_IMPORT_PREVIEW_ROWS)} of ${total.toLocaleString()}`}
      </Typography>
      {unusableEmails > 0 ? (
        <Alert severity="info">
          {`${unusableEmails.toLocaleString()} of ${total.toLocaleString()} rows ` +
            'have no usable email address and will be skipped. You can ' +
            'download them after the import.'}
        </Alert>
      ) : null}
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              {targets.map((target) => (
                <TableCell key={target}>{targetLabel(target)}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {preview.map((row, index) => (
              <TableRow key={index}>
                {targets.map((target) => (
                  <TableCell key={target}>
                    <Typography variant="body2" noWrap sx={{ maxWidth: 240 }}>
                      {cell(row, target)}
                    </Typography>
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Stack>
  )
}

/** How far the run has got, and what it did. */
function ImportResultPanel(props: {
  result: ContactImportChunkResult
  progress: { sent: number; total: number } | null
  busy: boolean
  fields: readonly ContactFieldDefinition[]
  onDownloadSkipped: () => void
  onAnother: () => void
}) {
  const { result, progress, busy, fields, onDownloadSkipped, onAnother } = props
  const percent = progress?.total
    ? Math.min((progress.sent / progress.total) * 100, 100)
    : 0
  const skippedByReason = useMemo(() => {
    const counts: Partial<Record<ContactImportSkipReason, number>> = {}
    for (const entry of result.skipped) {
      counts[entry.reason] = (counts[entry.reason] ?? 0) + 1
    }
    return Object.entries(counts) as [ContactImportSkipReason, number][]
  }, [result.skipped])
  const droppedFields = Object.entries(result.dropped).filter(([, count]) => count > 0)
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {busy
          ? `${(progress?.sent ?? 0).toLocaleString()} of ${(progress?.total ?? 0).toLocaleString()} rows sent.`
          : `Finished. ${result.created.toLocaleString()} added, ` +
            `${result.merged.toLocaleString()} updated, ` +
            `${result.skipped.length.toLocaleString()} skipped.`}
      </Typography>
      <LinearProgress
        variant="determinate"
        value={percent}
        sx={{ borderRadius: 1 }}
      />
      {skippedByReason.length ? (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{'Skipped'}</TableCell>
              <TableCell align="right">{'Rows'}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {skippedByReason.map(([reason, count]) => (
              <TableRow key={reason}>
                <TableCell>{CONTACT_IMPORT_SKIP_LABELS[reason] ?? reason}</TableCell>
                <TableCell align="right">{count}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      {droppedFields.length ? (
        <Alert severity="info">
          <AlertTitle>{'Some values could not be read'}</AlertTitle>
          {'The rows were imported without them: ' +
            droppedFields
              .map(([field, count]) => `${droppedFieldLabel(field, fields)} (${count})`)
              .join(', ') +
            '.'}
        </Alert>
      ) : null}
      {result.ownersUnresolved.length ? (
        <Alert severity="info">
          {'No team member has these owner addresses, so those contacts ' +
            `have no owner: ${result.ownersUnresolved.slice(0, 5).join(', ')}` +
            (result.ownersUnresolved.length > 5
              ? ` and ${result.ownersUnresolved.length - 5} more.`
              : '.')}
        </Alert>
      ) : null}
      {result.companiesCreated ? (
        <Typography variant="body2" color="text.secondary">
          {`${result.companiesCreated.toLocaleString()} new ${
            result.companiesCreated === 1 ? 'company' : 'companies'
          } created from the company column.`}
        </Typography>
      ) : null}
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
        {result.skipped.length ? (
          <Button variant="outlined" onClick={onDownloadSkipped}>
            {'Download skipped rows'}
          </Button>
        ) : null}
        {!busy ? (
          <Button variant="outlined" onClick={onAnother}>
            {'Import another file'}
          </Button>
        ) : null}
      </Stack>
    </Stack>
  )
}

/**
 * The "Import CSV" action, with the drawer it opens.
 *
 * Owns its own open state and mounts the drawer only once it has been
 * opened, so the contacts list pays nothing — no hooks, no listeners, no
 * roster read — for a feature the operator has not reached for. That is
 * the read-cost rule the list import's own page follows, and it is also
 * what lets the list mount this button with one element and no state of
 * its own.
 */
export function ContactImportButton(props: {
  hostId: string
  org?: ConsolePluginPageProps['org']
}) {
  const { hostId, org } = props
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const handleOpen = useCallback(() => {
    setMounted(true)
    setOpen(true)
  }, [])
  const handleClose = useCallback(() => setOpen(false), [])
  return (
    <>
      <Button size="small" onClick={handleOpen}>
        {'Import CSV'}
      </Button>
      {mounted ? (
        <ContactImportDrawer
          open={open}
          onClose={handleClose}
          hostId={hostId}
          org={org}
        />
      ) : null}
    </>
  )
}
ContactImportButton.displayName = 'ContactImportButton'

export default ContactImportDrawer
