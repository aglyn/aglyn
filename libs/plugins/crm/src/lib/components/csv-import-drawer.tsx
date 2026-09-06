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
 * IMPORTING A CSV INTO A CRM COLLECTION — the screen, for whichever
 * collection (AGL-2602, shared since AGL-2621).
 *
 * The contact import settled the walk from a file on disk to a result the
 * operator can act on: choose the file, read what is in it, match its
 * columns to fields with the first row beside each, preview the ten rows
 * the mapping produces, run it in bounded requests with a progress bar,
 * and report what was added, updated and skipped with the skipped rows as
 * a file to fix. A companies file walks the same path with a different
 * vocabulary, so the walk lives here once and each collection hands in a
 * {@link CsvImportVocabulary}: its fields and their labels, the one field
 * every row needs, its route, its tally, its template.
 *
 * ## The file is read in the browser, and judged on the server
 *
 * `parseCsv` — the same parser the list import and the dataset import run
 * — turns the file into cells here, so the operator can map and preview
 * without a round trip and without uploading a file they may still decide
 * not to import. Nothing is VALIDATED here beyond counting the rows whose
 * required cell is unusable, and that count is a courtesy: every row is
 * judged by the route, through the normalizers every other door uses, and
 * the numbers on the result panel are the server's.
 *
 * ## Bounded requests, and closing stops them
 *
 * A chunk per request, as many requests as the file needs, and a progress
 * bar between them. Closing the drawer mid-run stops the loop after the
 * request in flight; the rows already written stay written and the result
 * panel says how far it got. There is no durable job to resume — an import
 * is idempotent by construction (the door dedupes on the address, or the
 * domain and the name), so running the same file again finishes what a
 * closed drawer left, reporting the earlier rows as merged.
 */

import {
  customImportTarget,
  customImportTargetKey,
  type ImportChunkResult,
  type ImportSkippedRow,
  LIST_IMPORT_MAX_CHARACTERS,
  parseCsv,
} from '@aglyn/aglyn'
import { ICON_VARIANT_CLOSE } from '@aglyn/shared-data-enums'
import { Container, HelpTip, MdiIcon, SrOnly } from '@aglyn/shared-ui-jsx'
import { NavigationDrawerComponent } from '@aglyn/shared-ui-jsx/components/navigation-drawer.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
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
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { downloadTextFile } from '../model/contacts-csv'

/** A column's target: a standard field, or a custom one as `custom:<key>`. */
export type CsvImportTarget<F extends string> = F | `custom:${string}`

/** Column index → target. A column absent from the map is not imported. */
export type CsvImportMapping<F extends string> = Record<number, CsvImportTarget<F>>

/** A custom field a column may be mapped to, when the collection has any. */
export interface CsvImportCustomField {
  key: string
  label: string
}

/**
 * Everything one collection's import says for itself. Pure values and pure
 * functions, so a vocabulary is built once outside React and handed in.
 */
export interface CsvImportVocabulary<
  F extends string,
  R extends Record<string, unknown>,
  S extends ImportSkippedRow<string>,
> {
  /** The drawer's title — "Import contacts from CSV". */
  title: string
  help: ComponentProps<typeof HelpTip>
  /** The paragraph under the title. */
  intro: string
  /** The standard targets, in the order the mapping menu lists them. */
  fields: readonly F[]
  fieldLabels: Record<F, string>
  /** Custom targets, offered after the standard ones; none for most collections. */
  customFields?: readonly CsvImportCustomField[]
  /** The one field every row needs, and what the drawer says when it is unmapped. */
  requiredField: F
  requiredWarning: string
  /**
   * Whether a required cell is one the server would refuse — the courtesy
   * count the preview shows. Absent, only a blank cell counts.
   */
  unusable?: (cell: string) => boolean
  /** The preview's sentence about them. */
  unusableNotice: (count: number, total: number) => string
  guessMapping: (columns: readonly string[]) => CsvImportMapping<F>
  mapRow: (cells: readonly string[], mapping: CsvImportMapping<F>) => R
  /** The browser-side URL of the route one chunk is posted to. */
  route: string
  maxRows: number
  chunkSize: number
  previewRows: number
  emptyResult: () => ImportChunkResult<S>
  mergeResults: (
    total: ImportChunkResult<S>,
    chunk: ImportChunkResult<S>,
    offset: number,
  ) => ImportChunkResult<S>
  skipLabels: Record<S['reason'], string>
  skippedCsv: (
    columns: readonly string[],
    entries: readonly { cells: readonly string[]; reason: S['reason'] }[],
  ) => string
  skippedFileName: string
  /** The export's header over no rows. */
  templateCsv: () => string
  templateFileName: string
  /** The result panel's collection-specific lines, when there are any. */
  resultExtras?: (result: ImportChunkResult<S>) => ReactNode
}

