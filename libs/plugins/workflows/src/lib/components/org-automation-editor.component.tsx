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
  hostEventLabel,
  hostEventPayloadHint,
  type TriggerCombinator,
  triggerFilterProblem,
} from '@aglyn/aglyn'
import {
  hostScopeToken,
  ORG_SCOPE_TOKEN,
  scopeSharingOf,
  sharingFromChoice,
} from '@aglyn/aglyn/app-utils/scope-tokens'
import {
  SiteSharingField,
  type SiteSharingValue,
} from '@aglyn/shared-ui-jsx/components/site-sharing-field.component'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useMemo } from 'react'
import {
  isOrgAutomationStepType,
  isOrgAutomationTriggerEvent,
  ORG_AUTOMATION_STEP_KINDS,
  ORG_AUTOMATION_TRIGGER_EVENTS,
  type OrgAutomationRow,
  type OrgAutomationTriggerEvent,
} from '../model/org-automations'
import {
  AutomationStepFields,
  defaultStep,
} from './automation-step-fields.component'
import {
  conditionRowsFromTrigger,
  conditionsFromRows,
  type ConditionRowDraft,
  EMPTY_CONDITION_ROW,
  TriggerConditionRows,
} from './automation-trigger-conditions.component'
import { EDITOR_OPTION_CEILING } from './use-automation-step-pickers'
import { useOrgAutomationStepPickers } from './use-org-automation-step-pickers'
import { orgSiteOptions, type WorkflowsOrgMount } from './workflows-org-mount'
import {
  type HostActionStep,
  type HostActionStepType,
  type HostActionTriggerCondition,
  stepRunsAfterWait,
} from '../model/host-actions'
import type { OrgAutomationProposal } from './workflow-zones'

/** An org automation as the editor holds it. */
export interface OrgAutomationDraft {
  /** The stored document's id, or null for a new one. */
  id: string | null
  name: string
  event: OrgAutomationTriggerEvent
  filter: string
  conditionRows: ConditionRowDraft[]
  conditionCombinator: TriggerCombinator
  steps: HostActionStep[]
  enabled: boolean
  /**
   * Where it runs: every site, the sites chosen, or every site except the
   * ones left out (AGL-4047), as the sharing field edits it.
   */
  sharing: SiteSharingValue
}

/** A blank draft: every site, one email step, switched on. */
export function newOrgAutomationDraft(): OrgAutomationDraft {
  return {
    id: null,
    name: '',
    event: 'formSubmission',
    filter: '',
    conditionRows: [EMPTY_CONDITION_ROW],
    conditionCombinator: 'and',
    steps: [defaultStep('sendEmail')],
    enabled: true,
    sharing: { mode: 'all' },
  }
}

/** Where a stored automation runs, as the sharing field edits it. */
function sharingOfRow(row: OrgAutomationRow): SiteSharingValue {
  const sharing = scopeSharingOf(row as unknown as Record<string, unknown>)
  if (sharing.mode === 'all') return { mode: 'all' }
  if (sharing.mode === 'allExcept') return { mode: 'allExcept', exceptHostIds: sharing.exceptHostIds }
  return { mode: 'selected', hostIds: sharing.mode === 'selected' ? sharing.hostIds : [] }
}

/** A stored org automation as the editor opens it. */
export function orgAutomationDraft(row: OrgAutomationRow): OrgAutomationDraft {
  const event = isOrgAutomationTriggerEvent(row.trigger?.event)
    ? row.trigger.event
    : 'formSubmission'
  return {
    id: row.$id,
    name: row.name ?? '',
    event,
    filter: row.trigger?.filter ?? '',
    conditionRows: conditionRowsFromTrigger(row.trigger),
    conditionCombinator: row.trigger?.combinator === 'or' ? 'or' : 'and',
    steps: [...(row.steps ?? [])],
    enabled: row.enabled !== false,
    sharing: sharingOfRow(row),
  }
}

/**
 * An automation another plugin proposed (AGL-3603) as the editor opens it:
 * NEW, switched off and placed on every site until the person chooses, or
 * `null` when its trigger or a step is not one an org automation may hold.
 * Nothing is stored; the editor's Save is the write, through the route's
 * own reader.
 */
