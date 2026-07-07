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
  createResourceUid,
  formatVariableValue,
  HOST_VARIABLE_TYPE_LABELS,
  type HostVariable,
  type HostVariableType,
  VARIABLE_NAME_PATTERN,
} from '@aglyn/aglyn'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { collection, doc, limit, query, setDoc, updateDoc } from 'firebase/firestore'
import { useCallback, useState } from 'react'
import { useFirestore, useFirestoreCollectionData } from 'reactfire'

export interface HostVariablesCardProps {
  hostId: string
}

interface VariableDraft {
  id: string | null
  name: string
  type: HostVariableType
  value: string
}

/** Per-type value editor: mirrors the mockup's type list. */
function VariableValueField(props: {
  draft: VariableDraft
  onChange: (value: string) => void
}) {
  const { draft, onChange } = props
  switch (draft.type) {
    case 'boolean':
      return (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Switch
            checked={draft.value === 'true'}
            onChange={(event) =>
              onChange(event.target.checked ? 'true' : 'false')
            }
          />
          <Typography variant="body2">
            {draft.value === 'true' ? 'True' : 'False'}
          </Typography>
        </Stack>
      )
    case 'date':
    case 'time':
      return (
        <TextField
          label="Value"
          type={draft.type}
          value={draft.value}
          onChange={(event) => onChange(event.target.value)}
          size="small"
          slotProps={{ inputLabel: { shrink: true } }}
        />
      )
    case 'number':
      return (
        <TextField
          label="Value"
          value={draft.value}
          onChange={(event) =>
            onChange(event.target.value.replace(/[^0-9.eE+-]/g, ''))
          }
          size="small"
        />
      )
    case 'dictionary':
    case 'collection':
      return (
        <TextField
          label="Value (JSON)"
          placeholder={
            draft.type === 'dictionary' ? '{"key": "value"}' : '["a", "b"]'
          }
          value={draft.value}
          onChange={(event) => onChange(event.target.value)}
          size="small"
          multiline
          minRows={3}
        />
      )
    default:
      return (
        <TextField
          label="Value"
          value={draft.value}
          onChange={(event) => onChange(event.target.value)}
          size="small"
          multiline
        />
      )
  }
}

/**
 * Host variables (Component Builder, AGL-91): the mockup's Edit Variable
 * dialog — name + typed value — persisted to `hosts/{hostId}/variables`.
 * Any string prop can reference a variable with `{{name}}`; the tenant
 * compose pipeline resolves it at render. Soft delete keeps old tokens
 * rendering literally rather than breaking published pages.
 */
export function HostVariablesCard(props: HostVariablesCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { data: variableDocs } = useFirestoreCollectionData<any>(
    query(collection(firestore, 'hosts', hostId, 'variables'), limit(100)),
    { idField: '$id' },
  )
  const variables = [...(variableDocs ?? [])]
    .filter((variable: any) => !variable.deletedAt)
    .sort((a: any, b: any) =>
      String(a.name ?? '').localeCompare(String(b.name ?? '')),
    )

  const [draft, setDraft] = useState<VariableDraft | null>(null)
  const validName = VARIABLE_NAME_PATTERN.test(draft?.name ?? '')
  const nameTaken = Boolean(
    draft &&
      variables.some(
        (variable: any) =>
          variable.name === draft.name && variable.$id !== draft.id,
      ),
  )

  const handleSave = useCallback(async () => {
    if (!draft || !validName || nameTaken) return
    try {
      const id = draft.id ?? createResourceUid()
      await setDoc(
        doc(firestore, 'hosts', hostId, 'variables', id),
        {
          name: draft.name,
          type: draft.type,
          value: draft.value,
          updatedAt: Timestamp.now(),
          ...(draft.id ? {} : { createdAt: Timestamp.now() }),
        },
        { merge: true },
      )
      setDraft(null)
      enqueueSnackbar(
        `Saved — use {{${draft.name}}} in any text to bind it`,
        { variant: 'success', persist: false },
      )
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [draft, validName, nameTaken, firestore, hostId, enqueueSnackbar])

  const handleDelete = useCallback(
    (variable: any) => async () => {
      const confirmed = await confirm({
        title: 'Delete this variable?',
        description:
          `Text using {{${variable.name}}} will show the token ` +
          'literally after the next publish.',
        confirmationText: 'Delete',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      await updateDoc(
        doc(firestore, 'hosts', hostId, 'variables', variable.$id),
        { deletedAt: Timestamp.now() },
      )
      enqueueSnackbar('Variable deleted', {
        variant: 'success',
        persist: false,
      })
    },
    [confirm, firestore, hostId, enqueueSnackbar],
  )

  return (
    <CardDisplay header={'Variables'} contentGutterX contentGutterY>
      <Stack spacing={1}>
        {variables.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'Define typed values once and bind them anywhere with ' +
              '{{name}} — change the variable, every page updates on the ' +
              'next publish.'}
          </Typography>
        ) : (
          variables.map((variable: any) => (
            <Stack
              key={variable.$id}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center' }}
            >
              <Stack sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {`{{${variable.name}}}`}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {`${HOST_VARIABLE_TYPE_LABELS[variable.type as HostVariableType] ?? variable.type} · ${
                    formatVariableValue(variable as HostVariable) || '—'
                  }`}
                </Typography>
              </Stack>
              <Button
                size="small"
                onClick={() =>
                  setDraft({
                    id: variable.$id,
                    name: variable.name ?? '',
                    type: variable.type ?? 'text',
                    value: variable.value ?? '',
                  })
                }
              >
                {'Edit'}
              </Button>
              <Button
                size="small"
                color="error"
                onClick={handleDelete(variable)}
              >
                {'Delete'}
              </Button>
            </Stack>
          ))
        )}
        <Button
          size="small"
          color="secondary"
          sx={{ alignSelf: 'flex-start' }}
          onClick={() =>
            setDraft({ id: null, name: '', type: 'text', value: '' })
          }
        >
          {'Add variable'}
        </Button>
      </Stack>
      <Dialog
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {draft?.id ? 'Edit Variable' : 'Add Variable'}
        </DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
        >
          <TextField
            label="Name"
            helperText={
              nameTaken
                ? 'A variable with this name already exists'
                : 'Used to identify the variable'
            }
            error={(Boolean(draft?.name) && !validName) || nameTaken}
            value={draft?.name ?? ''}
            onChange={(event) =>
              setDraft((prev) =>
                prev
                  ? {
                      ...prev,
                      name: event.target.value.replace(
                        /[^a-zA-Z0-9_]/g,
                        '',
                      ),
                    }
                  : prev,
              )
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
          />
          <TextField
            label="Type"
            value={draft?.type ?? 'text'}
            onChange={(event) =>
              setDraft((prev) =>
                prev
                  ? {
                      ...prev,
                      type: event.target.value as HostVariableType,
                      value: '',
                    }
                  : prev,
              )
            }
            size="small"
            select
          >
            {Object.entries(HOST_VARIABLE_TYPE_LABELS).map(
              ([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ),
            )}
          </TextField>
          {draft ? (
            <VariableValueField
              draft={draft}
              onChange={(value) =>
                setDraft((prev) => (prev ? { ...prev, value } : prev))
              }
            />
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={!validName || nameTaken}
            onClick={handleSave}
          >
            {'Save variable'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
HostVariablesCard.displayName = 'HostVariablesCard'

export default HostVariablesCard
