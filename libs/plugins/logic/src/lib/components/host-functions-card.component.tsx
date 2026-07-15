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
  evaluateHostFunction,
  type FunctionComparator,
  type FunctionValueType,
  type HostFunction,
  VARIABLE_NAME_PATTERN,
} from '@aglyn/aglyn'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
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

export interface HostFunctionsCardProps {
  hostId: string
  /** Resolved entitlement source for quota checks (AGL-395). */
  org?: Partial<AglynOrgBilling>
}

const VALUE_TYPES: { value: FunctionValueType; label: string }[] = [
  { value: 'number', label: 'Number' },
  { value: 'text', label: 'Text' },
  { value: 'boolean', label: 'True/false' },
]

const COMPARATORS: FunctionComparator[] = ['==', '!=', '<', '<=', '>', '>=']

interface FunctionDraft extends HostFunction {
  id: string | null
}

function emptyDraft(): FunctionDraft {
  return {
    id: null,
    name: '',
    parameters: [{ name: 'P1', type: 'number', required: true }],
    variables: [{ name: 'P3', type: 'number' }],
    operations: [
      {
        if: { left: '', comparator: '<=', right: '' },
        then: [{ set: '', expression: '' }],
        otherwise: [],
      },
    ],
    returnValue: '',
  }
}

/** Small labelled row header matching the mockup's section styling. */
function SectionLabel(props: { children: string }) {
  return (
    <Typography variant="overline" color="text.secondary">
      {props.children}
    </Typography>
  )
}

/**
 * No-code function builder (Component Builder, AGL-92): the mockup's Edit
 * Function dialog — Parameters with required toggles, local Variables,
 * numbered conditional operation cards (If below is TRUE / Then do this /
 * Otherwise do this), a Return value select, and a test-run panel driving
 * the shared evaluator. Definitions persist to `hosts/{hostId}/functions`;
 * prop/event wiring lands with AGL-93.
 */