export function orgAutomationDraftFromProposal(
  proposal: OrgAutomationProposal,
): OrgAutomationDraft | null {
  const event = proposal.trigger?.event
  if (!isOrgAutomationTriggerEvent(event)) return null
  const steps = proposal.steps ?? []
  if (!steps.length || !steps.every((step) => isOrgAutomationStepType(step?.type))) {
    return null
  }
  return {
    ...newOrgAutomationDraft(),
    name: String(proposal.name ?? ''),
    event,
    conditionRows: conditionRowsFromTrigger({
      conditions: (proposal.trigger.conditions ?? []).map((condition) => ({
        field: condition.field,
        op: condition.op,
        ...(condition.value !== undefined ? { value: condition.value } : {}),
      })) as HostActionTriggerCondition[],
    }),
    conditionCombinator: proposal.trigger.combinator === 'or' ? 'or' : 'and',
    steps: steps.map((step) => ({ ...step }) as unknown as HostActionStep),
    enabled: false,
  }
}

/**
 * What a draft's placement would store given the workspace's sites, or why it
 * can't be: the answer the manage route gives, from `sharingFromChoice`. The
 * sites a draft leaves out stay known here even where the list lacks them, so
 * they aren't taken for sites that are gone.
 */
export function draftSharing(draft: OrgAutomationDraft, orgHostIds: readonly string[]) {
  const leftOut = draft.sharing.mode === 'allExcept' ? draft.sharing.exceptHostIds : []
  return sharingFromChoice(draft.sharing, [...orgHostIds, ...leftOut])
}

/**
 * The automation as its placement would leave it, for the pickers that offer
 * only what reaches every site it runs on (`sharingCovers`).
 */
export function draftPlacement(
  draft: OrgAutomationDraft,
  orgHostIds: readonly string[],
): Readonly<Record<string, unknown>> {
  const fields = draftSharing(draft, orgHostIds).fields
  return fields ? { ...fields } : { visibleTo: [] }
}

/**
 * The body `automations/manage` reads, from a draft: the choice, which decides
 * (AGL-4047), and beside every site or the chosen ones the `visibleTo` it
 * stores, as the route read it before there was a choice.
 */
export function orgAutomationBody(
  draft: OrgAutomationDraft,
): Record<string, unknown> {
  const { sharing } = draft
  return {
    name: draft.name.trim(),
    trigger: {
      event: draft.event,
      ...(draft.filter.trim() ? { filter: draft.filter.trim() } : {}),
      ...conditionsFromRows(draft.conditionRows, draft.conditionCombinator),
    },
    steps: draft.steps,
    enabled: draft.enabled,
    ...(sharing.mode === 'all'
      ? { visibleTo: [ORG_SCOPE_TOKEN] }
      : sharing.mode === 'selected'
        ? { visibleTo: sharing.hostIds.map(hostScopeToken) }
        : {}),
    sharing:
      sharing.mode === 'all'
        ? { mode: 'all' }
        : sharing.mode === 'selected'
          ? { mode: 'selected', hostIds: [...sharing.hostIds] }
          : { mode: 'allExcept', exceptHostIds: [...sharing.exceptHostIds] },
  }
}

export interface OrgAutomationEditorProps {
  mount: WorkflowsOrgMount
  /** The draft being edited, or null when the dialog is closed. */
  draft: OrgAutomationDraft | null
  onDraft: (update: (previous: OrgAutomationDraft) => OrgAutomationDraft) => void
  /** The editor has been opened at least once: the latch the pickers read on. */
  opened: boolean
  saving: boolean
  onSave: () => void
  onClose: () => void
}

/**
 * The org automation editor (AGL-3302): a name, a trigger an org automation
 * can start on, the conditions, the steps from the org vocabulary, and the
 * sites it runs on.
 *
 * The same step rows and condition rows the actions builder uses, offered
 * only what an org automation may hold. Nothing is written from here: Save
 * hands the draft to `automations/manage`, which checks it again.
 */
