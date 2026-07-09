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
  DATASET_FIELD_PATTERN,
  DATASET_FIELD_TYPE_LABELS,
  DATASET_FIELD_TYPES,
  type DatasetFieldDefinition,
  type DatasetFieldType,
  type DatasetModel,
  effectiveDatasetModel,
} from '@aglyn/aglyn'
import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { doc, updateDoc } from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'

/** Types surfaced in the picker; the rest exist for compat, not authoring. */
const AUTHORABLE_TYPES: DatasetFieldType[] = [
  'text',
  'bool',
  'int32',
  'float',
  'timestamp',
  'coordinates',
  'sorted',
  'reference',
]

/** Display name → stable fieldId (slug); never changes after creation. */
function toFieldId(name: string, taken: Set<string>): string | null {
  let id = name
    .trim()
    .replace(/[^A-Za-z0-9_ ]/g, '')
    .replace(/\s+(.)/g, (_, char: string) => char.toUpperCase())
    .replace(/\s/g, '')
  if (!id) return null
  if (!/^[A-Za-z]/.test(id)) id = `f${id}`
  if (!DATASET_FIELD_PATTERN.test(id)) return null
  let candidate = id
  let suffix = 2
  while (taken.has(candidate.toLowerCase())) candidate = `${id}${suffix++}`
  return candidate
}

export interface DatasetSchemaDialogProps {
  hostId: string
  dataset: {
    $id: string
    displayName?: string
    fields?: string[]
    model?: DatasetModel
    names?: { singular?: string; plural?: string }
  } | null
  /** All host collections, for reference-field target pickers (AGL-180). */
  datasets?: Array<{
    $id: string
    displayName?: string
    fields?: string[]
    model?: DatasetModel
  }>
  recordCount: number
  onClose: () => void
}

/**
 * Model builder (AGL-178): edits the AGL-177 typed model on a dataset —
 * singular/plural display names (dod.ts Schema.Name), add/edit/remove/
 * reorder fields, per-field type/required/default/description/validation.
 * Schema-change policies (documented per the issue): type changes never
 * rewrite documents — non-conforming values surface in the editor when it
 * validates (AGL-179); removed fields leave orphaned values that strip
 * lazily on next document save; fieldIds are stable keys — only display
 * names rename.
 */
