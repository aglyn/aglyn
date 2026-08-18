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
  checkEntitlement,
  checkQuota,
  HOST_EVENT_TYPES,
  type HostFunction,
  type HostVariable,
  type HostWorkflow,
  runWorkflow,
} from '@aglyn/aglyn'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import QuotaReadoutComponent from '@aglyn/shared-ui-jsx/components/quota-readout.component'
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
import { collection, doc, getCountFromServer, limit, query, setDoc, updateDoc } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
  useHostResourceApi,
  useUser,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import HostActivityCard from './host-activity-card.component'
import { WhereUsedDialog } from '@aglyn/plugins-logic'
import {
  fetchWhereUsed,
  summarizeDependents,
  type WhereUsedResult,
} from '@aglyn/plugins-logic'

export interface HostWorkflowsCardProps {
  hostId: string
  /** Resolved entitlement source for quota checks (AGL-395). */
  org?: Partial<AglynOrgBilling>
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
  const { data: user } = useUser()
  const createHostResource = useHostResourceApi()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { org } = props

  const {
    data: workflowDocs,
    status: workflowsStatus,
    /**
     * The rows this editor is seeded from are unconfirmed by the server
     * (AGL-1358). Editing destructures a whole stored workflow into `draft`
     * and writes `{...definition}` back, so `merge: true` protects nothing.
     * `trigger` is the field that makes this more than a lost edit: it is
     * `{event, filter}` or `null` for manual-only, and nothing else on this
     * card writes it, so a cached seed can re-arm an automation the author
     * disarmed — or disarm one running on a live site — and revert every
     * step of the pipeline with it.
     */
    fromCache: workflowsFromCache,
  } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'workflows'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: functionDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'functions'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: variableDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'variables'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const workflows = [...(workflowDocs ?? [])]
    .filter((workflow: any) => !workflow.deletedAt)
    .sort((a: any, b: any) =>
      String(a.name ?? '').localeCompare(String(b.name ?? '')),
    )
  /**
   * The workflow HEAD-COUNT is a server aggregate, not the length of the
   * capped listener (AGL-1716, the AGL-1706 shape).
   *
   * The listener is `limit(100)` and `workflows.length` fed
   * `checkQuota(org, 'workflowsPerHost', …)`, whose bands are 0 / 3 / 25 /
   * 100 / 250 / 500. The window TIES Business's 100 and hides Scale's 250
   * and Advanced's 500, so on those plans the gate compared 100 against
   * hundreds and could never refuse — while `api/hosts/resources` counted
   * the collection and did. The card offered headroom that did not exist and
   * then failed the create.
   *
   * UNFILTERED, matching that route's plain `collection('workflows').count()`
   * — its `softDeletes` branch governs only the flat per-host webhook cap, so
   * soft-deleted workflows have always counted server-side while this card
   * excluded them. Only a create moves the number, so that is where it is
   * re-read.
   */
  const [workflowCountEpoch, setWorkflowCountEpoch] = useState(0)
  const [serverWorkflowCount, setServerWorkflowCount] = useState<number | null>(
    null,
  )
  useEffect(() => {
    let active = true
    void getCountFromServer(collection(firestore, 'hosts', hostId, 'workflows'))
      .then((snapshot) => {
        if (active) setServerWorkflowCount(snapshot.data().count)
      })
      .catch(() => {
        // Falls back to the loaded rows — a LOWER bound and the prior
        // behaviour, never 0, which `checkQuota` would answer as "no usage"
        // on a site that is over its band.
      })
    return () => {
      active = false
    }
  }, [firestore, hostId, workflowCountEpoch])
  const workflowCount = serverWorkflowCount ?? workflows.length
  // Double-keyed by doc id and name (AGL-261): id references are
  // rename-safe; legacy name references keep resolving.
  const functions = useMemo(() => {
    const map: Record<string, HostFunction> = {}
    for (const definition of functionDocs ?? []) {
      if (definition.deletedAt) continue
      if (definition.$id) map[definition.$id] = definition
      if (definition.name) map[definition.name] = definition
    }
    return map
  }, [functionDocs])
  const functionOptions = useMemo(
    () =>
      (functionDocs ?? [])
        .filter((definition: any) => !definition.deletedAt && definition.name)
        .map((definition: any) => ({
          id: definition.$id as string,
          name: definition.name as string,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [functionDocs],
  )
  const variables = useMemo(() => {
    const map: Record<string, HostVariable> = {}
    for (const variable of variableDocs ?? []) {
      if (!variable.deletedAt && variable.name) map[variable.name] = variable
    }
    return map
  }, [variableDocs])

  const [draft, setDraft] = useState<WorkflowDraft | null>(null)

  // Where-used dialog (AGL-193).
  const [usage, setUsage] = useState<{
    name: string
    result: WhereUsedResult
  } | null>(null)
  const [usageLoading, setUsageLoading] = useState<string | null>(null)

  const [testResult, setTestResult] = useState<string | null>(null)
  const [runsFor, setRunsFor] = useState<any | null>(null)

  // Case-insensitive uniqueness (AGL-185): workflow names must stay
  // unambiguous for computed-variable lookups keyed by name.
  const nameTaken = Boolean(
    draft &&
      workflows.some(
        (definition: any) =>
          String(definition.name ?? '').toLowerCase() ===
            draft.name.trim().toLowerCase() && definition.$id !== draft.id,
      ),
  )

  const patch = useCallback(
    (updater: (previous: WorkflowDraft) => WorkflowDraft) =>
      setDraft((previous) => (previous ? updater(previous) : previous)),
    [],
  )

  const handleAdd = useCallback(() => {
    // Feature + cap gate (AGL-99); dark-launch for plan-less workspaces.
    if (!checkEntitlement(org, 'workflows')) {
      return void enqueueSnackbar(
        'Workflows require a Starter plan — see Billing to upgrade',
        { variant: 'warning', persist: false },
      )
    }
    // The site's workflows, not this page of them (AGL-1716).
    const quota = checkQuota(org, 'workflowsPerHost', workflowCount)
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
  }, [org, workflowCount, enqueueSnackbar])

  const handleTestRun = useCallback(() => {
    if (!draft) return
    const run = runWorkflow(draft, functions, variables)
    setTestResult(
      run.ok === false
        ? `Error: ${run.error}`
        : `Result: ${String(run.value)} (${Object.entries(run.results)
            .map(([key, value]) => `${key}=${value}`)
            .join(', ')})`,
    )
  }, [draft, functions, variables])

  const handleSave = useCallback(async () => {
    if (!draft || !draft.name.trim() || nameTaken) return
    const { id: draftId, ...definition } = draft
    const fields = { ...definition, name: draft.name.trim().slice(0, 60) }
    try {
      if (draftId) {
        /**
         * Edit stays client-direct (no quota consumed) — and is refused when
         * its seed was never confirmed by the server (AGL-1358). `fields` is
         * the whole definition spread out of the listener row, `trigger` and
         * `steps` included, so `merge: true` has nothing left to protect.
         *
         * The guard WRAPS the write. An early return is a shape you can keep
         * while losing the protection; here the write is only reachable
         * through the verdict.
         */
        const verdict = await writeGuardedBySeed(
          {
            subject: 'workflow',
            unreadable: workflowsStatus === 'error',
            fromCache: workflowsFromCache,
          },
          async () => {
            await setDoc(
              doc(firestore, 'hosts', hostId, 'workflows', draftId),
              { ...fields, updatedAt: Timestamp.now() },
              { merge: true },
            )
          },
        )
        // Before `setDraft(null)`, so a refusal keeps the dialog open with
        // every step that was built and its test run still on screen.
        if (!verdict.ok) {
          return void enqueueSnackbar(verdict.message, {
            variant: 'warning',
            persist: false,
          })
        }
      } else {
        // New workflow rides the quota-enforcing resources API (AGL-473) —
        // it also re-checks the `workflows` entitlement server-side.
        await createHostResource({ hostId, resource: 'workflow', data: fields })
        // A create moves the count; the one-shot aggregate below does not
        // refresh itself the way the listener refreshes the rows.
        setWorkflowCountEpoch((epoch) => epoch + 1)
      }
      setDraft(null)
      enqueueSnackbar('Workflow saved', { variant: 'success', persist: false })
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [
    draft,
    nameTaken,
    firestore,
    hostId,
    createHostResource,
    enqueueSnackbar,
    workflowsStatus,
    workflowsFromCache,
  ])

  const handleShowUsage = useCallback(
    (workflow: any) => async () => {
      setUsageLoading(workflow.$id)
      const result = await fetchWhereUsed(user as any, {
        hostId,
        kind: 'workflow',
        id: workflow.$id,
        name: workflow.name,
      })
      setUsageLoading(null)
      setUsage({ name: workflow.name, result })
    },
    [user, hostId],
  )

  const handleDelete = useCallback(
    (workflow: any) => async () => {
      // Dependents warning (AGL-187): computed variables backed by this
      // workflow keep their stored fallback value once it is gone.
      const scan = await fetchWhereUsed(user as any, {
        hostId,
        kind: 'workflow',
        id: workflow.$id,
        name: workflow.name,
      })
      const confirmed = await confirm({
        title: 'Delete this workflow?',
        description: scan.total
          ? `"${workflow.name}" computes ${summarizeDependents(scan)} — ` +
            'those variables will fall back to their stored values.'
          : `"${workflow.name}" will no longer be runnable.`,
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
    [user, confirm, firestore, hostId, enqueueSnackbar],
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
                disabled={usageLoading === workflow.$id}
                onClick={handleShowUsage(workflow)}
              >
                {usageLoading === workflow.$id ? 'Scanning…' : 'Usage'}
              </Button>
              {/* Run history (wave v6): the event runner logs status +
                  duration per run. */}
              <Button size="small" onClick={() => setRunsFor(workflow)}>
                {'Runs'}
              </Button>
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
          color="primary"
          sx={{ alignSelf: 'flex-start' }}
          onClick={handleAdd}
        >
          {'Add workflow'}
        </Button>
        {/* The cap, standing rather than only on refusal (AGL-2113).
            `workflowCount` is the server aggregate the gate uses, not
            `workflows.length` — the listener is `limit(100)` and its length
            saturates (AGL-1716). */}
        <QuotaReadoutComponent
          ready={org != null}
          used={workflowCount}
          limit={checkQuota(org, 'workflowsPerHost', workflowCount).limit}
          noun="workflow"
        />
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
            helperText={
              nameTaken
                ? 'A workflow with this name already exists'
                : 'Used to identify the workflow'
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
          <Typography variant="overline" color="text.secondary">
            {'Steps'}
          </Typography>
          {(draft?.steps ?? []).map((step, index) => {
            const definition =
              functions[(step as any).functionId ?? ''] ??
              functions[step.functionName]
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
                    // Stored by id (AGL-261); legacy steps carry only the
                    // name and resolve through the double-keyed map.
                    value={
                      (step as any).functionId ??
                      (functions[step.functionName] as any)?.$id ??
                      ''
                    }
                    onChange={(event) =>
                      patch((previous) => ({
                        ...previous,
                        steps: previous.steps.map((s, index2) =>
                          index2 === index
                            ? {
                                ...s,
                                functionId: event.target.value,
                                functionName:
                                  functionOptions.find(
                                    (option) =>
                                      option.id === event.target.value,
                                  )?.name ?? s.functionName,
                              }
                            : s,
                        ),
                      }))
                    }
                    size="small"
                    select
                    sx={{ minWidth: 160, flex: 1 }}
                  >
                    {functionOptions.map((option) => (
                      <MenuItem key={option.id} value={option.id}>
                        {option.name}
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
            <Button size="small" color="primary" onClick={handleTestRun}>
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
            color="primary"
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
      <Dialog
        open={Boolean(runsFor)}
        onClose={() => setRunsFor(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{`Runs — ${runsFor?.name ?? ''}`}</DialogTitle>
        <DialogContent>
          {runsFor ? (
            <HostActivityCard
              hostId={hostId}
              targetId={runsFor.$id}
              header="Recent runs"
              max={25}
            />
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setRunsFor(null)}>
            {'Close'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
HostWorkflowsCard.displayName = 'HostWorkflowsCard'

export default HostWorkflowsCard
