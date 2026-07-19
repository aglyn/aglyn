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
  ACTION_MAX_CONDITIONS,
  ACTION_MAX_STEPS,
  type AglynOrgBilling,
  checkEntitlement,
  createResourceUid,
  ELEMENT_SCOPED_SITE_EVENTS,
  HOST_ACTION_STEP_LABELS,
  isSiteEventType,
  normalizeTriggerConditions,
  SITE_EVENT_TYPES,
  HOST_EVENT_TYPES,
  type HostAction,
  type HostActionStep,
  type HostActionStepType,
  type TriggerCombinator,
  type TriggerConditionOp,
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
import {
  useFirestore,
  useFirestoreCollection,
  useHostOrgId,
} from '@aglyn/tenant-feature-instance'
import HostActivityCard from './host-activity-card.component'

const CUSTOM_EVENT_VALUE = '__custom__'

/** One editable condition row (AGL-565); a lone row with an empty op
 * means "always run" and clears the stored conditions. */
interface ConditionRowDraft {
  op: '' | TriggerConditionOp
  field: string
  value: string
}

const EMPTY_CONDITION_ROW: ConditionRowDraft = { op: '', field: '', value: '' }

interface ActionDraft extends HostAction {
  id: string | null
  /** Raw custom-event text when the trigger select is on "custom". */
  customEvent: string
  // Structured payload conditions (AGL-557), chainable with AND/OR
  // (AGL-565) — held as rows like the steps list; legacy
  // single-`condition` docs hydrate through normalizeTriggerConditions.
  conditionRows: ConditionRowDraft[]
  conditionCombinator: TriggerCombinator
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
    case 'showOverlay':
      return { type, overlayId: '' }
    case 'stickyNav':
      return { type, selector: '' }
    case 'addClass':
    case 'removeClass':
      return { type, selector: '', className: '' }
    // Element show/hide + drawer commands (AGL-562).
    case 'showElement':
    case 'hideElement':
    case 'toggleElement':
      return { type, selector: '' }
    case 'openDrawer':
    case 'closeDrawer':
    case 'toggleDrawer':
      return { type }
    // Menu commands (AGL-568) mirror the drawer's optional target.
    case 'openMenu':
    case 'closeMenu':
    case 'toggleMenu':
      return { type }
    case 'showHtml':
      return { type, html: '' }
    case 'runJs':
      return { type, code: '' }
    case 'redirect':
      return { type, url: '' }
    case 'trackGaEvent':
      return { type, eventName: '' }
    case 'sendEmail':
      return { type, subject: '', body: '' }
    case 'notifyAdmins':
      return { type, title: '' }
    case 'enrollList':
      return { type, listId: '' }
    case 'updateDataset':
      return { type, datasetId: '' }
    case 'assignCampaign':
      return { type, campaignId: '' }
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
export function HostActionsCard(props: {
  hostId: string
  org?: Partial<AglynOrgBilling>
}) {
  const { hostId, org } = props
  // Org-shared data root (AGL-237); the host path is the pre-migration
  // fallback for hosts not yet org-wired.
  const hostOrgId = useHostOrgId(hostId)
  const dataScope = hostOrgId
    ? (['orgs', hostOrgId] as const)
    : (['hosts', hostId] as const)
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()


  const { data: actionDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'actions'), limit(100)),
    [firestore, hostId, hostOrgId],
    { idField: '$id' },
  )
  const { data: workflowDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'workflows'), limit(100)),
    [firestore, hostId, hostOrgId],
    { idField: '$id' },
  )
  const { data: datasetDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, dataScope[0], dataScope[1], 'datasets'), limit(100)),
    [firestore, hostId, hostOrgId],
    { idField: '$id' },
  )
  const { data: overlayDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'overlays'), limit(50)),
    [firestore, hostId, hostOrgId],
    { idField: '$id' },
  )
  // Lists live on the org (AGL-254); campaigns on the host.
  const { data: listDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, dataScope[0], dataScope[1], 'lists'),
        limit(50),
      ),
    [firestore, hostId, hostOrgId],
    { idField: '$id' },
  )
  const { data: campaignDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'campaigns'), limit(50)),
    [firestore, hostId, hostOrgId],
    { idField: '$id' },
  )
  const { data: webhookDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'webhooks'), limit(20)),
    [firestore, hostId, hostOrgId],
    { idField: '$id' },
  )
  const actions = [...(actionDocs ?? [])]
    .filter((action: any) => !action.deletedAt)
    .sort((a: any, b: any) =>
      String(a.name ?? '').localeCompare(String(b.name ?? '')),
    )
  // Options carry ids (AGL-261): selects store the doc id, keep the name
  // as the display hint, and legacy name-only steps map back to their id.
  const workflowOptions = (workflowDocs ?? [])
    .filter((workflow: any) => !workflow.deletedAt && workflow.name)
    .map((workflow: any) => ({
      id: workflow.$id as string,
      name: workflow.name as string,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const datasetOptions = (datasetDocs ?? [])
    .filter((dataset: any) => !dataset.deletedAt && dataset.name)
    .map((dataset: any) => ({
      id: dataset.$id as string,
      name: dataset.name as string,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const overlayOptions = (overlayDocs ?? [])
    .filter((overlay: any) => !overlay.deletedAt)
    .map((overlay: any) => ({
      id: overlay.$id as string,
      name: (overlay.name ||
        overlay.bar?.text ||
        overlay.popup?.headline ||
        overlay.$id) as string,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const listOptions = (listDocs ?? [])
    .filter((list: any) => !list.deletedAt && list.name)
    .map((list: any) => ({
      id: list.$id as string,
      name: list.name as string,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const campaignOptions = (campaignDocs ?? [])
    .filter((campaign: any) => !campaign.deletedAt && campaign.name)
    .map((campaign: any) => ({
      id: campaign.$id as string,
      name: campaign.name as string,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const webhookOptions = (webhookDocs ?? [])
    .filter(
      (hook: any) =>
        !hook.deletedAt && hook.name && hook.direction === 'outbound',
    )
    .map((hook: any) => ({
      id: hook.$id as string,
      name: hook.name as string,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const [draft, setDraft] = useState<ActionDraft | null>(null)
  const patch = useCallback(
    (updater: (previous: ActionDraft) => ActionDraft) =>
      setDraft((previous) => (previous ? updater(previous) : previous)),
    [],
  )

  const handleAdd = useCallback(() => {
    if (!checkEntitlement(org, 'actions')) {
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
      conditionRows: [EMPTY_CONDITION_ROW],
      conditionCombinator: 'and',
    })
  }, [org, enqueueSnackbar])

  // Run log + test runs (AGL-266).
  const [runsFor, setRunsFor] = useState<any | null>(null)
  const handleTestRun = useCallback(
    async (action: any) => {
      try {
        const response = await fetch('/api/events/dispatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hostId,
            actionId: action.$id,
            event: action.trigger?.event,
            payload: { path: '/console-test', test: 'true' },
          }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          return void enqueueSnackbar(payload?.error ?? 'Test run failed', {
            variant: 'warning',
            persist: false,
          })
        }
        const alerts = Array.isArray(payload?.alerts) ? payload.alerts : []
        enqueueSnackbar(
          alerts.length
            ? `Test ran — first alert: ${alerts[0].message}`
            : 'Test ran — server steps executed (see Runs)',
          { variant: 'success', persist: false },
        )
      } catch (error) {
        console.error(error)
        enqueueSnackbar('Test run failed', { variant: 'error' })
      }
    },
    [hostId, enqueueSnackbar],
  )

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
        // Site-event config (AGL-256).
        ...(draft.trigger.selector?.trim()
          ? { selector: draft.trigger.selector.trim() }
          : {}),
        ...(Number(draft.trigger.threshold) > 0
          ? { threshold: Number(draft.trigger.threshold) }
          : {}),
        ...(draft.trigger.pathPattern?.trim()
          ? { pathPattern: draft.trigger.pathPattern.trim() }
          : {}),
        // Frequency caps (AGL-274).
        ...(draft.trigger.oncePerVisitor === true
          ? { oncePerVisitor: true }
          : {}),
        ...(draft.trigger.oncePerSession === true
          ? { oncePerSession: true }
          : {}),
        ...(Number(draft.trigger.cooldownMinutes) >= 1
          ? { cooldownMinutes: Number(draft.trigger.cooldownMinutes) }
          : {}),
        ...(draft.trigger.everyTime === true ? { everyTime: true } : {}),
        // Structured payload conditions (AGL-557; chained AGL-565):
        // rows keep their blank fields so validateHostAction surfaces
        // the miss. Saves always write the list shape — the legacy
        // single `condition` is only ever read, never written back.
        ...(draft.conditionRows.some((row) => row.op)
          ? {
              conditions: draft.conditionRows
                .filter((row) => row.op)
                .map((row) => ({
                  field: row.field.trim(),
                  op: row.op as TriggerConditionOp,
                  ...(row.op !== 'notEmpty'
                    ? { value: row.value.trim() }
                    : {}),
                })),
              combinator: draft.conditionCombinator,
            }
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
          // Frequency caps overwrite explicitly (AGL-274): a merge-set
          // keeps omitted keys, so switching one off must write it out.
          // Conditions follow suit (AGL-557/565): the list + combinator
          // write null when cleared, and the legacy single `condition`
          // is always nulled — `conditions` is canonical from now on.
          trigger: {
            ...candidate.trigger,
            oncePerVisitor: draft.trigger.oncePerVisitor === true,
            oncePerSession: draft.trigger.oncePerSession === true,
            cooldownMinutes:
              Number(draft.trigger.cooldownMinutes) >= 1
                ? Number(draft.trigger.cooldownMinutes)
                : null,
            everyTime: draft.trigger.everyTime === true,
            condition: null,
            conditions: candidate.trigger.conditions ?? null,
            combinator: candidate.trigger.combinator ?? null,
          },
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
    [firestore, hostId, hostOrgId],
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
                  // Site events are first-class (AGL-256/266): keep their
                  // selector/threshold/path config through an edit.
                  trigger: {
                    event:
                      HOST_EVENT_TYPES.includes(action.trigger?.event) ||
                      isSiteEventType(String(action.trigger?.event ?? ''))
                        ? action.trigger.event
                        : CUSTOM_EVENT_VALUE,
                    filter: action.trigger?.filter ?? '',
                    selector: action.trigger?.selector ?? '',
                    threshold: action.trigger?.threshold,
                    pathPattern: action.trigger?.pathPattern ?? '',
                    oncePerVisitor: action.trigger?.oncePerVisitor === true,
                    oncePerSession: action.trigger?.oncePerSession === true,
                    everyTime: action.trigger?.everyTime === true,
                    ...(Number(action.trigger?.cooldownMinutes) >= 1
                      ? {
                          cooldownMinutes: Number(
                            action.trigger?.cooldownMinutes,
                          ),
                        }
                      : {}),
                  },
                  steps: action.steps ?? [],
                  enabled: action.enabled !== false,
                  customEvent:
                    HOST_EVENT_TYPES.includes(action.trigger?.event) ||
                    isSiteEventType(String(action.trigger?.event ?? ''))
                      ? ''
                      : (action.trigger?.event ?? ''),
                  // Structured conditions (AGL-557; chained AGL-565):
                  // legacy single-condition docs normalize to one row.
                  conditionRows: (() => {
                    const rows = normalizeTriggerConditions(
                      action.trigger,
                    ).map(
                      (condition): ConditionRowDraft => ({
                        op: condition.op ?? '',
                        field: condition.field ?? '',
                        value: condition.value ?? '',
                      }),
                    )
                    return rows.length ? rows : [EMPTY_CONDITION_ROW]
                  })(),
                  conditionCombinator:
                    action.trigger?.combinator === 'or' ? 'or' : 'and',
                })
              }
            >
              {'Edit'}
            </Button>
            {isSiteEventType(String(action.trigger?.event ?? '')) ? (
              // Test run (AGL-266): server steps only, via the dispatch API.
              <Button size="small" onClick={() => void handleTestRun(action)}>
                {'Test'}
              </Button>
            ) : null}
            <Button size="small" onClick={() => setRunsFor(action)}>
              {'Runs'}
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
              {SITE_EVENT_TYPES.map((eventType) => (
                <MenuItem key={eventType} value={eventType}>
                  {`${eventType} (on page)`}
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
          {/* Structured payload conditions (AGL-557): the no-code sibling
              of the filter — e.g. only when `subscribe` is not empty.
              Chainable with AND/OR (AGL-565), rows styled like steps. */}
          {(draft?.conditionRows ?? []).map((row, index) => (
            <Stack
              key={index}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center' }}
            >
              {index > 0 ? (
                <Typography variant="caption" color="text.secondary">
                  {draft?.conditionCombinator === 'or' ? 'or' : 'and'}
                </Typography>
              ) : null}
              <TextField
                select
                label={index === 0 ? 'Only run when' : 'Condition'}
                value={row.op}
                onChange={(event) =>
                  patch((previous) => ({
                    ...previous,
                    conditionRows: previous.conditionRows.map(
                      (previousRow, index2) =>
                        index2 === index
                          ? {
                              ...previousRow,
                              op: event.target
                                .value as ConditionRowDraft['op'],
                            }
                          : previousRow,
                    ),
                  }))
                }
                size="small"
                sx={{ minWidth: 180 }}
              >
                {/* "Always" only exists while this is the sole row —
                    multi-row chains clear by removing rows instead. */}
                {(draft?.conditionRows.length ?? 0) === 1 ? (
                  <MenuItem value="">{'Always (no condition)'}</MenuItem>
                ) : null}
                <MenuItem value="notEmpty">{'A field is not empty'}</MenuItem>
                <MenuItem value="equals">{'A field equals…'}</MenuItem>
                <MenuItem value="contains">{'A field contains…'}</MenuItem>
              </TextField>
              {row.op ? (
                <TextField
                  label="Field"
                  placeholder="subscribe"
                  value={row.field}
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      conditionRows: previous.conditionRows.map(
                        (previousRow, index2) =>
                          index2 === index
                            ? { ...previousRow, field: event.target.value }
                            : previousRow,
                      ),
                    }))
                  }
                  size="small"
                  sx={{ flex: 1 }}
                />
              ) : null}
              {row.op === 'equals' || row.op === 'contains' ? (
                <TextField
                  label="Value"
                  placeholder="Yes"
                  value={row.value}
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      conditionRows: previous.conditionRows.map(
                        (previousRow, index2) =>
                          index2 === index
                            ? { ...previousRow, value: event.target.value }
                            : previousRow,
                      ),
                    }))
                  }
                  size="small"
                  sx={{ flex: 1 }}
                />
              ) : null}
              {(draft?.conditionRows.length ?? 0) > 1 ? (
                <IconButton
                  size="small"
                  aria-label="remove condition"
                  onClick={() =>
                    patch((previous) => ({
                      ...previous,
                      conditionRows: previous.conditionRows.length > 1
                        ? previous.conditionRows.filter(
                            (_, index2) => index2 !== index,
                          )
                        : [EMPTY_CONDITION_ROW],
                    }))
                  }
                >
                  {'×'}
                </IconButton>
              ) : null}
            </Stack>
          ))}
          {draft?.conditionRows.every((row) => row.op) ? (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Button
                size="small"
                disabled={
                  (draft?.conditionRows.length ?? 0) >= ACTION_MAX_CONDITIONS
                }
                onClick={() =>
                  patch((previous) => ({
                    ...previous,
                    conditionRows: [
                      ...previous.conditionRows,
                      // New rows start on the simplest operator so the
                      // field input is immediately visible.
                      { op: 'notEmpty', field: '', value: '' },
                    ],
                  }))
                }
              >
                {'Add condition'}
              </Button>
              {(draft?.conditionRows.length ?? 0) >= 2 ? (
                // AND/OR combinator (AGL-565); applies to every row.
                <TextField
                  select
                  label="Match"
                  value={draft?.conditionCombinator ?? 'and'}
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      conditionCombinator: event.target
                        .value as TriggerCombinator,
                    }))
                  }
                  size="small"
                  sx={{ minWidth: 220 }}
                >
                  <MenuItem value="and">
                    {'All conditions match (AND)'}
                  </MenuItem>
                  <MenuItem value="or">
                    {'Any condition matches (OR)'}
                  </MenuItem>
                </TextField>
              ) : null}
            </Stack>
          ) : null}
          {isSiteEventType(draft?.trigger.event ?? '') ? (
            // Site-event config (AGL-256): what/where the trigger watches.
            <Stack direction="row" spacing={1}>
              {(ELEMENT_SCOPED_SITE_EVENTS as readonly string[]).includes(
                draft?.trigger.event ?? '',
              ) ? (
                <TextField
                  label="CSS selector"
                  placeholder="#pricing-table"
                  value={draft?.trigger.selector ?? ''}
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      trigger: {
                        ...previous.trigger,
                        selector: event.target.value,
                      },
                    }))
                  }
                  size="small"
                  sx={{ flex: 1 }}
                />
              ) : null}
              {['scrollDepth', 'timeOnPage'].includes(
                draft?.trigger.event ?? '',
              ) ? (
                <TextField
                  type="number"
                  label={
                    draft?.trigger.event === 'scrollDepth'
                      ? 'Scroll %'
                      : 'Seconds'
                  }
                  value={draft?.trigger.threshold ?? ''}
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      trigger: {
                        ...previous.trigger,
                        threshold: Number(event.target.value),
                      },
                    }))
                  }
                  size="small"
                  sx={{ width: 120 }}
                />
              ) : null}
              <TextField
                label="Only on pages (optional)"
                placeholder="/pricing or /blog/*"
                value={draft?.trigger.pathPattern ?? ''}
                onChange={(event) =>
                  patch((previous) => ({
                    ...previous,
                    trigger: {
                      ...previous.trigger,
                      pathPattern: event.target.value,
                    },
                  }))
                }
                size="small"
                sx={{ flex: 1 }}
              />
              {/* Frequency caps (AGL-274). */}
              <TextField
                select
                label="Frequency"
                size="small"
                sx={{ minWidth: 170 }}
                value={
                  draft?.trigger.oncePerVisitor
                    ? 'visitor'
                    : draft?.trigger.oncePerSession
                      ? 'session'
                      : Number(draft?.trigger.cooldownMinutes) >= 1
                        ? 'cooldown'
                        : draft?.trigger.everyTime
                          ? 'every'
                          : ''
                }
                onChange={(event) => {
                  const mode = event.target.value
                  patch((previous) => ({
                    ...previous,
                    trigger: {
                      ...previous.trigger,
                      // Every occurrence (AGL-562): repeatable UI
                      // choreography (menu/drawer toggles).
                      everyTime: mode === 'every',
                      oncePerVisitor: mode === 'visitor',
                      oncePerSession: mode === 'session',
                      cooldownMinutes:
                        mode === 'cooldown'
                          ? Number(previous.trigger.cooldownMinutes) >= 1
                            ? Number(previous.trigger.cooldownMinutes)
                            : 60
                          : undefined,
                    },
                  }))
                }}
              >
                <MenuItem value="">{'Every matching pageview'}</MenuItem>
                <MenuItem value="every">
                  {'Every occurrence (repeatable)'}
                </MenuItem>
                <MenuItem value="session">{'Once per session'}</MenuItem>
                <MenuItem value="visitor">{'Once per visitor'}</MenuItem>
                <MenuItem value="cooldown">{'With a cooldown'}</MenuItem>
              </TextField>
              {Number(draft?.trigger.cooldownMinutes) >= 1 &&
              !draft?.trigger.oncePerVisitor &&
              !draft?.trigger.oncePerSession ? (
                <TextField
                  type="number"
                  label="Cooldown (minutes)"
                  size="small"
                  sx={{ width: 150 }}
                  value={draft?.trigger.cooldownMinutes ?? 60}
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      trigger: {
                        ...previous.trigger,
                        cooldownMinutes: Number(event.target.value),
                      },
                    }))
                  }
                />
              ) : null}
            </Stack>
          ) : null}
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
                  value={
                    (step as any).workflowId ??
                    workflowOptions.find(
                      (option) => option.name === step.workflowName,
                    )?.id ??
                    ''
                  }
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      steps: previous.steps.map((s, index2) =>
                        index2 === index
                          ? {
                              ...s,
                              workflowId: event.target.value,
                              workflowName:
                                workflowOptions.find(
                                  (option) =>
                                    option.id === event.target.value,
                                )?.name ?? (s as any).workflowName,
                            }
                          : s,
                      ),
                    }))
                  }
                  size="small"
                  sx={{ flex: 1 }}
                >
                  {workflowOptions.map((option) => (
                    <MenuItem key={option.id} value={option.id}>
                      {option.name}
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
                  value={
                    (step as any).webhookId ??
                    webhookOptions.find(
                      (option) => option.name === step.webhookName,
                    )?.id ??
                    ''
                  }
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      steps: previous.steps.map((s, index2) =>
                        index2 === index
                          ? {
                              ...s,
                              webhookId: event.target.value,
                              webhookName:
                                webhookOptions.find(
                                  (option) =>
                                    option.id === event.target.value,
                                )?.name ?? (s as any).webhookName,
                            }
                          : s,
                      ),
                    }))
                  }
                  size="small"
                  sx={{ flex: 1 }}
                >
                  {webhookOptions.map((option) => (
                    <MenuItem key={option.id} value={option.id}>
                      {option.name}
                    </MenuItem>
                  ))}
                </TextField>
              ) : step.type === 'datasetAppend' ||
                step.type === 'updateDataset' ? (
                <TextField
                  select
                  label="Dataset"
                  value={
                    (step as any).datasetId ??
                    datasetOptions.find(
                      (option) => option.name === step.datasetName,
                    )?.id ??
                    ''
                  }
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      steps: previous.steps.map((s, index2) =>
                        index2 === index
                          ? {
                              ...s,
                              datasetId: event.target.value,
                              datasetName:
                                datasetOptions.find(
                                  (option) =>
                                    option.id === event.target.value,
                                )?.name ?? (s as any).datasetName,
                            }
                          : s,
                      ),
                    }))
                  }
                  size="small"
                  sx={{ flex: 1 }}
                >
                  {datasetOptions.map((option) => (
                    <MenuItem key={option.id} value={option.id}>
                      {option.name}
                    </MenuItem>
                  ))}
                </TextField>
              ) : step.type === 'showOverlay' ? (
                <TextField
                  select
                  label="Overlay"
                  value={(step as any).overlayId ?? ''}
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      steps: previous.steps.map((s, index2) =>
                        index2 === index
                          ? {
                              ...s,
                              overlayId: event.target.value,
                              overlayName:
                                overlayOptions.find(
                                  (option) =>
                                    option.id === event.target.value,
                                )?.name ?? '',
                            }
                          : s,
                      ),
                    }))
                  }
                  size="small"
                  sx={{ flex: 1 }}
                >
                  {overlayOptions.map((option) => (
                    <MenuItem key={option.id} value={option.id}>
                      {option.name}
                    </MenuItem>
                  ))}
                </TextField>
              ) : step.type === 'stickyNav' ? (
                <TextField
                  label="Selector (default: header/nav)"
                  value={(step as any).selector ?? ''}
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      steps: previous.steps.map((s, index2) =>
                        index2 === index
                          ? { ...s, selector: event.target.value }
                          : s,
                      ),
                    }))
                  }
                  size="small"
                  sx={{ flex: 1 }}
                />
              ) : step.type === 'addClass' || step.type === 'removeClass' ? (
                <>
                  <TextField
                    label="CSS selector"
                    value={(step as any).selector ?? ''}
                    onChange={(event) =>
                      patch((previous) => ({
                        ...previous,
                        steps: previous.steps.map((s, index2) =>
                          index2 === index
                            ? { ...s, selector: event.target.value }
                            : s,
                        ),
                      }))
                    }
                    size="small"
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    label="Class name"
                    value={(step as any).className ?? ''}
                    onChange={(event) =>
                      patch((previous) => ({
                        ...previous,
                        steps: previous.steps.map((s, index2) =>
                          index2 === index
                            ? { ...s, className: event.target.value }
                            : s,
                        ),
                      }))
                    }
                    size="small"
                    sx={{ width: 150 }}
                  />
                </>
              ) : step.type === 'showElement' ||
                step.type === 'hideElement' ||
                step.type === 'toggleElement' ? (
                // Element choreography (AGL-562). The besigner's builder
                // offers an element picker; here the CSS selector is the
                // escape hatch (node targets use [data-aglyn="leaf:…"]).
                <TextField
                  label="CSS selector"
                  placeholder='[data-aglyn="leaf:…"] or .my-class'
                  value={(step as any).selector ?? ''}
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      steps: previous.steps.map((s, index2) =>
                        index2 === index
                          ? { ...s, selector: event.target.value }
                          : s,
                      ),
                    }))
                  }
                  size="small"
                  sx={{ flex: 1 }}
                />
              ) : step.type === 'openDrawer' ||
                step.type === 'closeDrawer' ||
                step.type === 'toggleDrawer' ? (
                <TextField
                  label="Drawer node id (optional)"
                  placeholder="Empty = the page's first drawer"
                  value={(step as any).drawerNodeId ?? ''}
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      steps: previous.steps.map((s, index2) =>
                        index2 === index
                          ? {
                              ...s,
                              drawerNodeId:
                                event.target.value || undefined,
                            }
                          : s,
                      ),
                    }))
                  }
                  size="small"
                  sx={{ flex: 1 }}
                />
              ) : step.type === 'openMenu' ||
                step.type === 'closeMenu' ||
                step.type === 'toggleMenu' ? (
                // Menu commands (AGL-568). The besigner's builder offers
                // a menu picker; here the raw node id is the escape
                // hatch, like the drawer field above.
                <TextField
                  label="Menu node id (optional)"
                  placeholder="Empty = the page's first menu"
                  value={(step as any).menuNodeId ?? ''}
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      steps: previous.steps.map((s, index2) =>
                        index2 === index
                          ? {
                              ...s,
                              menuNodeId:
                                event.target.value || undefined,
                            }
                          : s,
                      ),
                    }))
                  }
                  size="small"
                  sx={{ flex: 1 }}
                />
              ) : step.type === 'showHtml' || step.type === 'runJs' ? (
                <TextField
                  label={step.type === 'showHtml' ? 'HTML' : 'JavaScript'}
                  value={
                    step.type === 'showHtml'
                      ? ((step as any).html ?? '')
                      : ((step as any).code ?? '')
                  }
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      steps: previous.steps.map((s, index2) =>
                        index2 === index
                          ? step.type === 'showHtml'
                            ? { ...s, html: event.target.value }
                            : { ...s, code: event.target.value }
                          : s,
                      ),
                    }))
                  }
                  size="small"
                  multiline
                  maxRows={4}
                  sx={{ flex: 1 }}
                />
              ) : step.type === 'redirect' ? (
                <TextField
                  label="Destination URL"
                  value={(step as any).url ?? ''}
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      steps: previous.steps.map((s, index2) =>
                        index2 === index
                          ? { ...s, url: event.target.value }
                          : s,
                      ),
                    }))
                  }
                  size="small"
                  sx={{ flex: 1 }}
                />
              ) : step.type === 'trackGaEvent' ? (
                <TextField
                  label="Analytics event name"
                  value={(step as any).eventName ?? ''}
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
              ) : step.type === 'sendEmail' ? (
                <>
                  <TextField
                    label="Subject"
                    value={(step as any).subject ?? ''}
                    onChange={(event) =>
                      patch((previous) => ({
                        ...previous,
                        steps: previous.steps.map((s, index2) =>
                          index2 === index
                            ? { ...s, subject: event.target.value }
                            : s,
                        ),
                      }))
                    }
                    size="small"
                    sx={{ width: 180 }}
                  />
                  <TextField
                    label="Body"
                    value={(step as any).body ?? ''}
                    onChange={(event) =>
                      patch((previous) => ({
                        ...previous,
                        steps: previous.steps.map((s, index2) =>
                          index2 === index
                            ? { ...s, body: event.target.value }
                            : s,
                        ),
                      }))
                    }
                    size="small"
                    multiline
                    maxRows={3}
                    sx={{ flex: 1 }}
                  />
                </>
              ) : step.type === 'notifyAdmins' ? (
                <TextField
                  label="Notification title"
                  value={(step as any).title ?? ''}
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      steps: previous.steps.map((s, index2) =>
                        index2 === index
                          ? { ...s, title: event.target.value }
                          : s,
                      ),
                    }))
                  }
                  size="small"
                  sx={{ flex: 1 }}
                />
              ) : step.type === 'enrollList' ? (
                <TextField
                  select
                  label="List"
                  value={(step as any).listId ?? ''}
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      steps: previous.steps.map((s, index2) =>
                        index2 === index
                          ? {
                              ...s,
                              listId: event.target.value,
                              listName:
                                listOptions.find(
                                  (option) =>
                                    option.id === event.target.value,
                                )?.name ?? '',
                            }
                          : s,
                      ),
                    }))
                  }
                  size="small"
                  sx={{ flex: 1 }}
                >
                  {listOptions.length === 0 ? (
                    <MenuItem value="" disabled>
                      {'No lists yet — create one under Campaigns'}
                    </MenuItem>
                  ) : null}
                  {listOptions.map((option) => (
                    <MenuItem key={option.id} value={option.id}>
                      {option.name}
                    </MenuItem>
                  ))}
                </TextField>
              ) : step.type === 'assignCampaign' ? (
                <TextField
                  select
                  label="Campaign"
                  value={(step as any).campaignId ?? ''}
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      steps: previous.steps.map((s, index2) =>
                        index2 === index
                          ? {
                              ...s,
                              campaignId: event.target.value,
                              campaignName:
                                campaignOptions.find(
                                  (option) =>
                                    option.id === event.target.value,
                                )?.name ?? '',
                            }
                          : s,
                      ),
                    }))
                  }
                  size="small"
                  sx={{ flex: 1 }}
                >
                  {campaignOptions.length === 0 ? (
                    <MenuItem value="" disabled>
                      {'No campaigns yet'}
                    </MenuItem>
                  ) : null}
                  {campaignOptions.map((option) => (
                    <MenuItem key={option.id} value={option.id}>
                      {option.name}
                    </MenuItem>
                  ))}
                </TextField>
              ) : null}
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
HostActionsCard.displayName = 'HostActionsCard'

export default HostActionsCard
