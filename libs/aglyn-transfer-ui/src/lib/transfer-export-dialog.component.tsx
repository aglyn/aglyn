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
 * Export: every field offered, the person picks which.
 *
 * Presets fill the picker — Re-importable (the default: the Aglyn ID and
 * the match keys first, then every writable field, so the file comes back
 * in and finds its records), Everything, Minimal, the resource's own
 * presets (another product's layout, written under that product's column
 * names) and the presets the person saved. Any change after a preset is a
 * hand-picked list. The scope
 * (the selection, the current filter, or everything), the format and the
 * byte-order mark complete the choice, and the whole choice is remembered
 * through the client for the next export of the same resource.
 */

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import {
  TRANSFER_PRESET_IDS,
  buildTransferFieldCatalog,
  resolveTransferFieldSelection,
  resolveTransferPreset,
} from '@aglyn/aglyn/data-transfer'
import type {
  TransferFieldCatalog,
  TransferFormat,
  TransferPresetHints,
  TransferPresetId,
  TransferSavedPreset,
} from '@aglyn/aglyn/data-transfer'
import {
  Alert,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'

import type {
  TransferClient,
  TransferExportResponse,
  TransferExportScope,
  TransferExportScopeKind,
  TransferResourceInfo,
} from './transfer-client'
import { TransferChoiceSelect } from './transfer-choice-select.component'
import { TransferFieldPicker } from './transfer-field-picker.component'
import { countOf } from './transfer-words'

const PRESET_WORDS: Readonly<
  Record<TransferPresetId, { label: string; description: string }>
> = {
  reimportable: {
    label: 'Re-importable',
    description: `The ${PLATFORM_BRAND_NAME} ID, the match keys and every field an import can write.`,
  },
  everything: {
    label: 'Everything',
    description: 'Every field, including computed and system fields.',
  },
  minimal: {
    label: 'Minimal',
    description: `The ${PLATFORM_BRAND_NAME} ID, the match keys and the required fields.`,
  },
}

const FORMAT_WORDS: Readonly<Record<TransferFormat, string>> = {
  csv: 'CSV — opens in a spreadsheet',
  json: 'JSON — one array of records',
  ndjson: 'NDJSON — one record per line',
}

const CUSTOM_SELECTION = 'custom'

export interface TransferExportDialogProps {
  open: boolean
  onClose(): void
  client: TransferClient
  resource: string
  /** The dialog's title; defaults to "Export <resource label>". */
  title?: string
  /** The records the person selected, when there is a selection. */
  selection?: readonly string[]
  /** The list's current filter, when one is applied: what the server reads and how to name it. */
  filter?: { label: string; value: unknown }
  /** Saves the file; defaults to a browser download. */
  download?(result: TransferExportResponse): void
  onExported?(result: TransferExportResponse): void
}

/** The resource's preset hints; without its own, its match keys lead (the Aglyn ID always leads first). */
function presetHintsOf(info: TransferResourceInfo): TransferPresetHints {
  return (
    info.presetHints ?? {
      matchKeyFieldIds: info.matchKeys.map((key) => key.fieldId),
    }
  )
}

/** A file handed to the browser as a download. */
export function downloadTransferFile(fileName: string, body: Blob): void {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function')
    return
  const url = URL.createObjectURL(body)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function TransferExportDialog(props: TransferExportDialogProps) {
  const { open, onClose, client, resource, selection, filter } = props
  const [info, setInfo] = useState<TransferResourceInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [presetId, setPresetId] = useState<string>('reimportable')
  const [fieldIds, setFieldIds] = useState<string[]>([])
  const [unknown, setUnknown] = useState<string[]>([])
  const [format, setFormat] = useState<TransferFormat>('csv')
  const [bom, setBom] = useState(false)
  const [scope, setScope] = useState<TransferExportScopeKind>('all')
  const [presets, setPresets] = useState<TransferSavedPreset[]>([])
  const [presetName, setPresetName] = useState('')
  const [busy, setBusy] = useState(false)

  const catalog: TransferFieldCatalog | null = useMemo(
    () =>
      info
        ? buildTransferFieldCatalog({
            standard: info.fields,
            groups: info.groups,
          })
        : null,
    [info],
  )
  const selectionCount = selection?.length ?? 0
  const hasFilter = Boolean(filter)
  const hints = useMemo(() => (info ? presetHintsOf(info) : {}), [info])
  const resourcePresets = useMemo(() => info?.resourcePresets ?? [], [info])
  /*
   * A resource preset laid out for another product names its own columns;
   * they are written only while that preset is chosen as it stands — the
   * moment the person changes a field, the columns are the fields' labels.
   */
  const headers = resourcePresets.find((preset) => preset.id === presetId)
    ?.headers

  useEffect(() => {
    if (!open) return
    let live = true
    client
      .fields({ resource })
      .then((loaded) => {
        if (!live) return
        setError(null)
        const built = buildTransferFieldCatalog({
          standard: loaded.fields,
          groups: loaded.groups,
        })
        const loadedHints = presetHintsOf(loaded)
        const last = loaded.prefs.export
        const formats = loaded.resource.formats
        setInfo(loaded)
        setPresets(loaded.prefs.presets ?? [])
        setFormat(
          last && formats.includes(last.format)
            ? last.format
            : (formats[0] ?? 'csv'),
        )
        setBom(last?.bom ?? false)
        setScope(
          selectionCount
            ? 'selection'
            : hasFilter
              ? last?.scope === 'all'
                ? 'all'
                : 'filter'
              : 'all',
        )
        if (last?.fieldIds?.length) {
          const resolved = resolveTransferFieldSelection(built, last.fieldIds)
          setPresetId(last.presetId ?? CUSTOM_SELECTION)
          setFieldIds(resolved.fieldIds)
          setUnknown(resolved.unknown)
        } else {
          setPresetId('reimportable')
          setFieldIds(
            resolveTransferPreset(built, 'reimportable', loadedHints).fieldIds,
          )
          setUnknown([])
        }
      })
      .catch(
        (reason: unknown) =>
          live &&
          setError(
            reason instanceof Error
              ? reason.message
              : 'The fields could not be loaded.',
          ),
      )
    return () => {
      live = false
    }
  }, [open, client, resource, selectionCount, hasFilter])

  const choosePreset = (id: string) => {
    if (!catalog) return
    setPresetId(id)
    if (id === CUSTOM_SELECTION) return
    const saved =
      resourcePresets.find((preset) => preset.id === id) ??
      presets.find((preset) => preset.id === id)
    const resolved = resolveTransferPreset(
      catalog,
      saved ?? (id as TransferPresetId),
      hints,
    )
    setFieldIds(resolved.fieldIds)
    setUnknown(resolved.unknown)
  }

  const savePreset = async () => {
    const label = presetName.trim()
    if (!label || !fieldIds.length) return
    const preset: TransferSavedPreset = {
      id: `preset-${Date.now().toString(36)}`,
      label,
      fieldIds,
    }
    try {
      const saved = await client.savePrefs({
        resource,
        prefs: { presets: [...presets, preset] },
      })
      setPresets(saved.presets)
      setPresetId(preset.id)
      setPresetName('')
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'The preset could not be saved.',
      )
    }
  }

  const runExport = async () => {
    const exportScope: TransferExportScope =
      scope === 'selection'
        ? { kind: 'selection', ids: [...(selection ?? [])] }
        : scope === 'filter'
          ? { kind: 'filter', filter: filter?.value }
          : { kind: 'all' }
    setBusy(true)
    setError(null)
    try {
      const result = await client.export({
        resource,
        fieldIds,
        scope: exportScope,
        format,
        bom: format === 'csv' && bom,
        ...(headers && format === 'csv' ? { headers: { ...headers } } : {}),
      })
      ;(
        props.download ??
        ((file: TransferExportResponse) =>
          downloadTransferFile(file.fileName, file.body))
      )(result)
      await client.savePrefs({
        resource,
        prefs: {
          export: {
            presetId: presetId === CUSTOM_SELECTION ? null : presetId,
            fieldIds,
            format,
            bom,
            scope,
          },
        },
      })
      props.onExported?.(result)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The export failed.')
    } finally {
      setBusy(false)
    }
  }

  const title =
    props.title ??
    (info ? `Export ${info.resource.label.toLowerCase()}` : 'Export')
  const presetOptions = [
    ...TRANSFER_PRESET_IDS.map((id) => ({ value: id, ...PRESET_WORDS[id] })),
    ...resourcePresets.map((preset) => ({
      value: preset.id,
      label: preset.label,
      description:
        preset.description ?? countOf(preset.fieldIds.length, 'field'),
    })),
    ...presets.map((preset) => ({
      value: preset.id,
      label: preset.label,
      description: countOf(preset.fieldIds.length, 'field'),
    })),
    {
      value: CUSTOM_SELECTION,
      label: 'Hand-picked',
      description: 'The fields as you chose them below.',
    },
  ]

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      fullWidth
      maxWidth="md"
      aria-labelledby="transfer-export-title"
    >
      <DialogTitle id="transfer-export-title">{title}</DialogTitle>
      <DialogContent dividers>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}
        {!catalog ? (
          error ? null : (
            <CircularProgress aria-label="Loading fields" />
          )
        ) : (
          <Stack spacing={3}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              sx={{ alignItems: { sm: 'flex-start' } }}
            >
              <TransferChoiceSelect
                label="Preset"
                value={presetId}
                options={presetOptions}
                onChange={choosePreset}
                fullWidth
              />
              <Stack direction="row" spacing={1} sx={{ width: '100%' }}>
                <TextField
                  size="small"
                  fullWidth
                  label="Save these fields as"
                  value={presetName}
                  onChange={(event) => setPresetName(event.target.value)}
                />
                <Button
                  onClick={() => void savePreset()}
                  disabled={!presetName.trim() || !fieldIds.length}
                >
                  Save preset
                </Button>
              </Stack>
            </Stack>
            {unknown.length ? (
              <Alert severity="info">
                {countOf(unknown.length, 'field')} in this choice no longer{' '}
                {unknown.length === 1 ? 'exists' : 'exist'} and
                {unknown.length === 1 ? ' is' : ' are'} left out:{' '}
                {unknown.join(', ')}.
              </Alert>
            ) : null}
            <TransferFieldPicker
              catalog={catalog}
              selected={fieldIds}
              onChange={(next) => {
                setFieldIds(next)
                setPresetId(CUSTOM_SELECTION)
                setUnknown([])
              }}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3}>
              <FormControl>
                <FormLabel id="transfer-export-scope">Records</FormLabel>
                <RadioGroup
                  aria-labelledby="transfer-export-scope"
                  value={scope}
                  onChange={(event) =>
                    setScope(event.target.value as TransferExportScopeKind)
                  }
                >
                  <FormControlLabel
                    value="selection"
                    disabled={!selection?.length}
                    control={<Radio />}
                    label={
                      selection?.length
                        ? `The ${countOf(selection.length, 'selected record')}`
                        : 'The selected records (none selected)'
                    }
                  />
                  <FormControlLabel
                    value="filter"
                    disabled={!filter}
                    control={<Radio />}
                    label={
                      filter
                        ? `The current filter: ${filter.label}`
                        : 'The current filter (none applied)'
                    }
                  />
                  <FormControlLabel
                    value="all"
                    control={<Radio />}
                    label={`All ${info?.resource.label.toLowerCase() ?? 'records'}`}
                  />
                </RadioGroup>
              </FormControl>
              <FormControl>
                <FormLabel id="transfer-export-format">Format</FormLabel>
                <RadioGroup
                  aria-labelledby="transfer-export-format"
                  value={format}
                  onChange={(event) =>
                    setFormat(event.target.value as TransferFormat)
                  }
                >
                  {(info?.resource.formats ?? ['csv']).map((entry) => (
                    <FormControlLabel
                      key={entry}
                      value={entry}
                      control={<Radio />}
                      label={FORMAT_WORDS[entry]}
                    />
                  ))}
                </RadioGroup>
                {format === 'csv' ? (
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={bom}
                        onChange={(event) => setBom(event.target.checked)}
                      />
                    }
                    label="Start with a byte-order mark (for Excel)"
                  />
                ) : null}
              </FormControl>
            </Stack>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => void runExport()}
          disabled={busy || !catalog || !fieldIds.length}
        >
          {busy ? 'Exporting…' : `Export ${countOf(fieldIds.length, 'field')}`}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default TransferExportDialog
