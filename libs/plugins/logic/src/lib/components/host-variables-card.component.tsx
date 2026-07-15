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
  type AglynOrgBilling,
  checkQuota,
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
import {
  useFirestore,
  useFirestoreCollection,
  useHostResourceApi,
  useUser,
} from '@aglyn/tenant-feature-instance'
import WhereUsedDialog from './where-used-dialog.component'
import {
  fetchWhereUsed,
  summarizeDependents,
  type WhereUsedResult,
} from '../utils/fetch-where-used'

export interface HostVariablesCardProps {
  hostId: string
  /** Resolved entitlement source for quota checks (AGL-395). */
  org?: Partial<AglynOrgBilling>
}

interface VariableDraft {
  /** Computed-source workflow doc id (AGL-261); name is the display hint. */
  workflowId: string
  id: string | null
  name: string
  type: HostVariableType
  value: string
  /** Workflow (by name) computing this variable at render (AGL-129). */
  workflowName: string
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
 * Any string prop can reference a variable with `{{name}}`; the org
 * compose pipeline resolves it at render. Soft delete keeps old tokens
 * rendering literally rather than breaking published pages.
 */
export function HostVariablesCard(props: HostVariablesCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const createHostResource = useHostResourceApi()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { org } = props
  // Where-used dependents dialog (AGL-187).
  const [usage, setUsage] = useState<{
    name: string
    result: WhereUsedResult
  } | null>(null)
  const [usageLoading, setUsageLoading] = useState<string | null>(null)
  const { data: variableDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'variables'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  // Workflow picker options (AGL-261): computed variables reference the
  // workflow by doc id instead of a typed name.
  const { data: workflowDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'workflows'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const workflowOptions = [...(workflowDocs ?? [])]
    .filter((workflow: any) => !workflow.deletedAt && workflow.name)
    .map((workflow: any) => ({
      id: workflow.$id as string,
      name: workflow.name as string,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const variables = [...(variableDocs ?? [])]
    .filter((variable: any) => !variable.deletedAt)
    .sort((a: any, b: any) =>
      String(a.name ?? '').localeCompare(String(b.name ?? '')),
    )

  const [draft, setDraft] = useState<VariableDraft | null>(null)
  const validName = VARIABLE_NAME_PATTERN.test(draft?.name ?? '')
  // Case-insensitive (AGL-185): names must stay unambiguous for legacy
  // {{name}} token resolution and picker display.
  const nameTaken = Boolean(
    draft &&
      variables.some(
        (variable: any) =>
          String(variable.name ?? '').toLowerCase() ===
            draft.name.trim().toLowerCase() && variable.$id !== draft.id,
      ),
  )

  const handleSave = useCallback(async () => {
    if (!draft || !validName || nameTaken) return
    const fields = {
      name: draft.name,
      type: draft.type,
      value: draft.value,
      workflowId: draft.workflowId.trim(),
      workflowName: draft.workflowName.trim(),
    }
    try {
      if (draft.id) {
        // Edit stays client-direct (no quota consumed).
        await setDoc(
          doc(firestore, 'hosts', hostId, 'variables', draft.id),
          { ...fields, updatedAt: Timestamp.now() },
          { merge: true },
        )
      } else {
        // New variable rides the quota-enforcing resources API (AGL-473).
        await createHostResource({ hostId, resource: 'variable', data: fields })
      }
      setDraft(null)
      enqueueSnackbar(
        `Saved — use {{${draft.name}}} in any text to bind it`,
        { variant: 'success', persist: false },
      )
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [draft, validName, nameTaken, firestore, hostId, createHostResource, enqueueSnackbar])

  const handleShowUsage = useCallback(
    (variable: any) => async () => {
      setUsageLoading(variable.$id)
      const result = await fetchWhereUsed(user as any, {
        hostId,
        kind: 'variable',
        id: variable.$id,
        name: variable.name,
      })
      setUsageLoading(null)
      setUsage({ name: variable.name, result })
    },
    [user, hostId],
  )

  const handleDelete = useCallback(
    (variable: any) => async () => {
      // Real dependents warning (AGL-187) instead of the generic copy.
      const scan = await fetchWhereUsed(user as any, {
        hostId,
        kind: 'variable',
        id: variable.$id,
        name: variable.name,
      })
      const confirmed = await confirm({
        title: 'Delete this variable?',
        description: scan.total
          ? `"${variable.name}" is used in ${summarizeDependents(scan)}. ` +
            'Those bindings will render as empty or literal tokens after ' +
            'the next publish.'
          : `"${variable.name}" is not referenced by any published ` +
            'screen, layout, or workflow.',
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
    [user, confirm, firestore, hostId, enqueueSnackbar],
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
                disabled={usageLoading === variable.$id}
                onClick={handleShowUsage(variable)}
              >
                {usageLoading === variable.$id ? 'Scanning…' : 'Usage'}
              </Button>
              <Button
                size="small"
                onClick={() =>
                  setDraft({
                    id: variable.$id,
                    name: variable.name ?? '',
                    type: variable.type ?? 'text',
                    value: variable.value ?? '',
                    workflowId: variable.workflowId ?? '',
                    workflowName: variable.workflowName ?? '',
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
          onClick={() => {
            // Plan cap (AGL-99): dark-launch — plan-less workspaces uncapped.
            const quota = checkQuota(
              org,
              'variablesPerHost',
              variables.length,
            )
            if (!quota.allowed) {
              return void enqueueSnackbar(
                `Variable limit reached (${quota.limit}) — upgrade in Billing`,
                { variant: 'warning', persist: false },
              )
            }
            setDraft({
              id: null,
              name: '',
              type: 'text',
              value: '',
              workflowId: '',
              workflowName: '',
            })
          }}
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
          <TextField
            select
            label="Computed from workflow (optional)"
            helperText={
              'Pick a workflow — its result becomes this variable\u2019s ' +
              'value at render; the value above is the fallback (AGL-129)'
            }
            value={
              draft?.workflowId ||
              workflowOptions.find(
                (option) => option.name === draft?.workflowName,
              )?.id ||
              ''
            }
            onChange={(event) =>
              setDraft((prev) =>
                prev
                  ? {
                      ...prev,
                      workflowId: event.target.value,
                      workflowName:
                        workflowOptions.find(
                          (option) => option.id === event.target.value,
                        )?.name ?? '',
                    }
                  : prev,
              )
            }
            size="small"
          >
            <MenuItem value="">{'None'}</MenuItem>
            {workflowOptions.map((option) => (
              <MenuItem key={option.id} value={option.id}>
                {option.name}
              </MenuItem>
            ))}
          </TextField>
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
      <WhereUsedDialog
        hostId={hostId}
        usage={usage}
        onClose={() => setUsage(null)}
      />
    </CardDisplay>
  )
}
HostVariablesCard.displayName = 'HostVariablesCard'

export default HostVariablesCard
