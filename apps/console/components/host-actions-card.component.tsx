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
  ACTION_MAX_STEPS,
  createResourceUid,
  HOST_ACTION_STEP_LABELS,
  HOST_EVENT_TYPES,
  type HostAction,
  type HostActionStep,
  type HostActionStepType,
  validateHostAction,
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
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import {
  collection,
  doc,
  limit,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { useCallback, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { hasEntitlement } from '../constants/entitlements'
import useCurrentTenant from '../hooks/use-current-tenant'
import useFirestoreCollection from '../hooks/use-firestore-collection'

const CUSTOM_EVENT_VALUE = '__custom__'

interface ActionDraft extends HostAction {
  id: string | null
  /** Raw custom-event text when the trigger select is on "custom". */
  customEvent: string
}

function defaultStep(type: HostActionStepType): HostActionStep {
  switch (type) {
    case 'runWorkflow':
      return { type, workflowName: '' }
    case 'siteAlert':
      return { type, message: '', severity: 'info' }
    case 'customEvent':
      return { type, eventName: '' }
    case 'webhookPost':
      return { type, webhookName: '' }
    default:
      return { type: 'datasetAppend', datasetName: '' }
  }
}

/**
 * Actions builder (AGL-148): HubSpot-style enrollment — trigger event →
 * optional filter → ordered steps (run workflow, site alert, custom
 * event, dataset append). Runs server-side via runEventActions; paid
 * feature (`actions` flag, Pro+, `actionRunsPerMonth` metered).
 */
export function HostActionsCard(props: { hostId: string }) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { tenant } = useCurrentTenant()

  const { data: actionDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'actions'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: workflowDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'workflows'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: datasetDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'datasets'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: webhookDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'webhooks'), limit(20)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const actions = [...(actionDocs ?? [])]
    .filter((action: any) => !action.deletedAt)
    .sort((a: any, b: any) =>
      String(a.name ?? '').localeCompare(String(b.name ?? '')),
    )
  const workflowNames = (workflowDocs ?? [])
    .filter((workflow: any) => !workflow.deletedAt && workflow.name)
    .map((workflow: any) => workflow.name as string)
    .sort()
  const datasetNames = (datasetDocs ?? [])
    .filter((dataset: any) => !dataset.deletedAt && dataset.name)
    .map((dataset: any) => dataset.name as string)
    .sort()
  const webhookNames = (webhookDocs ?? [])
    .filter(
      (hook: any) =>
        !hook.deletedAt && hook.name && hook.direction === 'outbound',
    )
    .map((hook: any) => hook.name as string)
    .sort()

  const [draft, setDraft] = useState<ActionDraft | null>(null)
  const patch = useCallback(
    (updater: (previous: ActionDraft) => ActionDraft) =>
      setDraft((previous) => (previous ? updater(previous) : previous)),
    [],
  )

  const handleAdd = useCallback(() => {
    if (!hasEntitlement('actions', tenant)) {
      return void enqueueSnackbar(
        'The actions builder requires a Pro plan — see Billing to upgrade',
        { variant: 'warning', persist: false },
      )
    }
    setDraft({
      id: null,
      name: '',
      trigger: { event: 'formSubmission', filter: '' },
      steps: [defaultStep('siteAlert')],
      enabled: true,
      customEvent: '',
    })
  }, [tenant, enqueueSnackbar])

  const handleSave = useCallback(async () => {
    if (!draft) return
    const isCustom = draft.trigger.event === CUSTOM_EVENT_VALUE
    const candidate: HostAction = {
      name: draft.name.trim().slice(0, 60),
      trigger: {
        event: isCustom ? draft.customEvent.trim() : draft.trigger.event,
        ...(draft.trigger.filter?.trim()
          ? { filter: draft.trigger.filter.trim() }
          : {}),
      },
      steps: draft.steps,
      enabled: draft.enabled !== false,
    }
    const problem = validateHostAction(candidate)
    if (problem) {
      return void enqueueSnackbar(problem, {
        variant: 'warning',
        persist: false,
      })
    }
    try {
      const id = draft.id ?? createResourceUid()
      await setDoc(
        doc(firestore, 'hosts', hostId, 'actions', id),
        {
          ...candidate,
          updatedAt: Timestamp.now(),
          ...(draft.id ? {} : { createdAt: Timestamp.now() }),
        },
        { merge: true },
      )
      setDraft(null)
      enqueueSnackbar('Action saved', { variant: 'success', persist: false })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [draft, firestore, hostId, enqueueSnackbar])

  const handleDelete = useCallback(
    (action: any) => async () => {
      const confirmed = await confirm({
        title: 'Delete this action?',
        description: `"${action.name}" stops running on its trigger.`,
        confirmationText: 'Delete',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      await updateDoc(doc(firestore, 'hosts', hostId, 'actions', action.$id), {
        deletedAt: Timestamp.now(),
      })
    },
    [confirm, firestore, hostId],
  )

  const handleToggle = useCallback(
    (action: any) => async (event: { target: { checked: boolean } }) => {
      await updateDoc(doc(firestore, 'hosts', hostId, 'actions', action.$id), {
        enabled: event.target.checked,
      })
    },
    [firestore, hostId],
  )

  return (
    <CardDisplay header={'Actions'} contentGutterX contentGutterY>
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">
          {'When a site event fires, run automations in order — trigger a ' +
            'workflow, show the visitor an alert, chain a custom event, or ' +
            'write to a dataset. Pro plans and up.'}
        </Typography>
        {actions.map((action: any) => (
          <Stack
            key={action.$id}
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center' }}
          >
            <Switch
              size="small"
              checked={action.enabled !== false}
              onChange={handleToggle(action)}
            />
            <Stack sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {action.name}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {`on ${action.trigger?.event}` +
                  ` · ${(action.steps ?? [])
                    .map(
                      (step: any) =>
                        HOST_ACTION_STEP_LABELS[
                          step.type as HostActionStepType
                        ] ?? step.type,
                    )
                    .join(' → ')}`}
              </Typography>
            </Stack>
            <Button
              size="small"
              onClick={() =>
                setDraft({
                  id: action.$id,
                  name: action.name ?? '',
                  trigger: {
                    event: HOST_EVENT_TYPES.includes(action.trigger?.event)
                      ? action.trigger.event
                      : CUSTOM_EVENT_VALUE,
                    filter: action.trigger?.filter ?? '',
                  },
                  steps: action.steps ?? [],
                  enabled: action.enabled !== false,
                  customEvent: HOST_EVENT_TYPES.includes(
                    action.trigger?.event,
                  )
                    ? ''
                    : (action.trigger?.event ?? ''),
                })
              }
            >
              {'Edit'}
            </Button>
            <Button size="small" color="error" onClick={handleDelete(action)}>
              {'Delete'}
            </Button>
          </Stack>
        ))}
        <Button
          size="small"
          color="secondary"
          sx={{ alignSelf: 'flex-start' }}
          onClick={handleAdd}
        >
          {'Add action'}
        </Button>
      </Stack>

      <Dialog
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{draft?.id ? 'Edit action' : 'Add action'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}
        >
          <TextField
            label="Name"
            value={draft?.name ?? ''}
            onChange={(event) =>
              patch((previous) => ({ ...previous, name: event.target.value }))
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
          />
          <Stack direction="row" spacing={1}>
            <TextField
              select
              label="Trigger event"
              value={draft?.trigger.event ?? ''}
              onChange={(event) =>
                patch((previous) => ({
                  ...previous,
                  trigger: { ...previous.trigger, event: event.target.value },
                }))
              }
              size="small"
              sx={{ minWidth: 180 }}
            >
              {HOST_EVENT_TYPES.map((eventType) => (
                <MenuItem key={eventType} value={eventType}>
                  {eventType}
                </MenuItem>
              ))}
              <MenuItem value={CUSTOM_EVENT_VALUE}>{'Custom event…'}</MenuItem>
            </TextField>
            {draft?.trigger.event === CUSTOM_EVENT_VALUE ? (
              <TextField
                label="Custom event name"
                value={draft?.customEvent ?? ''}
                onChange={(event) =>
                  patch((previous) => ({
                    ...previous,
                    customEvent: event.target.value,
                  }))
                }
                size="small"
                sx={{ flex: 1 }}
              />
            ) : (
              <TextField
                label="Filter (optional)"
                placeholder={'path == "/pricing"'}
                value={draft?.trigger.filter ?? ''}
                onChange={(event) =>
                  patch((previous) => ({
                    ...previous,
                    trigger: {
                      ...previous.trigger,
                      filter: event.target.value,
                    },
                  }))
                }
                size="small"
                sx={{ flex: 1 }}
              />
            )}
          </Stack>
          <Typography variant="overline" color="text.secondary">
            {'Steps (run in order)'}
          </Typography>
          {(draft?.steps ?? []).map((step, index) => (
            <Stack
              key={index}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center' }}
            >
              <Typography variant="caption" color="text.secondary">
                {`${index + 1}`}
              </Typography>
              <TextField
                select
                label="Do"
                value={step.type}
                onChange={(event) =>
                  patch((previous) => ({
                    ...previous,
                    steps: previous.steps.map((s, index2) =>
                      index2 === index
                        ? defaultStep(event.target.value as HostActionStepType)
                        : s,
                    ),
                  }))
                }
                size="small"
                sx={{ minWidth: 170 }}
              >
                {Object.entries(HOST_ACTION_STEP_LABELS).map(
                  ([value, label]) => (
                    <MenuItem key={value} value={value}>
                      {label}
                    </MenuItem>
                  ),
                )}
              </TextField>
              {step.type === 'runWorkflow' ? (
                <TextField
                  select
                  label="Workflow"
                  value={step.workflowName}
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      steps: previous.steps.map((s, index2) =>
                        index2 === index
                          ? { ...s, workflowName: event.target.value }
                          : s,
                      ),
                    }))
                  }
                  size="small"
                  sx={{ flex: 1 }}
                >
                  {workflowNames.map((name) => (
                    <MenuItem key={name} value={name}>
                      {name}
                    </MenuItem>
                  ))}
                </TextField>
              ) : step.type === 'siteAlert' ? (
                <>
                  <TextField
                    label="Message"
                    value={step.message}
                    onChange={(event) =>
                      patch((previous) => ({
                        ...previous,
                        steps: previous.steps.map((s, index2) =>
                          index2 === index
                            ? { ...s, message: event.target.value }
                            : s,
                        ),
                      }))
                    }
                    size="small"
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    select
                    label="Style"
                    value={step.severity ?? 'info'}
                    onChange={(event) =>
                      patch((previous) => ({
                        ...previous,
                        steps: previous.steps.map((s, index2) =>
                          index2 === index
                            ? { ...s, severity: event.target.value as any }
                            : s,
                        ),
                      }))
                    }
                    size="small"
                    sx={{ width: 110 }}
                  >
                    {['info', 'success', 'warning', 'error'].map((value) => (
                      <MenuItem key={value} value={value}>
                        {value}
                      </MenuItem>
                    ))}
                  </TextField>
                </>
              ) : step.type === 'customEvent' ? (
                <TextField
                  label="Event name"
                  value={step.eventName}
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      steps: previous.steps.map((s, index2) =>
                        index2 === index
                          ? { ...s, eventName: event.target.value }
                          : s,
                      ),
                    }))
                  }
                  size="small"
                  sx={{ flex: 1 }}
                />
              ) : step.type === 'webhookPost' ? (
                <TextField
                  select
                  label="Webhook"
                  value={step.webhookName}
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      steps: previous.steps.map((s, index2) =>
                        index2 === index
                          ? { ...s, webhookName: event.target.value }
                          : s,
                      ),
                    }))
                  }
                  size="small"
                  sx={{ flex: 1 }}
                >
                  {webhookNames.map((name) => (
                    <MenuItem key={name} value={name}>
                      {name}
                    </MenuItem>
                  ))}
                </TextField>
              ) : (
                <TextField
                  select
                  label="Dataset"
                  value={step.datasetName}
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      steps: previous.steps.map((s, index2) =>
                        index2 === index
                          ? { ...s, datasetName: event.target.value }
                          : s,
                      ),
                    }))
                  }
                  size="small"
                  sx={{ flex: 1 }}
                >
                  {datasetNames.map((name) => (
                    <MenuItem key={name} value={name}>
                      {name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
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
          ))}
          <Button
            size="small"
            sx={{ alignSelf: 'flex-start' }}
            disabled={(draft?.steps.length ?? 0) >= ACTION_MAX_STEPS}
            onClick={() =>
              patch((previous) => ({
                ...previous,
                steps: [...previous.steps, defaultStep('siteAlert')],
              }))
            }
          >
            {'Add step'}
          </Button>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={!draft?.name.trim()}
            onClick={handleSave}
          >
            {'Save action'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
HostActionsCard.displayName = 'HostActionsCard'

export default HostActionsCard
