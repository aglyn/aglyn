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
  HOST_EVENT_TYPES,
  type HostFunction,
  type HostVariable,
  type HostWorkflow,
  runWorkflow,
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
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { collection, doc, limit, query, setDoc, updateDoc } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { useFirestore, useFirestoreCollectionData } from 'reactfire'
import { checkTenantQuota, hasEntitlement } from '../constants/entitlements'
import useCurrentTenant from '../hooks/use-current-tenant'

export interface HostWorkflowsCardProps {
  hostId: string
}

interface WorkflowDraft extends HostWorkflow {
  id: string | null
}

/**
 * Workflow builder v1 (AGL-101): pipelines of host-function calls — each
 * step's argument expressions see host variables and previous step results
 * (`step1`, or a custom result name). Runs through the pure `runWorkflow`
 * evaluator; test-run panel included. Plan-gated (`workflows` flag +
 * `workflowsPerHost` cap, AGL-99); site-event triggers are v2.
 */
export function HostWorkflowsCard(props: HostWorkflowsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { tenant } = useCurrentTenant()

  const { data: workflowDocs } = useFirestoreCollectionData<any>(
    query(collection(firestore, 'hosts', hostId, 'workflows'), limit(100)),
    { idField: '$id' },
  )
  const { data: functionDocs } = useFirestoreCollectionData<any>(
    query(collection(firestore, 'hosts', hostId, 'functions'), limit(100)),
    { idField: '$id' },
  )
  const { data: variableDocs } = useFirestoreCollectionData<any>(
    query(collection(firestore, 'hosts', hostId, 'variables'), limit(100)),
    { idField: '$id' },
  )
  const workflows = [...(workflowDocs ?? [])]
    .filter((workflow: any) => !workflow.deletedAt)
    .sort((a: any, b: any) =>
      String(a.name ?? '').localeCompare(String(b.name ?? '')),
    )
  const functions = useMemo(() => {
    const map: Record<string, HostFunction> = {}
    for (const definition of functionDocs ?? []) {
      if (!definition.deletedAt && definition.name) {
        map[definition.name] = definition
      }
    }
    return map
  }, [functionDocs])
  const variables = useMemo(() => {
    const map: Record<string, HostVariable> = {}
    for (const variable of variableDocs ?? []) {
      if (!variable.deletedAt && variable.name) map[variable.name] = variable
    }
    return map
  }, [variableDocs])

  const [draft, setDraft] = useState<WorkflowDraft | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)

  const patch = useCallback(
    (updater: (previous: WorkflowDraft) => WorkflowDraft) =>
      setDraft((previous) => (previous ? updater(previous) : previous)),
    [],
  )

  const handleAdd = useCallback(() => {
    // Feature + cap gate (AGL-99); dark-launch for plan-less tenants.
    if (!hasEntitlement('workflows', tenant)) {
      return void enqueueSnackbar(
        'Workflows require a Starter plan — see Billing to upgrade',
        { variant: 'warning', persist: false },
      )
    }
    const quota = checkTenantQuota(
      tenant,
      'workflowsPerHost',
      workflows.length,
    )
    if (!quota.allowed) {
      return void enqueueSnackbar(
        `Workflow limit reached (${quota.limit}) — upgrade in Billing`,
        { variant: 'warning', persist: false },
      )
    }
    setTestResult(null)
    setDraft({
      id: null,
      name: '',
      steps: [{ functionName: '', args: [], resultName: '' }],
      returnValue: '',
      trigger: null,
    })
  }, [tenant, workflows.length, enqueueSnackbar])

  const handleTestRun = useCallback(() => {
    if (!draft) return
    const run = runWorkflow(draft, functions, variables)
    setTestResult(
      run.ok
        ? `Result: ${String(run.value)} (${Object.entries(run.results)
            .map(([key, value]) => `${key}=${value}`)
            .join(', ')})`
        : `Error: ${run.error}`,
    )
  }, [draft, functions, variables])

  const handleSave = useCallback(async () => {
    if (!draft || !draft.name.trim()) return
    try {
      const id = draft.id ?? createResourceUid()
      const { id: _ignored, ...definition } = draft
      await setDoc(
        doc(firestore, 'hosts', hostId, 'workflows', id),
        {
          ...definition,
          name: draft.name.trim().slice(0, 60),
          updatedAt: Timestamp.now(),
          ...(draft.id ? {} : { createdAt: Timestamp.now() }),
        },
        { merge: true },
      )
      setDraft(null)
      enqueueSnackbar('Workflow saved', { variant: 'success', persist: false })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [draft, firestore, hostId, enqueueSnackbar])

  const handleDelete = useCallback(
    (workflow: any) => async () => {
      const confirmed = await confirm({
        title: 'Delete this workflow?',
        description: `"${workflow.name}" will no longer be runnable.`,
        confirmationText: 'Delete',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      await updateDoc(
        doc(firestore, 'hosts', hostId, 'workflows', workflow.$id),
        { deletedAt: Timestamp.now() },
      )
      enqueueSnackbar('Workflow deleted', {
        variant: 'success',
        persist: false,
      })
    },
    [confirm, firestore, hostId, enqueueSnackbar],
  )

  return (
    <CardDisplay header={'Workflows'} contentGutterX contentGutterY>
      <Stack spacing={1}>
        {workflows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'Chain your functions into multi-step pipelines — each step ' +
              'feeds the next. Site-event triggers are coming next.'}
          </Typography>
        ) : (
          workflows.map((workflow: any) => (
            <Stack
              key={workflow.$id}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center' }}
            >
              <Stack sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {workflow.name}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {`${(workflow.steps ?? []).length} step${
                    (workflow.steps ?? []).length === 1 ? '' : 's'
                  }${
                    workflow.trigger?.event
                      ? ` · on ${workflow.trigger.event}`
                      : ''
                  } · ${(workflow.steps ?? [])
                    .map((step: any) => step.functionName)
                    .join(' → ')}`}
                </Typography>
              </Stack>
              <Button
                size="small"
                onClick={() => {
                  setTestResult(null)
                  setDraft({
                    id: workflow.$id,
                    name: workflow.name ?? '',
                    steps: workflow.steps ?? [],
                    returnValue: workflow.returnValue ?? '',
                    trigger: workflow.trigger ?? null,
                  })
                }}
              >
                {'Edit'}
              </Button>
              <Button
                size="small"
                color="error"
                onClick={handleDelete(workflow)}
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
          onClick={handleAdd}
        >
          {'Add workflow'}
        </Button>
      </Stack>

      <Dialog
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {draft?.id ? 'Edit Workflow' : 'Add Workflow'}
        </DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}
        >
          <TextField
            label="Name"
            helperText="Used to identify the workflow"
            value={draft?.name ?? ''}
            onChange={(event) =>
              patch((previous) => ({ ...previous, name: event.target.value }))
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
          />
          <Typography variant="overline" color="text.secondary">
            {'Steps'}
          </Typography>
          {(draft?.steps ?? []).map((step, index) => {
            const definition = functions[step.functionName]
            return (
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
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center' }}
                >
                  <Typography variant="caption" color="text.secondary">
                    {`${index + 1}`}
                  </Typography>
                  <TextField
                    label="Function"
                    value={step.functionName}
                    onChange={(event) =>
                      patch((previous) => ({
                        ...previous,
                        steps: previous.steps.map((s, index2) =>
                          index2 === index
                            ? { ...s, functionName: event.target.value }
                            : s,
                        ),
                      }))
                    }
                    size="small"
                    select
                    sx={{ minWidth: 160, flex: 1 }}
                  >
                    {Object.keys(functions).map((name) => (
                      <MenuItem key={name} value={name}>
                        {name}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label="Result name"
                    placeholder={`step${index + 1}`}
                    value={step.resultName ?? ''}
                    onChange={(event) =>
                      patch((previous) => ({
                        ...previous,
                        steps: previous.steps.map((s, index2) =>
                          index2 === index
                            ? {
                                ...s,
                                resultName: event.target.value.replace(
                                  /[^a-zA-Z0-9_]/g,
                                  '',
                                ),
                              }
                            : s,
                        ),
                      }))
                    }
                    size="small"
                    sx={{ width: 140 }}
                  />
                  <IconButton
                    size="small"
                    aria-label="remove step"
                    onClick={() =>
                      patch((previous) => ({
                        ...previous,
                        steps: previous.steps.filter(
                          (_, index2) => index2 !== index,
                        ),
                      }))
                    }
                  >
                    {'×'}
                  </IconButton>
                </Stack>
                {(definition?.parameters ?? []).map(
                  (parameter, parameterIndex) => (
                    <TextField
                      key={parameter.name}
                      label={`${parameter.name} expression`}
                      placeholder={
                        parameterIndex === 0 && index > 0
                          ? `step${index}`
                          : 'a variable, number, or expression'
                      }
                      value={step.args?.[parameterIndex] ?? ''}
                      onChange={(event) =>
                        patch((previous) => ({
                          ...previous,
                          steps: previous.steps.map((s, index2) => {
                            if (index2 !== index) return s
                            const args = [...(s.args ?? [])]
                            args[parameterIndex] = event.target.value
                            return { ...s, args }
                          }),
                        }))
                      }
                      size="small"
                    />
                  ),
                )}
              </Stack>
            )
          })}
          <Button
            size="small"
            sx={{ alignSelf: 'flex-start' }}
            onClick={() =>
              patch((previous) => ({
                ...previous,
                steps: [
                  ...previous.steps,
                  { functionName: '', args: [], resultName: '' },
                ],
              }))
            }
          >
            {'Add step'}
          </Button>
          <Typography variant="overline" color="text.secondary">
            {'Trigger'}
          </Typography>
          <Stack direction="row" spacing={1}>
            <TextField
              label="Run on event"
              value={draft?.trigger?.event ?? ''}
              onChange={(event) =>
                patch((previous) => ({
                  ...previous,
                  trigger: event.target.value
                    ? {
                        event: event.target.value as any,
                        filter: previous.trigger?.filter ?? '',
                      }
                    : null,
                }))
              }
              size="small"
              select
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="">{'Manual only'}</MenuItem>
              {HOST_EVENT_TYPES.map((eventType) => (
                <MenuItem key={eventType} value={eventType}>
                  {eventType}
                </MenuItem>
              ))}
            </TextField>
            {draft?.trigger ? (
              <TextField
                label="Filter (optional)"
                placeholder={'path == "/pricing"'}
                helperText="Runs only when this expression is truthy"
                value={draft?.trigger?.filter ?? ''}
                onChange={(event) =>
                  patch((previous) => ({
                    ...previous,
                    trigger: previous.trigger
                      ? { ...previous.trigger, filter: event.target.value }
                      : previous.trigger,
                  }))
                }
                size="small"
                sx={{ flex: 1 }}
              />
            ) : null}
          </Stack>
          <TextField
            label="Return value"
            helperText="A step result name; defaults to the last step"
            value={draft?.returnValue ?? ''}
            onChange={(event) =>
              patch((previous) => ({
                ...previous,
                returnValue: event.target.value,
              }))
            }
            size="small"
          />
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Button size="small" color="secondary" onClick={handleTestRun}>
              {'Test run'}
            </Button>
            <Typography variant="caption" color="text.secondary">
              {'Uses current variable values'}
            </Typography>
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
            disabled={!draft?.name.trim()}
            onClick={handleSave}
          >
            {'Done'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
HostWorkflowsCard.displayName = 'HostWorkflowsCard'

export default HostWorkflowsCard
