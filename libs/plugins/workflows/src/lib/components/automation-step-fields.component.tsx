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

/**
 * ONE STEP EDITOR FOR BOTH AUTOMATION BUILDERS (AGL-3105).
 *
 * A step's fields belong to the step, not to the card the step is edited on.
 * The Actions builder and the Workflows builder both hold an ordered list of
 * steps, and a workflow step may be any server-side Actions step, so the
 * fields it takes — which dataset, which campaign, how long to wait, what to
 * say — are asked here and in one place. A second copy would be two editors
 * of one vocabulary, drifting a field at a time.
 *
 * What the card keeps is the list: what "Add step" builds, how many are
 * allowed, and what a kind the Actions vocabulary does not hold looks like —
 * a workflow's function call, handed in as `fields`.
 */

import {
  CONTACT_LIFECYCLE_STAGE_LABELS,
  CONTACT_LIFECYCLE_STAGES,
  CONTACT_TAG_MAX_LENGTH,
  type ContactLifecycleStage,
  CRM_ACTIVITY_KIND_LABELS,
  CRM_ACTIVITY_KINDS,
  CRM_TASK_KIND_LABELS,
  CRM_TASK_KINDS,
  CRM_TASK_MAX_DUE_DAYS,
  type CrmActivityKind,
  type CrmTaskKind,
  HOST_EVENT_TYPES,
  type HostActionStep,
  type HostActionStepType,
  hostEventLabel,
  isInteractionAttributeAllowed,
  type TriggerConditionOp,
} from '@aglyn/aglyn'
import { automationPlaceholderIn } from '@aglyn/aglyn/app-utils/automation-placeholders'
import {
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'

/**
 * The durations a wait may be set to, from the picker.
 *
 * A select rather than a number field, because minutes are the wrong unit for
 * the thing being chosen: a welcome series is authored in days and nobody
 * wants to compute that three days is 4,320. Every value is inside the
 * validated band, so the picker cannot produce a step the validator refuses —
 * which is the property a free-text duration field would not have.
 */
const FLOW_WAIT_PRESETS: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 5, label: '5 minutes' },
  { minutes: 30, label: '30 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 60 * 4, label: '4 hours' },
  { minutes: 60 * 24, label: '1 day' },
  { minutes: 60 * 24 * 2, label: '2 days' },
  { minutes: 60 * 24 * 3, label: '3 days' },
  { minutes: 60 * 24 * 7, label: '1 week' },
  { minutes: 60 * 24 * 14, label: '2 weeks' },
  { minutes: 60 * 24 * 30, label: '30 days' },
  { minutes: 60 * 24 * 60, label: '60 days' },
  { minutes: 60 * 24 * 90, label: '90 days' },
]

/**
 * The two stored fields a typed teammate reference becomes.
 *
 * `ownerEmail`/`assigneeEmail` hold an address and nothing else — the
 * validator refuses one without an `@`, and the executor matches it on the
 * roster's `email`. A value with no `@` is a member id, stored in the uid
 * field the executor verifies against the roster document. Clearing the
 * text clears both, so a step never carries a stale address beside a uid.
 */
function memberRefFields(
  role: 'owner' | 'assignee',
  value: string,
): Record<string, string | undefined> {
  const text = value.trim()
  const emailKey = `${role}Email`
  const uidKey = `${role}Uid`
  if (!text) return { [emailKey]: undefined, [uidKey]: undefined }
  return text.includes('@')
    ? { [emailKey]: value, [uidKey]: undefined }
    : { [emailKey]: undefined, [uidKey]: text }
}

/**
 * What a field holding a placeholder shows: an error state and what to do
 * about it. A placeholder is a value a person still has to supply, written in
 * square brackets where it belongs — an automation drafted for review carries
 * one wherever it could not name a real record or did not know a fact.
 */
