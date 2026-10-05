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
 * Step 1, Upload: a file or pasted rows, read in the browser to show how
 * they read — format, encoding, separator and header row are guessed, shown
 * and changeable — and refused before anything is sent when the file is
 * larger, or longer, than the import takes.
 */

import { CSV_UPLOAD_MAX_CHARACTERS } from '@aglyn/aglyn/app-utils/csv-upload'
import type { TransferFormat } from '@aglyn/aglyn/data-transfer'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'

import type { TransferEncoding, TransferFileSettings } from './transfer-client'
import { TransferChoiceSelect } from './transfer-choice-select.component'
import {
  TRANSFER_DELIMITERS,
  TRANSFER_ENCODINGS,
  decodeBytes,
  detectEncoding,
  detectTransferFileSettings,
  formatBytes,
  parseTransferText,
  readFileBytes,
} from './transfer-file'
import { TransferWizardNav } from './transfer-wizard-nav.component'
import type { TransferImportWizardController } from './use-transfer-import-wizard'
import { countOf, displayTransferValue } from './transfer-words'

const PREVIEW_ROWS = 5

const FORMAT_LABELS: Readonly<Record<TransferFormat, string>> = {
  csv: 'CSV',
  json: 'JSON',
  ndjson: 'NDJSON',
}

interface Chosen {
  fileName: string
  bytes: number
  /** The file's bytes, kept so a different encoding can be tried. */
  raw: Uint8Array | null
  text: string
  settings: TransferFileSettings
}