export interface CsvImportDrawerProps<
  F extends string,
  R extends Record<string, unknown>,
  S extends ImportSkippedRow<string>,
> {
  open: boolean
  onClose: () => void
  hostId: string
  vocabulary: CsvImportVocabulary<F, R, S>
}

/** The value the mapping select shows for a column that is not imported. */
const SKIP_TARGET = ''

/** What a target is called — a standard field's label, or the custom field's. */
function targetLabel<F extends string>(
  target: string,
  vocabulary: Pick<CsvImportVocabulary<F, never, never>, 'fieldLabels' | 'customFields'>,
): string {
  const customKey = customImportTargetKey(target)
  if (customKey) {
    return vocabulary.customFields?.find((field) => field.key === customKey)?.label ?? customKey
  }
  return vocabulary.fieldLabels[target as F] ?? target
}

/** What a dropped-value field is called in the result panel — the label without its hint. */
function droppedFieldLabel<F extends string>(
  field: string,
  vocabulary: Pick<CsvImportVocabulary<F, never, never>, 'fieldLabels' | 'customFields'>,
): string {
  return targetLabel(field, vocabulary).replace(/ \(.*\)$/, '')
}

export function CsvImportDrawer<
  F extends string,
  R extends Record<string, unknown>,
  S extends ImportSkippedRow<string>,