export function DatasetSchemaDialog(props: DatasetSchemaDialogProps) {
  const { hostId, dataset, datasets, recordCount, onClose } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()

  const [model, setModel] = useState<DatasetModel>({ fields: {}, order: [] })
  const [names, setNames] = useState<{ singular: string; plural: string }>({
    singular: '',
    plural: '',
  })
  useEffect(() => {
    if (!dataset) return
    const effective = effectiveDatasetModel(dataset)
    setModel({
      fields: JSON.parse(JSON.stringify(effective.fields)),
      order: [...effective.order],
    })
    setNames({
      singular: dataset.names?.singular ?? '',
      plural: dataset.names?.plural ?? dataset.displayName ?? '',
    })
  }, [dataset])

  // Per-field editor (null fieldId = new field).
  const [fieldEditor, setFieldEditor] = useState<{
    fieldId: string | null
    definition: DatasetFieldDefinition
    optionsText: string
  } | null>(null)

  const openFieldEditor = useCallback(
    (fieldId: string | null) => () => {
      const definition: DatasetFieldDefinition = fieldId
        ? JSON.parse(JSON.stringify(model.fields[fieldId]))
        : { name: '', type: 'text' }
      setFieldEditor({
        fieldId,
        definition,
        optionsText: (definition.validation?.options ?? []).join(', '),
      })
    },
    [model],
  )

  const handleFieldSave = useCallback(async () => {
    if (!fieldEditor) return
    const definition = { ...fieldEditor.definition }
    if (!definition.name.trim()) return
    definition.name = definition.name.trim()
    const options = fieldEditor.optionsText
      .split(',')
      .map((option) => option.trim())
      .filter(Boolean)
    definition.validation = {
      ...(definition.validation ?? {}),
      ...(options.length ? { options } : {}),
    }
    if (!options.length) delete definition.validation.options
    if (!Object.keys(definition.validation).length) delete definition.validation

    let fieldId = fieldEditor.fieldId
    if (!fieldId) {
      fieldId = toFieldId(
        definition.name,
        new Set(model.order.map((id) => id.toLowerCase())),
      )
      if (!fieldId) {
        return void enqueueSnackbar('Field name must start with a letter', {
          variant: 'warning',
          persist: false,
        })
      }
    } else if (
      recordCount > 0 &&
      model.fields[fieldId] &&
      model.fields[fieldId].type !== definition.type
    ) {
      // Documented policy: changing a type never rewrites documents;
      // existing values that no longer conform get flagged when edited.
      const confirmed = await confirm({
        title: 'Change field type?',
        description:
          `${recordCount} document${recordCount === 1 ? '' : 's'} exist. ` +
          'Stored values are not rewritten — ones that no longer match ' +
          `"${DATASET_FIELD_TYPE_LABELS[definition.type]}" will be flagged ` +
          'when documents are next edited.',
        confirmationText: 'Change type',
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
    }
    setModel((prev) => ({
      fields: { ...prev.fields, [fieldId as string]: definition },
      order: prev.order.includes(fieldId as string)
        ? prev.order
        : [...prev.order, fieldId as string],
    }))
    setFieldEditor(null)
  }, [fieldEditor, model, recordCount, confirm, enqueueSnackbar])

  const handleFieldRemove = useCallback(
    (fieldId: string) => async () => {
      const confirmed = await confirm({
        title: `Remove field "${model.fields[fieldId]?.name ?? fieldId}"?`,
        description:
          'Existing documents keep their stored value until they are next ' +
          'saved (it is stripped then). Bindings using this field stop ' +
          'resolving.',
        confirmationText: 'Remove',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      setModel((prev) => {
        const fields = { ...prev.fields }
        delete fields[fieldId]
        return { fields, order: prev.order.filter((id) => id !== fieldId) }
      })
    },
    [model, confirm],
  )

  const moveField = useCallback(
    (fieldId: string, delta: number) => () =>
      setModel((prev) => {
        const index = prev.order.indexOf(fieldId)
        const target = index + delta
        if (index < 0 || target < 0 || target >= prev.order.length) return prev
        const order = [...prev.order]
        order.splice(index, 1)
        order.splice(target, 0, fieldId)
        return { ...prev, order }
      }),
    [],
  )

  const handleSave = useCallback(async () => {
    if (!dataset) return
    if (!model.order.length) {
      return void enqueueSnackbar('A collection needs at least one field', {
        variant: 'warning',
        persist: false,
      })
    }
    await updateDoc(doc(firestore, 'hosts', hostId, 'datasets', dataset.$id), {
      model,
      names: {
        singular: names.singular.trim(),
        plural: names.plural.trim(),
      },
      ...(names.plural.trim() ? { displayName: names.plural.trim() } : {}),
      // v1 compat: keep the flat column list mirroring the model order so
      // unmigrated consumers (AGL-103 bindings) keep working.
      fields: model.order,
    })
      .then(() => {
        enqueueSnackbar('Schema saved', { variant: 'success', persist: false })
        onClose()
      })
      .catch(() =>
        enqueueSnackbar('An error has occurred', { variant: 'error' }),
      )
  }, [dataset, model, names, firestore, hostId, enqueueSnackbar, onClose])

  const editorDefinition = fieldEditor?.definition

  return (
    <>
      <Dialog
        open={Boolean(dataset)}
        onClose={onClose}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{`Schema — ${dataset?.displayName ?? ''}`}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            <TextField
              size="small"
              label="Singular name"
              value={names.singular}
              onChange={(event) =>
                setNames((prev) => ({ ...prev, singular: event.target.value }))
              }
              helperText="e.g. Product"
            />
            <TextField
              size="small"
              label="Plural name"
              value={names.plural}
              onChange={(event) =>
                setNames((prev) => ({ ...prev, plural: event.target.value }))
              }
              helperText="e.g. Products (shown as the title)"
            />
          </Stack>
          <Stack spacing={0.5}>
            {model.order.map((fieldId, index) => {
              const field = model.fields[fieldId]
              if (!field) return null
              return (
                <Stack
                  key={fieldId}
                  direction="row"
                  spacing={1}
                  sx={{
                    alignItems: 'center',
                    px: 1,
                    py: 0.5,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                  }}
                >
                  <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                    {field.name}
                    <Typography
                      component="span"
                      variant="caption"
                      color="text.secondary"
                    >
                      {` · ${fieldId}`}
                    </Typography>
                  </Typography>
                  <Chip
                    size="small"
                    label={DATASET_FIELD_TYPE_LABELS[field.type] ?? field.type}
                  />
                  {field.required || field.validation?.required ? (
                    <Chip size="small" color="secondary" label="required" />
                  ) : null}
                  <IconButton
                    size="small"
                    disabled={index === 0}
                    onClick={moveField(fieldId, -1)}
                    aria-label="Move up"
                  >
                    {'▲'}
                  </IconButton>
                  <IconButton
                    size="small"
                    disabled={index === model.order.length - 1}
                    onClick={moveField(fieldId, 1)}
                    aria-label="Move down"
                  >
                    {'▼'}
                  </IconButton>
                  <Button size="small" onClick={openFieldEditor(fieldId)}>
                    {'Edit'}
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    onClick={handleFieldRemove(fieldId)}
                  >
                    {'Remove'}
                  </Button>
                </Stack>
              )
            })}
          </Stack>
          <Button
            size="small"
            variant="outlined"
            color="secondary"
            onClick={openFieldEditor(null)}
            sx={{ alignSelf: 'flex-start' }}
          >
            {'Add field'}
          </Button>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{'Cancel'}</Button>
          <Button variant="contained" color="secondary" onClick={handleSave}>
            {'Save schema'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(fieldEditor)}
        onClose={() => setFieldEditor(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {fieldEditor?.fieldId ? 'Edit field' : 'New field'}
        </DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <TextField
            size="small"
            label="Display name"
            value={editorDefinition?.name ?? ''}
            autoFocus
            onChange={(event) =>
              setFieldEditor((prev) =>
                prev
                  ? {
                      ...prev,
                      definition: {
                        ...prev.definition,
                        name: event.target.value,
                      },
                    }
                  : prev,
              )
            }
            sx={{ mt: 1 }}
            helperText={
              fieldEditor?.fieldId
                ? `Field id "${fieldEditor.fieldId}" is a stable key and cannot change`
                : 'The field id is derived from this once, then never changes'
            }
          />
          <TextField
            select
            size="small"
            label="Type"
            value={editorDefinition?.type ?? 'text'}
            onChange={(event) =>
              setFieldEditor((prev) =>
                prev
                  ? {
                      ...prev,
                      definition: {
                        ...prev.definition,
                        type: event.target.value as DatasetFieldType,
                      },
                    }
                  : prev,
              )
            }
          >
            {(fieldEditor?.fieldId &&
            editorDefinition &&
            !AUTHORABLE_TYPES.includes(editorDefinition.type)
              ? DATASET_FIELD_TYPES
              : AUTHORABLE_TYPES
            ).map((type) => (
              <MenuItem key={type} value={type}>
                {DATASET_FIELD_TYPE_LABELS[type]}
              </MenuItem>
            ))}
          </TextField>
          {editorDefinition?.type === 'reference' ? (
            <>
              <TextField
                select
                size="small"
                label="Target collection"
                value={editorDefinition?.reference?.datasetId ?? ''}
                onChange={(event) =>
                  setFieldEditor((prev) =>
                    prev
                      ? {
                          ...prev,
                          definition: {
                            ...prev.definition,
                            reference: {
                              ...(prev.definition.reference ?? {
                                datasetId: '',
                              }),
                              datasetId: event.target.value,
                            },
                          },
                        }
                      : prev,
                  )
                }
              >
                {(datasets ?? [])
                  .filter((target) => target.$id !== dataset?.$id)
                  .map((target) => (
                    <MenuItem key={target.$id} value={target.$id}>
                      {target.displayName ?? target.$id}
                    </MenuItem>
                  ))}
              </TextField>
              <TextField
                select
                size="small"
                label="Display field"
                value={editorDefinition?.reference?.displayFieldId ?? ''}
                onChange={(event) =>
                  setFieldEditor((prev) =>
                    prev?.definition.reference
                      ? {
                          ...prev,
                          definition: {
                            ...prev.definition,
                            reference: {
                              ...prev.definition.reference,
                              displayFieldId: event.target.value,
                            },
                          },
                        }
                      : prev,
                  )
                }
                helperText="Shown in pickers and grid cells"
              >
                {effectiveDatasetModel(
                  (datasets ?? []).find(
                    (target) =>
                      target.$id === editorDefinition?.reference?.datasetId,
                  ) ?? {},
                ).order.map((targetFieldId) => (
                  <MenuItem key={targetFieldId} value={targetFieldId}>
                    {targetFieldId}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                size="small"
                label="When a referenced document is deleted"
                value={editorDefinition?.reference?.onDelete ?? 'setNull'}
                onChange={(event) =>
                  setFieldEditor((prev) =>
                    prev?.definition.reference
                      ? {
                          ...prev,
                          definition: {
                            ...prev.definition,
                            reference: {
                              ...prev.definition.reference,
                              onDelete: event.target.value as
                                | 'restrict'
                                | 'setNull',
                            },
                          },
                        }
                      : prev,
                  )
                }
              >
                <MenuItem value="setNull">{'Clear the reference'}</MenuItem>
                <MenuItem value="restrict">{'Block the delete'}</MenuItem>
              </TextField>
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={Boolean(editorDefinition?.reference?.multiple)}
                    onChange={(event) =>
                      setFieldEditor((prev) =>
                        prev?.definition.reference
                          ? {
                              ...prev,
                              definition: {
                                ...prev.definition,
                                reference: {
                                  ...prev.definition.reference,
                                  multiple: event.target.checked,
                                },
                              },
                            }
                          : prev,
                      )
                    }
                  />
                }
                label="Allow multiple (many-to-many)"
              />
            </>
          ) : null}
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={Boolean(editorDefinition?.required)}
                onChange={(event) =>
                  setFieldEditor((prev) =>
                    prev
                      ? {
                          ...prev,
                          definition: {
                            ...prev.definition,
                            required: event.target.checked,
                          },
                        }
                      : prev,
                  )
                }
              />
            }
            label="Required"
          />
          <TextField
            size="small"
            label="Description"
            value={editorDefinition?.description ?? ''}
            onChange={(event) =>
              setFieldEditor((prev) =>
                prev
                  ? {
                      ...prev,
                      definition: {
                        ...prev.definition,
                        description: event.target.value,
                      },
                    }
                  : prev,
              )
            }
          />
          <TextField
            size="small"
            label="Default value"
            value={String(editorDefinition?.default ?? '')}
            onChange={(event) =>
              setFieldEditor((prev) =>
                prev
                  ? {
                      ...prev,
                      definition: {
                        ...prev.definition,
                        ...(event.target.value
                          ? { default: event.target.value }
                          : { default: undefined }),
                      },
                    }
                  : prev,
              )
            }
            helperText="Pre-filled when creating documents"
          />
          {editorDefinition?.type === 'text' ? (
            <>
              <TextField
                size="small"
                label="Pattern (regex)"
                value={editorDefinition?.validation?.regex ?? ''}
                onChange={(event) =>
                  setFieldEditor((prev) =>
                    prev
                      ? {
                          ...prev,
                          definition: {
                            ...prev.definition,
                            validation: {
                              ...(prev.definition.validation ?? {}),
                              ...(event.target.value
                                ? { regex: event.target.value }
                                : { regex: undefined }),
                            },
                          },
                        }
                      : prev,
                  )
                }
              />
              <TextField
                size="small"
                label="Options"
                value={fieldEditor?.optionsText ?? ''}
                onChange={(event) =>
                  setFieldEditor((prev) =>
                    prev ? { ...prev, optionsText: event.target.value } : prev,
                  )
                }
                helperText="Comma-separated enum, e.g. basic, plus"
              />
            </>
          ) : null}
          {editorDefinition &&
          ['int32', 'int64', 'float', 'timestamp', 'text'].includes(
            editorDefinition.type,
          ) ? (
            <Stack direction="row" spacing={1}>
              {(['min', 'max'] as const).map((bound) => (
                <TextField
                  key={bound}
                  size="small"
                  type="number"
                  label={
                    editorDefinition.type === 'text'
                      ? `${bound === 'min' ? 'Min' : 'Max'} length`
                      : bound === 'min'
                        ? 'Min'
                        : 'Max'
                  }
                  value={editorDefinition.validation?.[bound] ?? ''}
                  onChange={(event) =>
                    setFieldEditor((prev) =>
                      prev
                        ? {
                            ...prev,
                            definition: {
                              ...prev.definition,
                              validation: {
                                ...(prev.definition.validation ?? {}),
                                ...(event.target.value === ''
                                  ? { [bound]: undefined }
                                  : { [bound]: Number(event.target.value) }),
                              },
                            },
                          }
                        : prev,
                    )
                  }
                />
              ))}
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFieldEditor(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={!editorDefinition?.name.trim()}
            onClick={handleFieldSave}
          >
            {fieldEditor?.fieldId ? 'Save field' : 'Add field'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
DatasetSchemaDialog.displayName = 'DatasetSchemaDialog'

export default DatasetSchemaDialog