export function ImportUploadStep({
  wizard,
}: {
  wizard: TransferImportWizardController
}) {
  const resource = wizard.info?.resource
  const maxBytes = resource?.limits?.maxBytes ?? CSV_UPLOAD_MAX_CHARACTERS
  const maxRows = resource?.limits?.maxRows
  const formats = resource?.formats ?? ['csv']
  const [chosen, setChosen] = useState<Chosen | null>(null)
  const [paste, setPaste] = useState('')
  const [readError, setReadError] = useState<string | null>(null)

  const parsed = useMemo(
    () => (chosen ? parseTransferText(chosen.text, chosen.settings) : null),
    [chosen],
  )
  const tooBig = chosen ? chosen.bytes > maxBytes : false
  const tooLong =
    parsed && maxRows !== undefined ? parsed.rows.length > maxRows : false

  const choose = async (file: File) => {
    setReadError(null)
    if (file.size > maxBytes) {
      setChosen({
        fileName: file.name,
        bytes: file.size,
        raw: null,
        text: '',
        settings: {
          format: 'csv',
          encoding: 'utf-8',
          delimiter: ',',
          headerRow: true,
        },
      })
      return
    }
    try {
      const raw = await readFileBytes(file)
      const encoding = detectEncoding(raw)
      const text = decodeBytes(raw, encoding)
      setChosen({
        fileName: file.name,
        bytes: file.size,
        raw,
        text,
        settings: detectTransferFileSettings(file.name, text, encoding),
      })
    } catch {
      setReadError('This file could not be read.')
    }
  }

  const readPaste = () => {
    const bytes = new TextEncoder().encode(paste).length
    setChosen({
      fileName: 'Pasted rows',
      bytes,
      raw: null,
      text: paste,
      settings: detectTransferFileSettings('', paste),
    })
  }

  const setSettings = (patch: Partial<TransferFileSettings>) => {
    setChosen((current) => {
      if (!current) return current
      const settings = { ...current.settings, ...patch }
      const text =
        patch.encoding && current.raw
          ? decodeBytes(current.raw, patch.encoding)
          : current.text
      return { ...current, text, settings }
    })
  }

  const blockers = [
    ...(tooBig
      ? [
          `This file is ${formatBytes(chosen!.bytes)}; this import takes at most ${formatBytes(maxBytes)}.`,
        ]
      : []),
    ...(tooLong
      ? [
          `This file has ${countOf(parsed!.rows.length, 'row')}; this import takes at most ${maxRows!.toLocaleString()}. Split it and import the rest separately.`,
        ]
      : []),
    ...(parsed?.error ? [parsed.error] : []),
    ...(parsed && !parsed.error && !tooBig && parsed.rows.length === 0
      ? ['This file has no rows to import.']
      : []),
    ...(chosen && !formats.includes(chosen.settings.format)
      ? [`This import does not take ${FORMAT_LABELS[chosen.settings.format]}.`]
      : []),
  ]

  return (
    <Stack spacing={2}>
      {wizard.draft.jobId && wizard.draft.fileName && !chosen ? (
        <Alert severity="info">
          {wizard.draft.fileName} is uploaded. Choose another file to start over
          with it.
        </Alert>
      ) : null}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ alignItems: { sm: 'center' } }}
      >
        <Button variant="outlined" component="label">
          Choose a file
          <input
            hidden
            type="file"
            aria-label="File to import"
            accept={formats
              .map((format) =>
                format === 'csv'
                  ? '.csv,.tsv,.txt,text/csv'
                  : format === 'json'
                    ? '.json,application/json'
                    : '.ndjson,.jsonl',
              )
              .join(',')}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void choose(file)
            }}
          />
        </Button>
        <Typography variant="body2" color="text.secondary">
          At most {formatBytes(maxBytes)}
          {maxRows ? ` and ${maxRows.toLocaleString()} rows` : ''}.
        </Typography>
      </Stack>
      <Stack spacing={1}>
        <TextField
          label="Or paste rows"
          multiline
          minRows={3}
          maxRows={8}
          value={paste}
          onChange={(event) => setPaste(event.target.value)}
        />
        <Box>
          <Button onClick={readPaste} disabled={!paste.trim()}>
            Read pasted rows
          </Button>
        </Box>
      </Stack>
      {readError ? <Alert severity="error">{readError}</Alert> : null}
      {chosen && !tooBig ? (
        <Stack spacing={2}>
          <Typography variant="subtitle2">
            {chosen.fileName} · {formatBytes(chosen.bytes)}
            {parsed && !parsed.error
              ? ` · ${countOf(parsed.rows.length, 'row')}, ${countOf(parsed.headers.length, 'column')}`
              : ''}
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TransferChoiceSelect
              label="Format"
              value={chosen.settings.format}
              options={(['csv', 'json', 'ndjson'] as const).map((format) => ({
                value: format,
                label: FORMAT_LABELS[format],
                disabled: !formats.includes(format),
              }))}
              onChange={(format) => setSettings({ format })}
            />
            {chosen.raw ? (
              <TransferChoiceSelect
                label="Encoding"
                value={chosen.settings.encoding}
                options={TRANSFER_ENCODINGS}
                onChange={(encoding: TransferEncoding) =>
                  setSettings({ encoding })
                }
              />
            ) : null}
            {chosen.settings.format === 'csv' ? (
              <TransferChoiceSelect
                label="Separator"
                value={chosen.settings.delimiter}
                options={TRANSFER_DELIMITERS}
                onChange={(delimiter) => setSettings({ delimiter })}
              />
            ) : null}
            {chosen.settings.format === 'csv' ? (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={chosen.settings.headerRow}
                    onChange={(event) =>
                      setSettings({ headerRow: event.target.checked })
                    }
                  />
                }
                label="The first row names the columns"
              />
            ) : null}
          </Stack>
          {parsed && !parsed.error && parsed.headers.length ? (
            <ScrollTable size="small" aria-label="Preview of the file">
              <TableHead>
                <TableRow>
                  {parsed.headers.map((header, column) => (
                    <TableCell key={column}>{header}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {parsed.rows.slice(0, PREVIEW_ROWS).map((row, index) => (
                  <TableRow key={index}>
                    {parsed.headers.map((_header, column) => (
                      <TableCell key={column}>
                        {displayTransferValue(row[column])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </ScrollTable>
          ) : null}
        </Stack>
      ) : null}
      <TransferWizardNav
        busy={wizard.busy}
        blockers={blockers}
        nextDisabled={chosen ? !parsed : !wizard.draft.jobId}
        onNext={
          chosen
            ? () =>
                void wizard.upload({
                  fileName: chosen.fileName,
                  text: chosen.text,
                  bytes: chosen.bytes,
                  settings: chosen.settings,
                })
            : wizard.draft.jobId
              ? () => void wizard.goTo('mapping')
              : undefined
        }
        nextLabel={chosen ? 'Upload and continue' : 'Next'}
      />
    </Stack>
  )
}

export default ImportUploadStep