export function HostFunctionsCard(props: HostFunctionsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const createHostResource = useHostResourceApi()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { org } = props
  const { data: functionDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'functions'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const functions = [...(functionDocs ?? [])]
    .filter((definition: any) => !definition.deletedAt)
    .sort((a: any, b: any) =>
      String(a.name ?? '').localeCompare(String(b.name ?? '')),
    )

  const [draft, setDraft] = useState<FunctionDraft | null>(null)

  // Where-used dialog (AGL-193).
  const [usage, setUsage] = useState<{
    name: string
    result: WhereUsedResult
  } | null>(null)
  const [usageLoading, setUsageLoading] = useState<string | null>(null)

  const [testArgs, setTestArgs] = useState<Record<string, string>>({})
  const [testResult, setTestResult] = useState<string | null>(null)

  const patch = useCallback(
    (updater: (previous: FunctionDraft) => FunctionDraft) =>
      setDraft((previous) => (previous ? updater(previous) : previous)),
    [],
  )

  const names = [
    ...(draft?.parameters ?? []).map((parameter) => parameter.name),
    ...(draft?.variables ?? []).map((variable) => variable.name),
  ].filter((name) => VARIABLE_NAME_PATTERN.test(name))

  // Case-insensitive uniqueness (AGL-185): function names must stay
  // unambiguous for legacy {{fn:name(...)}} token resolution.
  const nameTaken = Boolean(
    draft &&
      functions.some(
        (definition: any) =>
          String(definition.name ?? '').toLowerCase() ===
            draft.name.trim().toLowerCase() && definition.$id !== draft.id,
      ),
  )

  const handleTestRun = useCallback(() => {
    if (!draft) return
    const result = evaluateHostFunction(draft, testArgs)
    setTestResult(
      result.ok === false
        ? `Error: ${result.error}`
        : `Result: ${String(result.value)}`,
    )
  }, [draft, testArgs])

  const handleSave = useCallback(async () => {
    if (!draft || !draft.name.trim() || nameTaken) return
    const { id: draftId, ...definition } = draft
    const fields = { ...definition, name: draft.name.trim().slice(0, 60) }
    try {
      if (draftId) {
        // Edit stays client-direct (no quota consumed).
        await setDoc(
          doc(firestore, 'hosts', hostId, 'functions', draftId),
          { ...fields, updatedAt: Timestamp.now() },
          { merge: true },
        )
      } else {
        // New function rides the quota-enforcing resources API (AGL-473).
        await createHostResource({ hostId, resource: 'function', data: fields })
      }
      setDraft(null)
      setTestResult(null)
      enqueueSnackbar('Function saved', { variant: 'success', persist: false })
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [draft, nameTaken, firestore, hostId, createHostResource, enqueueSnackbar])

  const handleShowUsage = useCallback(
    (definition: any) => async () => {
      setUsageLoading(definition.$id)
      const result = await fetchWhereUsed(user as any, {
        hostId,
        kind: 'function',
        id: definition.$id,
        name: definition.name,
      })
      setUsageLoading(null)
      setUsage({ name: definition.name, result })
    },
    [user, hostId],
  )

  const handleDelete = useCallback(
    (definition: any) => async () => {
      // Dependents warning (AGL-187): screens/layouts binding the function
      // and workflow steps calling it.
      const scan = await fetchWhereUsed(user as any, {
        hostId,
        kind: 'function',
        id: definition.$id,
        name: definition.name,
      })
      const confirmed = await confirm({
        title: 'Delete this function?',
        description: scan.total
          ? `"${definition.name}" is used in ${summarizeDependents(scan)} ` +
            'and those bindings and workflow steps will stop running.'
          : `"${definition.name}" will no longer be runnable.`,
        confirmationText: 'Delete',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      await updateDoc(
        doc(firestore, 'hosts', hostId, 'functions', definition.$id),
        { deletedAt: Timestamp.now() },
      )
      enqueueSnackbar('Function deleted', {
        variant: 'success',
        persist: false,
      })
    },
    [user, confirm, firestore, hostId, enqueueSnackbar],
  )

  const setRow = (
    section: 'then' | 'otherwise',
    operationIndex: number,
    rowIndex: number,
    key: 'set' | 'expression',
    value: string,
  ) =>
    patch((previous) => {
      const operations = previous.operations.map((operation, index) =>
        index === operationIndex
          ? {
              ...operation,
              [section]: operation[section].map((row, index2) =>
                index2 === rowIndex ? { ...row, [key]: value } : row,
              ),
            }
          : operation,
      )
      return { ...previous, operations }
    })

  const renderSetRows = (section: 'then' | 'otherwise', operationIndex: number) => {
    const operation = draft?.operations[operationIndex]
    if (!operation) return null
    return (
      <Stack spacing={1}>
        {operation[section].map((row, rowIndex) => (
          <Stack
            key={rowIndex}
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center' }}
          >
            <Typography variant="caption">{'SET'}</Typography>
            <TextField
              value={row.set}
              onChange={(event) =>
                setRow(section, operationIndex, rowIndex, 'set', event.target.value)
              }
              size="small"
              select
              sx={{ minWidth: 90 }}
            >
              {names.map((name) => (
                <MenuItem key={name} value={name}>
                  {name}
                </MenuItem>
              ))}
            </TextField>
            <Typography variant="caption">{'equal to'}</Typography>
            <TextField
              value={row.expression}
              placeholder="P1 + P2"
              onChange={(event) =>
                setRow(
                  section,
                  operationIndex,
                  rowIndex,
                  'expression',
                  event.target.value,
                )
              }
              size="small"
              sx={{ flex: 1 }}
            />
            <IconButton
              size="small"
              aria-label="remove operation row"
              onClick={() =>
                patch((previous) => ({
                  ...previous,
                  operations: previous.operations.map((op, index) =>
                    index === operationIndex
                      ? {
                          ...op,
                          [section]: op[section].filter(
                            (_, index2) => index2 !== rowIndex,
                          ),
                        }
                      : op,
                  ),
                }))
              }
            >
              {'×'}
            </IconButton>
          </Stack>
        ))}
        <Button
          size="small"
          sx={{ alignSelf: 'flex-start' }}
          onClick={() =>
            patch((previous) => ({
              ...previous,
              operations: previous.operations.map((op, index) =>
                index === operationIndex
                  ? {
                      ...op,
                      [section]: [...op[section], { set: '', expression: '' }],
                    }
                  : op,
              ),
            }))
          }
        >
          {'Add set'}
        </Button>
      </Stack>
    )
  }

  return (
    <CardDisplay header={'Functions'} contentGutterX contentGutterY>
      <Stack spacing={1}>
        {functions.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'Build no-code logic: parameters in, conditional operations, ' +
              'a value out. Wire functions into components and workflows ' +
              'as the builder grows.'}
          </Typography>
        ) : (
          functions.map((definition: any) => (
            <Stack
              key={definition.$id}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center' }}
            >
              <Stack sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {definition.name}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {`${(definition.parameters ?? []).map((p: any) => p.name).join(', ') || 'no parameters'} → ${definition.returnValue || '—'}`}
                </Typography>
              </Stack>
              <Button
                size="small"
                disabled={usageLoading === definition.$id}
                onClick={handleShowUsage(definition)}
              >
                {usageLoading === definition.$id ? 'Scanning…' : 'Usage'}
              </Button>
              <Button
                size="small"
                onClick={() => {
                  setTestArgs({})
                  setTestResult(null)
                  setDraft({
                    id: definition.$id,
                    name: definition.name ?? '',
                    parameters: definition.parameters ?? [],
                    variables: definition.variables ?? [],
                    operations: definition.operations ?? [],
                    returnValue: definition.returnValue ?? '',
                  })
                }}
              >
                {'Edit'}
              </Button>
              <Button
                size="small"
                color="error"
                onClick={handleDelete(definition)}
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
              'functionsPerHost',
              functions.length,
            )
            if (!quota.allowed) {
              return void enqueueSnackbar(
                `Function limit reached (${quota.limit}) — upgrade in Billing`,
                { variant: 'warning', persist: false },
              )
            }
            setTestArgs({})
            setTestResult(null)
            setDraft(emptyDraft())
          }}
        >
          {'Add function'}
        </Button>
      </Stack>

      <Dialog
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {draft?.id ? 'Edit Function' : 'Add Function'}
        </DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}
        >
          <TextField
            label="Name"
            helperText={
              nameTaken
                ? 'A function with this name already exists'
                : 'Used to identify the function'
            }
            error={nameTaken}
            value={draft?.name ?? ''}
            onChange={(event) =>
              patch((previous) => ({ ...previous, name: event.target.value }))
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
          />

          <SectionLabel>{'Parameters'}</SectionLabel>
          {(draft?.parameters ?? []).map((parameter, index) => (
            <Stack
              key={index}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center' }}
            >
              <TextField
                label="Name"
                value={parameter.name}
                onChange={(event) =>
                  patch((previous) => ({
                    ...previous,
                    parameters: previous.parameters.map((p, index2) =>
                      index2 === index
                        ? {
                            ...p,
                            name: event.target.value.replace(
                              /[^a-zA-Z0-9_]/g,
                              '',
                            ),
                          }
                        : p,
                    ),
                  }))
                }
                size="small"
                sx={{ width: 110 }}
              />
              <TextField
                label="Type"
                value={parameter.type}
                onChange={(event) =>
                  patch((previous) => ({
                    ...previous,
                    parameters: previous.parameters.map((p, index2) =>
                      index2 === index
                        ? { ...p, type: event.target.value as FunctionValueType }
                        : p,
                    ),
                  }))
                }
                size="small"
                select
                sx={{ width: 130 }}
              >
                {VALUE_TYPES.map((type) => (
                  <MenuItem key={type.value} value={type.value}>
                    {type.label}
                  </MenuItem>
                ))}
              </TextField>
              <Stack
                direction="row"
                spacing={0.5}
                sx={{ alignItems: 'center', flex: 1 }}
              >
                <Typography variant="caption" color="text.secondary">
                  {'Required'}
                </Typography>
                <Switch
                  size="small"
                  checked={Boolean(parameter.required)}
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      parameters: previous.parameters.map((p, index2) =>
                        index2 === index
                          ? { ...p, required: event.target.checked }
                          : p,
                      ),
                    }))
                  }
                />
              </Stack>
              <IconButton
                size="small"
                aria-label="remove parameter"
                onClick={() =>
                  patch((previous) => ({
                    ...previous,
                    parameters: previous.parameters.filter(
                      (_, index2) => index2 !== index,
                    ),
                  }))
                }
              >
                {'×'}
              </IconButton>
            </Stack>
          ))}
          <Button
            size="small"
            sx={{ alignSelf: 'flex-start' }}
            onClick={() =>
              patch((previous) => ({
                ...previous,
                parameters: [
                  ...previous.parameters,
                  {
                    name: `P${previous.parameters.length + 1}`,
                    type: 'number',
                    required: false,
                  },
                ],
              }))
            }
          >
            {'Add parameter'}
          </Button>

          <SectionLabel>{'Variables'}</SectionLabel>
          {(draft?.variables ?? []).map((variable, index) => (
            <Stack
              key={index}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center' }}
            >
              <TextField
                label="Name"
                value={variable.name}
                onChange={(event) =>
                  patch((previous) => ({
                    ...previous,
                    variables: previous.variables.map((v, index2) =>
                      index2 === index
                        ? {
                            ...v,
                            name: event.target.value.replace(
                              /[^a-zA-Z0-9_]/g,
                              '',
                            ),
                          }
                        : v,
                    ),
                  }))
                }
                size="small"
                sx={{ width: 110 }}
              />
              <TextField
                label="Type"
                value={variable.type}
                onChange={(event) =>
                  patch((previous) => ({
                    ...previous,
                    variables: previous.variables.map((v, index2) =>
                      index2 === index
                        ? { ...v, type: event.target.value as FunctionValueType }
                        : v,
                    ),
                  }))
                }
                size="small"
                select
                sx={{ width: 130 }}
              >
                {VALUE_TYPES.map((type) => (
                  <MenuItem key={type.value} value={type.value}>
                    {type.label}
                  </MenuItem>
                ))}
              </TextField>
              <IconButton
                size="small"
                aria-label="remove variable"
                sx={{ ml: 'auto' }}
                onClick={() =>
                  patch((previous) => ({
                    ...previous,
                    variables: previous.variables.filter(
                      (_, index2) => index2 !== index,
                    ),
                  }))
                }
              >
                {'×'}
              </IconButton>
            </Stack>
          ))}
          <Button
            size="small"
            sx={{ alignSelf: 'flex-start' }}
            onClick={() =>
              patch((previous) => ({
                ...previous,
                variables: [
                  ...previous.variables,
                  { name: `V${previous.variables.length + 1}`, type: 'number' },
                ],
              }))
            }
          >
            {'Add variable'}
          </Button>

          <SectionLabel>{'Operations'}</SectionLabel>
          {(draft?.operations ?? []).map((operation, index) => (
            <Stack
              key={index}
              spacing={1}
              sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                p: 1.5,
              }}
            >
              <Typography variant="caption" color="text.secondary">
                {`${index + 1} · If below is TRUE`}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <TextField
                  value={operation.if.left}
                  placeholder="P1"
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      operations: previous.operations.map((op, index2) =>
                        index2 === index
                          ? { ...op, if: { ...op.if, left: event.target.value } }
                          : op,
                      ),
                    }))
                  }
                  size="small"
                  sx={{ flex: 1 }}
                />
                <TextField
                  value={operation.if.comparator}
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      operations: previous.operations.map((op, index2) =>
                        index2 === index
                          ? {
                              ...op,
                              if: {
                                ...op.if,
                                comparator: event.target
                                  .value as FunctionComparator,
                              },
                            }
                          : op,
                      ),
                    }))
                  }
                  size="small"
                  select
                  sx={{ width: 84 }}
                >
                  {COMPARATORS.map((comparator) => (
                    <MenuItem key={comparator} value={comparator}>
                      {comparator}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  value={operation.if.right}
                  placeholder="P2"
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      operations: previous.operations.map((op, index2) =>
                        index2 === index
                          ? { ...op, if: { ...op.if, right: event.target.value } }
                          : op,
                      ),
                    }))
                  }
                  size="small"
                  sx={{ flex: 1 }}
                />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {'Then do this'}
              </Typography>
              {renderSetRows('then', index)}
              <Typography variant="caption" color="text.secondary">
                {'Otherwise do this'}
              </Typography>
              {renderSetRows('otherwise', index)}
            </Stack>
          ))}
          <Button
            size="small"
            sx={{ alignSelf: 'flex-start' }}
            onClick={() =>
              patch((previous) => ({
                ...previous,
                operations: [
                  ...previous.operations,
                  {
                    if: { left: '', comparator: '<=', right: '' },
                    then: [{ set: '', expression: '' }],
                    otherwise: [],
                  },
                ],
              }))
            }
          >
            {'Add operation'}
          </Button>

          <TextField
            label="Return value"
            value={draft?.returnValue ?? ''}
            onChange={(event) =>
              patch((previous) => ({
                ...previous,
                returnValue: event.target.value,
              }))
            }
            size="small"
            select
          >
            {names.map((name) => (
              <MenuItem key={name} value={name}>
                {name}
              </MenuItem>
            ))}
          </TextField>

          <Divider />
          <SectionLabel>{'Test run'}</SectionLabel>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            {(draft?.parameters ?? []).map((parameter) => (
              <TextField
                key={parameter.name}
                label={parameter.name}
                value={testArgs[parameter.name] ?? ''}
                onChange={(event) =>
                  setTestArgs((previous) => ({
                    ...previous,
                    [parameter.name]: event.target.value,
                  }))
                }
                size="small"
                sx={{ width: 110 }}
              />
            ))}
            <Button size="small" color="secondary" onClick={handleTestRun}>
              {'Run'}
            </Button>
          </Stack>
          {testResult ? (
            <Alert
              severity={testResult.startsWith('Error') ? 'warning' : 'success'}
            >
              {testResult}
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={!draft?.name.trim() || nameTaken}
            onClick={handleSave}
          >
            {'Done'}
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
HostFunctionsCard.displayName = 'HostFunctionsCard'

export default HostFunctionsCard