>(props: CsvImportDrawerProps<F, R, S>) {
  const { open, onClose, hostId, vocabulary } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()

  const [fileName, setFileName] = useState('')
  const [columns, setColumns] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  /** How many rows the file had past the ceiling, so the drawer can say so. */
  const [overCeiling, setOverCeiling] = useState(0)
  const [mapping, setMapping] = useState<CsvImportMapping<F>>({})
  const [result, setResult] = useState<ImportChunkResult<S> | null>(null)
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
          'That file needs a header row and at least one row under it.',
          { variant: 'warning', allowDuplicate: true },
        )
      }
      const header = table[0].map((cell) => String(cell ?? '').trim())
      const body = table.slice(1)
      setFileName(file.name)
      setColumns(header)
      setRows(body.slice(0, vocabulary.maxRows))
      setOverCeiling(Math.max(0, body.length - vocabulary.maxRows))
      setMapping(vocabulary.guessMapping(header))
      setResult(null)
      setProgress(null)
    },
    [enqueueSnackbar, vocabulary],
  )

  const requiredMapped = Object.values(mapping).includes(vocabulary.requiredField)
  /** Rows whose required cell the server would refuse. */
  const unusableRows = useMemo(() => {
    const at = Number(
      Object.entries(mapping).find(
        ([, target]) => target === vocabulary.requiredField,
      )?.[0] ?? -1,
    )
    if (at < 0) return rows.length
    const unusable = vocabulary.unusable ?? ((cell: string) => !cell.trim())
    return rows.filter((cells) => unusable(String(cells[at] ?? ''))).length
  }, [mapping, rows, vocabulary])

  const preview = useMemo(
    () =>
      rows
        .slice(0, vocabulary.previewRows)
        .map((cells) => vocabulary.mapRow(cells, mapping)),
    [rows, mapping, vocabulary],
  )
  const mappedTargets = useMemo(
    () =>
      Object.entries(mapping)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, target]) => target),
    [mapping],
  )

  const handleMap = useCallback((index: number, target: string) => {
    setMapping((previous) => {
      const next: CsvImportMapping<F> = {}
      for (const [column, existing] of Object.entries(previous)) {
        // One column per target: choosing a target already taken moves it
        // here rather than importing one field from two columns.
        if (Number(column) !== index && existing !== target) {
          next[Number(column)] = existing
        }
      }
      if (target !== SKIP_TARGET) next[index] = target as CsvImportTarget<F>
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
    if (busy || !rows.length || !requiredMapped) return
    setBusy(true)
    let total = vocabulary.emptyResult()
    setResult(total)
    setProgress({ sent: 0, total: rows.length })
    try {
      for (let offset = 0; offset < rows.length; offset += vocabulary.chunkSize) {
        if (abandoned.current) return
        const chunk = rows
          .slice(offset, offset + vocabulary.chunkSize)
          .map((cells) => vocabulary.mapRow(cells, mapping))
        const response = await authorizedFetch(user, vocabulary.route, {
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
        total = vocabulary.mergeResults(total, payload as ImportChunkResult<S>, offset)
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
  }, [busy, rows, requiredMapped, mapping, user, hostId, enqueueSnackbar, vocabulary])

  const handleDownloadSkipped = useCallback(() => {
    if (!result?.skipped.length) return
    downloadTextFile(
      vocabulary.skippedFileName,
      'text/csv',
      vocabulary.skippedCsv(
        columns,
        result.skipped.map((entry) => ({
          cells: rows[entry.index] ?? [],
          reason: entry.reason as S['reason'],
        })),
      ),
    )
  }, [result, columns, rows, vocabulary])

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
            {vocabulary.title}
          </Typography>
          <HelpTip {...vocabulary.help} />
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
              vocabulary={vocabulary}
              onDownloadSkipped={handleDownloadSkipped}
              onAnother={reset}
            />
          ) : (
            <>
              <Typography variant="body2" color="text.secondary">
                {vocabulary.intro}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
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
                {/* The export's own header over no rows, so a sheet filled in
                    against it maps itself. */}
                <Button
                  size="small"
                  disabled={busy}
                  onClick={() =>
                    downloadTextFile(
                      vocabulary.templateFileName,
                      'text/csv',
                      vocabulary.templateCsv(),
                    )
                  }
                >
                  {'Download template'}
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
                    `rows. Only the first ${vocabulary.maxRows.toLocaleString()} ` +
                    'are imported — split the file and import the rest ' +
                    'separately.'}
                </Alert>
              ) : null}
              {columns.length ? (
                <ImportMappingTable
                  columns={columns}
                  sample={rows[0] ?? []}
                  mapping={mapping}
                  vocabulary={vocabulary}
                  onMap={handleMap}
                />
              ) : null}
              {columns.length > 0 && !requiredMapped ? (
                <Alert severity="warning">{vocabulary.requiredWarning}</Alert>
              ) : null}
              {columns.length > 0 && requiredMapped ? (
                <ImportPreviewTable
                  targets={mappedTargets}
                  preview={preview}
                  total={rows.length}
                  unusable={unusableRows}
                  vocabulary={vocabulary}
                />
              ) : null}
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                <Button
                  variant="contained"
                  disabled={busy || !rows.length || !requiredMapped}
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
CsvImportDrawer.displayName = 'CsvImportDrawer'

/**
 * WHICH COLUMN IS WHICH.
 *
 * One row per column in the file: its header, the first row's value under
 * it so the operator can tell "Title" the job from "Title" the honorific,
 * and a select naming where it goes. The proposal came from the alias
 * table; every row of this table is the operator's to overrule.
 */
function ImportMappingTable<F extends string>(props: {
  columns: readonly string[]
  sample: readonly string[]
  mapping: CsvImportMapping<F>
  vocabulary: Pick<CsvImportVocabulary<F, never, never>, 'fields' | 'fieldLabels' | 'customFields'>
  onMap: (index: number, target: string) => void
}) {
  const { columns, sample, mapping, vocabulary, onMap } = props
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
                  {vocabulary.fields.map((field) => (
                    <MenuItem key={field} value={field}>
                      {vocabulary.fieldLabels[field]}
                    </MenuItem>
                  ))}
                  {(vocabulary.customFields ?? []).map((field) => (
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
 * The first rows, as the mapping reads them.
 *
 * Verbatim cell values under the fields they were mapped to — not the
 * normalized ones, because normalization is the server's and a preview that
 * showed a cleaned phone number would be promising a result the route may
 * refuse. What it does say is how many rows have no usable required cell,
 * since that is the one refusal the operator can fix before sending.
 */
function ImportPreviewTable<F extends string>(props: {
  targets: readonly string[]
  preview: readonly Record<string, unknown>[]
  total: number
  unusable: number
  vocabulary: Pick<
    CsvImportVocabulary<F, never, never>,
    'fieldLabels' | 'customFields' | 'previewRows' | 'unusableNotice'
  >
}) {
  const { targets, preview, total, unusable, vocabulary } = props
  const cell = (row: Record<string, unknown>, target: string) => {
    const customKey = customImportTargetKey(target)
    if (customKey) {
      return String((row['custom'] as Record<string, string> | undefined)?.[customKey] ?? '')
    }
    return String(row[target] ?? '')
  }
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">
        {`Preview — first ${Math.min(preview.length, vocabulary.previewRows)} of ${total.toLocaleString()}`}
      </Typography>
      {unusable > 0 ? (
        <Alert severity="info">{vocabulary.unusableNotice(unusable, total)}</Alert>
      ) : null}
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              {targets.map((target) => (
                <TableCell key={target}>{targetLabel(target, vocabulary)}</TableCell>
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
function ImportResultPanel<F extends string, S extends ImportSkippedRow<string>>(props: {
  result: ImportChunkResult<S>
  progress: { sent: number; total: number } | null
  busy: boolean
  vocabulary: Pick<
    CsvImportVocabulary<F, never, S>,
    'fieldLabels' | 'customFields' | 'skipLabels' | 'resultExtras'
  >
  onDownloadSkipped: () => void
  onAnother: () => void
}) {
  const { result, progress, busy, vocabulary, onDownloadSkipped, onAnother } = props
  const percent = progress?.total
    ? Math.min((progress.sent / progress.total) * 100, 100)
    : 0
  const skippedByReason = useMemo(() => {
    const counts: Partial<Record<string, number>> = {}
    for (const entry of result.skipped) {
      counts[entry.reason] = (counts[entry.reason] ?? 0) + 1
    }
    return Object.entries(counts) as [S['reason'], number][]
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
                <TableCell>{vocabulary.skipLabels[reason] ?? reason}</TableCell>
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
              .map(([field, count]) => `${droppedFieldLabel(field, vocabulary)} (${count})`)
              .join(', ') +
            '.'}
        </Alert>
      ) : null}
      {result.ownersUnresolved.length ? (
        <Alert severity="info">
          {'No team member has these owner addresses, so those rows ' +
            `have no owner: ${result.ownersUnresolved.slice(0, 5).join(', ')}` +
            (result.ownersUnresolved.length > 5
              ? ` and ${result.ownersUnresolved.length - 5} more.`
              : '.')}
        </Alert>
      ) : null}
      {vocabulary.resultExtras?.(result)}
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
 * An "Import CSV" button that mounts its drawer only once it has been
 * opened, so the list pays nothing — no hooks, no listeners — for a
 * feature the operator has not reached for.
 */
export function CsvImportButton(props: {
  label?: string
  children: (open: boolean, onClose: () => void) => ReactNode
}) {
  const { label = 'Import CSV', children } = props
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
        {label}
      </Button>
      {mounted ? children(open, handleClose) : null}
    </>
  )
}
CsvImportButton.displayName = 'CsvImportButton'

export default CsvImportDrawer
