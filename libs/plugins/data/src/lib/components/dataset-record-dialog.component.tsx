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
  type DatasetModel,
  type DatasetRecordField,
  type DatasetReferenceResolver,
  datasetRecordFields,
  validateDocument,
} from '@aglyn/aglyn'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { useMemo } from 'react'

/**
 * Looking at a record, as its own gesture.
 *
 * The records table has room for the model's columns and one line per value,
 * so the only way to see what a record actually holds was to open it in the
 * EDITOR — which made reading a record and changing one the same click, on a
 * dialog whose primary button writes. This is the other half: the whole
 * record, nothing writable.
 *
 * ## It reads nothing
 *
 * Every value on screen arrives as a prop, out of the page the table already
 * listens to. There is no query, no `getDoc`, and no effect — opening a record
 * costs zero documents, and rendering the table does not open one dialog per
 * row to find out. That is not an optimization detail: a viewer that fetched
 * the record it was handed would bill a read per glance, and one that mounted
 * per row would bill the whole page on arrival.
 *
 * ## Read-only means read-only
 *
 * Nothing here takes input and nothing here writes. `Edit record` is a
 * separate, explicitly labelled action that closes this and opens the editor —
 * the dialog that has always owned writing — so the two gestures stay
 * distinct rather than one being a slip away from the other.
 */
export interface DatasetRecordDialogProps {
  /**
   * The record row itself, straight from the table's page. `null` closes the
   * dialog — including when the row leaves the page under it, which is the
   * honest response to a record this reader can no longer see.
   */
  record: { $id: string; values?: Record<string, unknown> } | null
  model: DatasetModel
  /** Reference target ID → label, or `null` when it resolves to nothing. */
  resolveReference?: DatasetReferenceResolver
  onClose: () => void
  /**
   * Opens the record in the editor. Omitted for a reader who cannot write, so
   * the control is absent rather than present-and-refusing.
   */
  onEdit?: () => void
}

/** What each "no value" state is called on screen. */
const PLACEHOLDER: Record<string, string> = {
  absent: 'Not set',
  null: 'Null',
  'empty-text': 'Empty text',
  'empty-list': 'Empty list',
  'empty-map': 'Empty map',
}

/**
 * One field's value.
 *
 * The four empty states get four different words, deliberately. A table cell
 * prints `--` for all of them because it has one line to work with; here there
 * is room to say which, and the difference decides what a reader does next —
 * a field that was never written and a field holding a real empty string are
 * not the same finding.
 */
function RecordFieldValue(props: { field: DatasetRecordField }) {
  const { value } = props.field
  if (value.kind === 'opaque') {
    return (
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ fontStyle: 'italic' }}
      >
        {value.text}
      </Typography>
    )
  }
  if (value.kind !== 'value') {
    return (
      <Typography
        variant="body2"
        color="text.disabled"
        sx={{ fontStyle: 'italic' }}
      >
        {PLACEHOLDER[value.kind] ?? 'Not set'}
      </Typography>
    )
  }
  if (value.references) {
    return (
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
        {value.references.map((reference) => (
          <Typography
            key={reference.id}
            variant="body2"
            // An unresolved target is a fact about the data, not a rendering
            // failure to paper over: the ID is shown either way, and only the
            // resolved one is allowed to look like a working link.
            color={reference.label ? 'text.primary' : 'warning.main'}
            sx={{ overflowWrap: 'anywhere' }}
          >
            {reference.label ?? `${reference.id} · unresolved`}
          </Typography>
        ))}
      </Stack>
    )
  }
  return (
    <Typography
      variant="body2"
      // Pretty-printed JSON is only readable where its whitespace survives.
      {...(value.block
        ? {
            component: 'pre',
            sx: {
              m: 0,
              fontFamily: 'monospace',
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
            },
          }
        : { sx: { overflowWrap: 'anywhere' } })}
    >
      {value.text}
    </Typography>
  )
}
RecordFieldValue.displayName = 'RecordFieldValue'

export function DatasetRecordDialog(props: DatasetRecordDialogProps) {
  const { record, model, resolveReference, onClose, onEdit } = props
  const values = record?.values
  const fields = useMemo(
    () => (record ? datasetRecordFields(model, values, resolveReference) : []),
    [record, model, values, resolveReference],
  )
  /**
   * The same mismatch report the editor shows, for the same reason: a type
   * change never rewrites stored documents, so a record may legitimately hold
   * a value its model no longer describes. Reporting it beside the value is
   * what stops the view claiming the record conforms.
   */
  const mismatches = useMemo(
    () => (record ? validateDocument(model, values ?? {}) : {}),
    [record, model, values],
  )

  return (
    <Dialog
      open={Boolean(record)}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="dataset-record-view-title"
    >
      <DialogTitle id="dataset-record-view-title">{'View record'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Box>
            <Typography
              variant="overline"
              color="text.secondary"
              component="div"
            >
              {'Record ID'}
            </Typography>
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
              {record?.$id ?? ''}
            </Typography>
          </Box>
          {fields.map((field) => (
            <Box key={field.fieldId}>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}
              >
                <Typography
                  variant="overline"
                  color="text.secondary"
                  component="div"
                >
                  {field.label}
                </Typography>
                {field.source === 'extra' ? (
                  <Tooltip
                    title={
                      'Stored on this record with no field in the ' +
                      'collection’s schema. The table cannot show it, and ' +
                      'the next save through the editor removes it.'
                    }
                  >
                    <Typography
                      variant="caption"
                      color="warning.main"
                      sx={{ cursor: 'help' }}
                    >
                      {'not in schema'}
                    </Typography>
                  </Tooltip>
                ) : null}
              </Stack>
              <RecordFieldValue field={field} />
              {mismatches[field.fieldId] ? (
                <Typography variant="caption" color="warning.main">
                  {mismatches[field.fieldId]}
                </Typography>
              ) : null}
              {field.description ? (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  component="div"
                >
                  {field.description}
                </Typography>
              ) : null}
            </Box>
          ))}
          {fields.length === 0 ? (
            <Alert severity="info">{'This record holds no fields.'}</Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        {onEdit ? <Button onClick={onEdit}>{'Edit record'}</Button> : null}
        <Button variant="contained" color="primary" onClick={onClose}>
          {'Close'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
DatasetRecordDialog.displayName = 'DatasetRecordDialog'

export default DatasetRecordDialog