export function placeholderState(
  value: unknown,
  help: string,
): { error?: boolean; helperText?: string } {
  return automationPlaceholderIn(value) ? { error: true, helperText: help } : {}
}

/**
 * A picker whose stored reference is a placeholder name and no id: the record
 * the draft asked for, which the site did not have when it was written.
 */
function placeholderReference(
  name: unknown,
  id: unknown,
  noun: string,
): { error?: boolean; helperText?: string } {
  const words = String(id ?? '').trim() ? null : automationPlaceholderIn(name)
  return words
    ? {
        error: true,
        helperText: `Pick the ${noun} — the draft asked for “${words}”`,
      }
    : {}
}

export function defaultStep(type: HostActionStepType): HostActionStep {
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
    case 'toggleClass':
      return { type, selector: '', className: '' }
    // Element show/hide + drawer commands (AGL-562).
    case 'showElement':
    case 'hideElement':
    case 'toggleElement':
      return { type, selector: '' }
    // Every step the menu offers needs a case here: the `default` below is a
    // dataset write, so a step without one turns into that (AGL-2876).
    case 'setAttribute':
      return { type, selector: '', name: '', value: '' }
    case 'removeAttribute':
      return { type, selector: '', name: '' }
    // One-target steps (AGL-2867); absent options are the defaults.
    case 'scrollTo':
    case 'playVideo':
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
    // The CRM steps (AGL-2605). A stage and a kind start on a real entry of
    // their vocabulary rather than blank, so the select never shows a value
    // the validator would refuse; the free-text fields start empty because
    // there is nothing sensible to guess for them.
    case 'setContactStage':
      return { type, lifecycleStage: 'lead' }
    case 'addContactTag':
      return { type, tag: '' }
    case 'assignContactOwner':
      return { type, ownerEmail: '' }
    case 'createCrmTask':
      return { type, title: '', kind: 'call', dueInDays: 1 }
    case 'logCrmActivity':
      return { type, kind: 'note', body: '' }
    // A day, because a new wait is almost always part of a series measured in
    // days and a default of one minute reads as a placeholder rather than a
    // choice. Both are inside the validated band, so neither can be saved
    // wrong; this is only which one the author starts from.
    case 'wait':
      return { type, delayMinutes: 60 * 24 }
    case 'waitForEvent':
      return { type, eventName: '', timeoutMinutes: 60 * 24 * 3 }
    case 'exitFlow':
      return { type }
    default:
      return { type: 'datasetAppend', datasetName: '' }
  }
}

/** A record a step's picker chooses from: what is stored, and what is read. */
export interface AutomationStepPickerOption {
  id: string
  name: string
}

/** Everything on the site a step can be pointed at. */
export interface AutomationStepPickers {
  workflowOptions: readonly AutomationStepPickerOption[]
  datasetOptions: readonly AutomationStepPickerOption[]
  overlayOptions: readonly AutomationStepPickerOption[]
  listOptions: readonly AutomationStepPickerOption[]
  campaignOptions: readonly AutomationStepPickerOption[]
  webhookOptions: readonly AutomationStepPickerOption[]
}

/** One entry of the "Do" picker: what is stored, and what the author reads. */
export interface AutomationStepKind {
  value: string
  label: string
}

export interface AutomationStepFieldsProps {
  /** The step being edited, as it is stored. */
  step: HostActionStep
  /** Its place in the list: the number beside it, and what an edit replaces. */
  index: number
  /** What the "Do" picker shows for this step. */
  kind: string
  /** What the "Do" picker offers, in the order it offers it. */
  kinds: readonly AutomationStepKind[]
  /** The step a kind the author just picked becomes. */
  stepForKind: (kind: string) => HostActionStep
  /** The records this site offers the step's pickers. */
  pickers: AutomationStepPickers
  /** Replaces the list this step belongs to. */
  onSteps: (update: (previous: HostActionStep[]) => HostActionStep[]) => void
  /**
   * The fields for a kind the Actions vocabulary does not hold — a workflow's
   * function call. Given, they replace the Actions fields, and the step takes
   * no `Only if` row: the engine evaluates a step condition on an Actions
   * step and a function call is not one.
   */
  fields?: ReactNode
}

