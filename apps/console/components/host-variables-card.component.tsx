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
import { useFirestore, useFirestoreCollectionData, useUser } from 'reactfire'
import { checkTenantQuota } from '../constants/entitlements'
import useCurrentTenant from '../hooks/use-current-tenant'
import WhereUsedDialog from './where-used-dialog.component'
import {
  fetchWhereUsed,
  summarizeDependents,
  type WhereUsedResult,
} from '../utils/fetch-where-used'

export interface HostVariablesCardProps {
  hostId: string
}

interface VariableDraft {
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
 * Any string prop can reference a variable with `{{name}}`; the tenant
 * compose pipeline resolves it at render. Soft delete keeps old tokens
 * rendering literally rather than breaking published pages.
 */
export function HostVariablesCard(props: HostVariablesCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { tenant } = useCurrentTenant()
  // Where-used dependents dialog (AGL-187).
  const [usage, setUsage] = useState<{
    name: string
    result: WhereUsedResult
  } | null>(null)
  const [usageLoading, setUsageLoading] = useState<string | null>(null)
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
    // Rename safety (AGL-187): id tokens survive a rename, but dependents
    // still holding legacy {{oldName}} tokens break — warn hard first.
    const original = draft.id
      ? variables.find((variable: any) => variable.$id === draft.id)
      : null
    if (original && original.name && original.name !== draft.name.trim()) {
      const scan = await fetchWhereUsed(user as any, {
        hostId,
        kind: 'variable',
        id: draft.id as string,
        name: original.name,
      })
      if (scan.legacyCount > 0) {
        const proceed = await confirm({
          title: `Rename "${original.name}"?`,
          description:
            `${scan.legacyCount} place${scan.legacyCount === 1 ? '' : 's'} ` +
            `(${summarizeDependents(scan)}) still reference this variable ` +
            `by its old name and will stop resolving after the rename. ` +
            'Re-save those screens in the designer to upgrade their ' +
            'references first, or continue anyway.',
          confirmationText: 'Rename anyway',
          confirmationButtonProps: { color: 'warning' },
        })
          .then(() => true)
          .catch(() => false)
        if (!proceed) return
      }
    }
    try {
      const id = draft.id ?? createResourceUid()
      await setDoc(
        doc(firestore, 'hosts', hostId, 'variables', id),
        {
          name: draft.name,
          type: draft.type,
          value: draft.value,
          workflowName: draft.workflowName.trim(),
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
  }, [
    draft,
    validName,
    nameTaken,
    variables,
    user,
    confirm,
    firestore,
    hostId,
    enqueueSnackbar,
  ])

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
            // Plan cap (AGL-99): dark-launch — plan-less tenants uncapped.
            const quota = checkTenantQuota(
              tenant,
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
            label="Computed from workflow (optional)"
            helperText={
              'A workflow name from the Workflows page — its result ' +
              'becomes this variable\u2019s value at render; the value ' +
              'above is the fallback (AGL-129)'
            }
            value={draft?.workflowName ?? ''}
            onChange={(event) =>
              setDraft((prev) =>
                prev ? { ...prev, workflowName: event.target.value } : prev,
              )
            }
            size="small"
          />
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