export function OrgAutomationEditor(props: OrgAutomationEditorProps) {
  const { mount, draft, onDraft, opened, saving, onSave, onClose } = props
  const orgHostIds = useMemo(() => mount.hosts.map((host) => host.id), [mount.hosts])
  const placement = useMemo(
    () => (draft ? draftPlacement(draft, orgHostIds) : { visibleTo: [ORG_SCOPE_TOKEN] }),
    [draft, orgHostIds],
  )
  const { pickers, truncated } = useOrgAutomationStepPickers(
    mount.orgId,
    opened,
    placement,
  )
  const sites = useMemo(
    () => orgSiteOptions(mount).map((site) => ({ id: site.value, name: site.label })),
    [mount],
  )
  // Nothing to say about leaving sites out until the sites have been read.
  const sharingProblem =
    draft && (draft.sharing.mode !== 'allExcept' || mount.hostsReady)
      ? draftSharing(draft, orgHostIds).problem
      : null
  return (
    <Dialog open={Boolean(draft)} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {draft?.id ? 'Edit org automation' : 'Add org automation'}
      </DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}
      >
        <Typography variant="body2" color="text.secondary">
          {'Runs on every site you place it on, as that site: its email goes ' +
            'from that site, its runs count on that site’s action runs, and ' +
            'the site can pause it for itself.'}
        </Typography>
        {truncated.length > 0 ? (
          <Alert severity="info">
            {`Offering the first ${EDITOR_OPTION_CEILING} rows, ordered by id, ` +
              `for: ${truncated.join(', ')}. The organization has more, so a ` +
              'step target may not be listed below.'}
          </Alert>
        ) : null}
        <TextField
          label="Name"
          value={draft?.name ?? ''}
          onChange={(event) =>
            onDraft((previous) => ({ ...previous, name: event.target.value }))
          }
          size="small"
          autoFocus
          sx={{ mt: 1 }}
        />
        <Stack direction="row" spacing={1}>
          <TextField
            select
            label="Trigger event"
            value={draft?.event ?? 'formSubmission'}
            onChange={(event) =>
              onDraft((previous) => ({
                ...previous,
                event: event.target.value as OrgAutomationTriggerEvent,
              }))
            }
            size="small"
            sx={{ minWidth: 200 }}
          >
            {ORG_AUTOMATION_TRIGGER_EVENTS.map((eventType) => (
              <MenuItem key={eventType} value={eventType}>
                {hostEventLabel(eventType)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Filter (optional)"
            placeholder="subscribe"
            // A comparison belongs in the conditions below (AGL-3458): the
            // filter's evaluator is arithmetic, and `source == "form"` throws
            // on every event, so it is refused here.
            error={Boolean(triggerFilterProblem(draft?.filter))}
            helperText={
              triggerFilterProblem(draft?.filter) ?? hostEventPayloadHint(draft?.event) ?? undefined
            }
            value={draft?.filter ?? ''}
            onChange={(event) =>
              onDraft((previous) => ({ ...previous, filter: event.target.value }))
            }
            size="small"
            sx={{ flex: 1 }}
          />
        </Stack>
        <TriggerConditionRows
          rows={draft?.conditionRows ?? []}
          combinator={draft?.conditionCombinator ?? 'and'}
          onRowsChange={(update) =>
            onDraft((previous) => ({
              ...previous,
              conditionRows: update(previous.conditionRows),
            }))
          }
          onCombinatorChange={(combinator) =>
            onDraft((previous) => ({
              ...previous,
              conditionCombinator: combinator,
            }))
          }
        />
        <SiteSharingField
          label="Runs on"
          value={draft?.sharing ?? { mode: 'all' }}
          onChange={(next) => onDraft((previous) => ({ ...previous, sharing: next }))}
          sites={sites}
          sitesReady={mount.hostsReady}
          problem={sharingProblem}
        />
        <Typography variant="overline" color="text.secondary">
          {'Steps (run in order)'}
        </Typography>
        {(draft?.steps ?? []).map((step, index) => (
          <AutomationStepFields
            key={index}
            step={step}
            index={index}
            kind={step.type}
            kinds={ORG_AUTOMATION_STEP_KINDS}
            stepForKind={(value) => defaultStep(value as HostActionStepType)}
            pickers={pickers}
            onSteps={(update) =>
              onDraft((previous) => ({
                ...previous,
                steps: update(previous.steps),
              }))
            }
            replyContext={{
              event: draft?.event,
              afterWait: stepRunsAfterWait(draft?.steps, index),
            }}
          />
        ))}
        <Button
          size="small"
          sx={{ alignSelf: 'flex-start' }}
          disabled={(draft?.steps.length ?? 0) >= ACTION_MAX_STEPS}
          onClick={() =>
            onDraft((previous) => ({
              ...previous,
              steps: [...previous.steps, defaultStep('sendEmail')],
            }))
          }
        >
          {'Add step'}
        </Button>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={draft?.enabled !== false}
              onChange={(event) =>
                onDraft((previous) => ({
                  ...previous,
                  enabled: event.target.checked,
                }))
              }
            />
          }
          label="Switched on"
        />
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose}>
          {'Cancel'}
        </Button>
        <Button
          variant="contained"
          color="primary"
          disabled={!draft?.name.trim() || saving}
          onClick={onSave}
        >
          {saving ? 'Saving…' : 'Save org automation'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
OrgAutomationEditor.displayName = 'OrgAutomationEditor'