/**
 * One step's row: its number, what it does, the fields that kind takes, and
 * the condition that gates it.
 */
export function AutomationStepFields({
  step,
  index,
  kind,
  kinds,
  stepForKind,
  pickers,
  onSteps,
  fields,
}: AutomationStepFieldsProps) {
  const {
    workflowOptions,
    datasetOptions,
    overlayOptions,
    listOptions,
    campaignOptions,
    webhookOptions,
  } = pickers
  /*
   * The list, edited as a draft holding it — the shape both cards' own
   * `patch` takes, so a field below reads the same here as it did beside the
   * card it came from, and an edit that spreads `previous` still spreads only
   * what it may change.
   */
  const patch = (
    update: (previous: { steps: HostActionStep[] }) => {
      steps: HostActionStep[]
    },
  ) => onSteps((previous) => update({ steps: previous }).steps)
  return (
    <Stack spacing={0.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary">
          {`${index + 1}`}
        </Typography>
        <TextField
          select
          label="Do"
          value={kind}
          onChange={(event) =>
            patch((previous) => ({
              ...previous,
              steps: previous.steps.map((s, index2) =>
                index2 === index ? stepForKind(event.target.value) : s,
              ),
            }))
          }
          size="small"
          sx={{ minWidth: 170 }}
        >
          {kinds.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>
        {fields ??
          (step.type === 'runWorkflow' ? (
            <TextField
              select
              label="Workflow"
              {...placeholderReference(
                step.workflowName,
                (step as any).workflowId,
                'workflow',
              )}
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
                              (option) => option.id === event.target.value,
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
                {...placeholderState(step.message, 'Fill in the placeholder')}
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
              {...placeholderReference(
                step.webhookName,
                (step as any).webhookId,
                'webhook',
              )}
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
                              (option) => option.id === event.target.value,
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
          ) : step.type === 'datasetAppend' || step.type === 'updateDataset' ? (
            <TextField
              select
              label="Dataset"
              {...placeholderReference(
                step.datasetName,
                (step as any).datasetId,
                'dataset',
              )}
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
                              (option) => option.id === event.target.value,
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
                              (option) => option.id === event.target.value,
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
          ) : step.type === 'addClass' ||
            step.type === 'removeClass' ||
            step.type === 'toggleClass' ? (
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
            step.type === 'toggleElement' ||
            step.type === 'playVideo' ? (
            // Element choreography (AGL-562) and Play a video
            // (AGL-2867). The besigner's builder offers an element
            // picker; here the CSS selector is the escape hatch (node
            // targets use [data-aglyn="leaf:…"]).
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
          ) : step.type === 'scrollTo' ? (
            // Scroll to element (AGL-2867): the target, how the page
            // moves, and the room left above it for a sticky header.
            <>
              <TextField
                label="CSS selector"
                placeholder='[data-aglyn="leaf:…"] or .my-class'
                value={step.selector ?? ''}
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
                select
                label="Scroll"
                value={step.behavior === 'instant' ? 'instant' : 'smooth'}
                onChange={(event) =>
                  patch((previous) => ({
                    ...previous,
                    steps: previous.steps.map((s, index2) =>
                      index2 === index
                        ? {
                            ...s,
                            behavior:
                              event.target.value === 'instant'
                                ? 'instant'
                                : undefined,
                          }
                        : s,
                    ),
                  }))
                }
                size="small"
                sx={{ width: 130 }}
              >
                <MenuItem value="smooth">{'Smoothly'}</MenuItem>
                <MenuItem value="instant">{'Instantly'}</MenuItem>
              </TextField>
              <TextField
                label="Offset (px)"
                type="number"
                value={step.offsetPx ?? ''}
                onChange={(event) =>
                  patch((previous) => ({
                    ...previous,
                    steps: previous.steps.map((s, index2) =>
                      index2 === index
                        ? {
                            ...s,
                            offsetPx:
                              event.target.value === ''
                                ? undefined
                                : Number(event.target.value),
                          }
                        : s,
                    ),
                  }))
                }
                size="small"
                sx={{ width: 110 }}
              />
            </>
          ) : step.type === 'setAttribute' ||
            step.type === 'removeAttribute' ? (
            // The attribute steps (AGL-2546). The page applies only
            // `aria-*` and `data-*` names, so the field says so while
            // it holds any other, as the interaction builder's does.
            <>
              <TextField
                label="CSS selector"
                placeholder='[data-aglyn="leaf:…"] or .my-class'
                value={step.selector ?? ''}
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
                label="Attribute"
                placeholder="aria-expanded"
                value={step.name ?? ''}
                onChange={(event) =>
                  patch((previous) => ({
                    ...previous,
                    steps: previous.steps.map((s, index2) =>
                      index2 === index ? { ...s, name: event.target.value } : s,
                    ),
                  }))
                }
                error={
                  Boolean(step.name) &&
                  !isInteractionAttributeAllowed(step.name)
                }
                helperText={
                  Boolean(step.name) &&
                  !isInteractionAttributeAllowed(step.name)
                    ? 'Must start with aria- or data-'
                    : undefined
                }
                size="small"
                sx={{ width: 150 }}
              />
              {step.type === 'setAttribute' ? (
                <TextField
                  label="Value"
                  placeholder="true"
                  value={step.value ?? ''}
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      steps: previous.steps.map((s, index2) =>
                        index2 === index
                          ? { ...s, value: event.target.value }
                          : s,
                      ),
                    }))
                  }
                  size="small"
                  sx={{ width: 110 }}
                />
              ) : null}
            </>
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
                          drawerNodeId: event.target.value || undefined,
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
                          menuNodeId: event.target.value || undefined,
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
                    index2 === index ? { ...s, url: event.target.value } : s,
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
                {...placeholderState(
                  (step as any).subject,
                  'Fill in the placeholder',
                )}
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
                {...placeholderState(
                  (step as any).body,
                  'Fill in the placeholders',
                )}
                value={(step as any).body ?? ''}
                onChange={(event) =>
                  patch((previous) => ({
                    ...previous,
                    steps: previous.steps.map((s, index2) =>
                      index2 === index ? { ...s, body: event.target.value } : s,
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
              {...placeholderState(
                (step as any).title,
                'Fill in the placeholder',
              )}
              value={(step as any).title ?? ''}
              onChange={(event) =>
                patch((previous) => ({
                  ...previous,
                  steps: previous.steps.map((s, index2) =>
                    index2 === index ? { ...s, title: event.target.value } : s,
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
              {...placeholderReference(
                (step as any).listName,
                (step as any).listId,
                'list',
              )}
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
                              (option) => option.id === event.target.value,
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
              {...placeholderReference(
                (step as any).campaignName,
                (step as any).campaignId,
                'campaign',
              )}
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
                              (option) => option.id === event.target.value,
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
          ) : step.type === 'setContactStage' ? (
            // The CRM steps (AGL-2605). Each acts on the contact the
            // event names — by id when the door knew it, by the email
            // in the payload otherwise — so none of them asks who.
            <TextField
              select
              label="Stage"
              value={(step as any).lifecycleStage ?? ''}
              onChange={(event) =>
                patch((previous) => ({
                  ...previous,
                  steps: previous.steps.map((s, index2) =>
                    index2 === index && s.type === 'setContactStage'
                      ? {
                          ...s,
                          lifecycleStage: event.target
                            .value as ContactLifecycleStage,
                        }
                      : s,
                  ),
                }))
              }
              size="small"
              sx={{ minWidth: 200 }}
            >
              {CONTACT_LIFECYCLE_STAGES.map((stage) => (
                <MenuItem key={stage} value={stage}>
                  {CONTACT_LIFECYCLE_STAGE_LABELS[stage]}
                </MenuItem>
              ))}
            </TextField>
          ) : step.type === 'addContactTag' ? (
            <TextField
              label="Tag"
              {...placeholderState(
                (step as any).tag,
                'Fill in the placeholder',
              )}
              value={(step as any).tag ?? ''}
              onChange={(event) =>
                patch((previous) => ({
                  ...previous,
                  steps: previous.steps.map((s, index2) =>
                    index2 === index
                      ? {
                          ...s,
                          tag: event.target.value.slice(
                            0,
                            CONTACT_TAG_MAX_LENGTH,
                          ),
                        }
                      : s,
                  ),
                }))
              }
              size="small"
              sx={{ flex: 1 }}
            />
          ) : step.type === 'assignContactOwner' ? (
            // Two modes (AGL-2618): a member the author names, or the
            // next member of the round-robin pool the CRM's Settings
            // keep. Switching to the rotation drops the named member,
            // because the validator refuses a step that says both.
            <>
              <TextField
                select
                label="Assign to"
                value={
                  (step as any).roundRobin === true ? 'roundRobin' : 'member'
                }
                onChange={(event) =>
                  patch((previous) => ({
                    ...previous,
                    steps: previous.steps.map((s, index2) =>
                      index2 === index && s.type === 'assignContactOwner'
                        ? event.target.value === 'roundRobin'
                          ? { type: s.type, roundRobin: true }
                          : { type: s.type, ownerEmail: '' }
                        : s,
                    ),
                  }))
                }
                size="small"
                sx={{ minWidth: 200 }}
              >
                <MenuItem value="member">{'A team member'}</MenuItem>
                <MenuItem value="roundRobin">
                  {'Round robin — the next member of the CRM’s pool'}
                </MenuItem>
              </TextField>
              {(step as any).roundRobin === true ? (
                <Typography variant="caption" color="text.secondary">
                  {
                    'The pool is set under CRM → Settings; an empty pool is a failed step.'
                  }
                </Typography>
              ) : (
                <>
                  {/*
                          One field for either way of naming a teammate. An
                          address is stored as `ownerEmail` and matched on the
                          roster when the automation runs; anything else is
                          stored as `ownerUid`, which is how a member whose
                          account carries no address — an SSO re-grant — is
                          named at all. The split happens here so the stored
                          step keeps the two fields the validator and the
                          executor already read.
                         */}
                  <TextField
                    label="Owner (email address or member id)"
                    value={
                      (step as any).ownerEmail || (step as any).ownerUid || ''
                    }
                    onChange={(event) =>
                      patch((previous) => ({
                        ...previous,
                        steps: previous.steps.map((s, index2) =>
                          index2 === index
                            ? {
                                ...s,
                                ...memberRefFields('owner', event.target.value),
                              }
                            : s,
                        ),
                      }))
                    }
                    size="small"
                    sx={{ flex: 1 }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {
                      'Somebody on your team, matched against the roster when the automation runs.'
                    }
                  </Typography>
                </>
              )}
            </>
          ) : step.type === 'createCrmTask' ? (
            <>
              <TextField
                label="Title"
                {...placeholderState(
                  (step as any).title,
                  'Fill in the placeholder',
                )}
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
              <TextField
                select
                label="Kind"
                value={(step as any).kind ?? ''}
                onChange={(event) =>
                  patch((previous) => ({
                    ...previous,
                    steps: previous.steps.map((s, index2) =>
                      index2 === index && s.type === 'createCrmTask'
                        ? { ...s, kind: event.target.value as CrmTaskKind }
                        : s,
                    ),
                  }))
                }
                size="small"
                sx={{ minWidth: 120 }}
              >
                {CRM_TASK_KINDS.map((kind) => (
                  <MenuItem key={kind} value={kind}>
                    {CRM_TASK_KIND_LABELS[kind]}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                type="number"
                label="Due in (days)"
                value={(step as any).dueInDays ?? ''}
                onChange={(event) =>
                  patch((previous) => ({
                    ...previous,
                    steps: previous.steps.map((s, index2) =>
                      index2 === index
                        ? {
                            ...s,
                            dueInDays: Math.min(
                              CRM_TASK_MAX_DUE_DAYS,
                              Math.max(0, Number(event.target.value)),
                            ),
                          }
                        : s,
                    ),
                  }))
                }
                size="small"
                sx={{ width: 130 }}
              />
              <TextField
                label="Assignee (email address or member id, optional)"
                value={
                  (step as any).assigneeEmail || (step as any).assigneeUid || ''
                }
                onChange={(event) =>
                  patch((previous) => ({
                    ...previous,
                    steps: previous.steps.map((s, index2) =>
                      index2 === index
                        ? {
                            ...s,
                            ...memberRefFields('assignee', event.target.value),
                          }
                        : s,
                    ),
                  }))
                }
                size="small"
                sx={{ flex: 1 }}
                helperText="Blank gives it to the contact’s owner."
              />
            </>
          ) : step.type === 'logCrmActivity' ? (
            <>
              <TextField
                select
                label="Kind"
                value={(step as any).kind ?? ''}
                onChange={(event) =>
                  patch((previous) => ({
                    ...previous,
                    steps: previous.steps.map((s, index2) =>
                      index2 === index && s.type === 'logCrmActivity'
                        ? {
                            ...s,
                            kind: event.target.value as CrmActivityKind,
                          }
                        : s,
                    ),
                  }))
                }
                size="small"
                sx={{ minWidth: 120 }}
              >
                {CRM_ACTIVITY_KINDS.map((kind) => (
                  <MenuItem key={kind} value={kind}>
                    {CRM_ACTIVITY_KIND_LABELS[kind]}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="What happened"
                {...placeholderState(
                  (step as any).body,
                  'Fill in the placeholders',
                )}
                value={(step as any).body ?? ''}
                onChange={(event) =>
                  patch((previous) => ({
                    ...previous,
                    steps: previous.steps.map((s, index2) =>
                      index2 === index ? { ...s, body: event.target.value } : s,
                    ),
                  }))
                }
                size="small"
                multiline
                maxRows={3}
                sx={{ flex: 1 }}
              />
            </>
          ) : step.type === 'wait' || step.type === 'waitForEvent' ? (
            <>
              {step.type === 'waitForEvent' ? (
                <TextField
                  select
                  label="Until"
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
                  sx={{ minWidth: 170 }}
                >
                  {HOST_EVENT_TYPES.map((option) => (
                    <MenuItem key={option} value={option}>
                      {hostEventLabel(option)}
                    </MenuItem>
                  ))}
                </TextField>
              ) : null}
              <TextField
                select
                label={
                  step.type === 'waitForEvent' ? 'Give up after' : 'Wait for'
                }
                value={String(
                  step.type === 'waitForEvent'
                    ? ((step as any).timeoutMinutes ?? '')
                    : ((step as any).delayMinutes ?? ''),
                )}
                onChange={(event) =>
                  patch((previous) => ({
                    ...previous,
                    steps: previous.steps.map((s, index2) =>
                      index2 === index
                        ? s.type === 'waitForEvent'
                          ? {
                              ...s,
                              timeoutMinutes: Number(event.target.value),
                            }
                          : {
                              ...s,
                              delayMinutes: Number(event.target.value),
                            }
                        : s,
                    ),
                  }))
                }
                size="small"
                sx={{ minWidth: 150 }}
              >
                {FLOW_WAIT_PRESETS.map((option) => (
                  <MenuItem key={option.minutes} value={option.minutes}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
              <Typography variant="caption" color="text.secondary">
                {step.type === 'waitForEvent'
                  ? 'Continues as soon as this happens, or when the time is up.'
                  : 'The rest of this automation runs later, on its own.'}
              </Typography>
            </>
          ) : step.type === 'exitFlow' ? (
            <Typography variant="caption" color="text.secondary">
              {
                'Nothing after this step runs. Add a condition to make it a branch.'
              }
            </Typography>
          ) : null)}
        <IconButton
          size="small"
          aria-label="remove step"
          onClick={() =>
            patch((previous) => ({
              ...previous,
              steps: previous.steps.filter((_, index2) => index2 !== index),
            }))
          }
        >
          {'×'}
        </IconButton>
      </Stack>
      {/*
       * BRANCHING, as a second row under the step it belongs to.
       *
       * One clause rather than the trigger's chain of five. The
       * trigger decides whether a run happens at all and earns a
       * condition builder; a step's guard answers "does THIS one run",
       * which in every sequence anybody writes is a single fact — did
       * they order, did they open, is the field still empty. A second
       * five-row builder per step would make a ten-step flow a page of
       * condition editors, and the model already accepts more if the
       * evidence ever says otherwise.
       */}
      {fields ? null : (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', pl: 3 }}>
          <TextField
            select
            label="Only if"
            value={(step.when?.conditions?.[0]?.op as string) ?? ''}
            onChange={(event) =>
              patch((previous) => ({
                ...previous,
                steps: previous.steps.map((s, index2) =>
                  index2 === index
                    ? {
                        ...s,
                        when: event.target.value
                          ? {
                              conditions: [
                                {
                                  op: event.target.value as TriggerConditionOp,
                                  field: s.when?.conditions?.[0]?.field ?? '',
                                  value: s.when?.conditions?.[0]?.value ?? '',
                                },
                              ],
                            }
                          : null,
                      }
                    : s,
                ),
              }))
            }
            size="small"
            sx={{ minWidth: 170 }}
          >
            <MenuItem value="">{'Always run'}</MenuItem>
            <MenuItem value="notEmpty">{'Field is not empty'}</MenuItem>
            <MenuItem value="equals">{'Field equals'}</MenuItem>
            <MenuItem value="contains">{'Field contains'}</MenuItem>
          </TextField>
          {step.when?.conditions?.[0]?.op ? (
            <TextField
              label="Field"
              placeholder="orderId"
              value={step.when.conditions[0].field ?? ''}
              onChange={(event) =>
                patch((previous) => ({
                  ...previous,
                  steps: previous.steps.map((s, index2) =>
                    index2 === index && s.when?.conditions?.[0]
                      ? {
                          ...s,
                          when: {
                            conditions: [
                              {
                                ...s.when.conditions[0],
                                field: event.target.value,
                              },
                            ],
                          },
                        }
                      : s,
                  ),
                }))
              }
              size="small"
              sx={{ flex: 1 }}
            />
          ) : null}
          {step.when?.conditions?.[0]?.op === 'equals' ||
          step.when?.conditions?.[0]?.op === 'contains' ? (
            <TextField
              label="Value"
              {...placeholderState(
                step.when.conditions[0].value,
                'Replace the placeholder with the value to match',
              )}
              value={step.when.conditions[0].value ?? ''}
              onChange={(event) =>
                patch((previous) => ({
                  ...previous,
                  steps: previous.steps.map((s, index2) =>
                    index2 === index && s.when?.conditions?.[0]
                      ? {
                          ...s,
                          when: {
                            conditions: [
                              {
                                ...s.when.conditions[0],
                                value: event.target.value,
                              },
                            ],
                          },
                        }
                      : s,
                  ),
                }))
              }
              size="small"
              sx={{ flex: 1 }}
            />
          ) : null}
        </Stack>
      )}
    </Stack>
  )
}
