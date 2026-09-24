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
  type HostActionStep,
  type HostActionStepType,
  hostEventLabel,
  hostEventPayloadHint,
  type TriggerCombinator,
} from '@aglyn/aglyn'
import {
  hostIdsFromScope,
  hostScopeToken,
  isOrgWideScope,
  MAX_SCOPE_HOSTS,
  ORG_SCOPE_TOKEN,
} from '@aglyn/aglyn/app-utils/scope-tokens'
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useMemo } from 'react'
import {
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
  /** `org` runs on every site; `sites` on the ones in `siteIds`. */
  placement: 'org' | 'sites'
  siteIds: string[]
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
    placement: 'org',
    siteIds: [],
  }
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
    placement: isOrgWideScope(row.visibleTo) ? 'org' : 'sites',
    siteIds: hostIdsFromScope(row.visibleTo),
  }
}

/** The placement a draft stores, as scope tokens. */
export function draftPlacement(draft: OrgAutomationDraft): string[] {
  return draft.placement === 'org'
    ? [ORG_SCOPE_TOKEN]
    : draft.siteIds.map(hostScopeToken)
}

/** The body `automations/manage` reads, from a draft. */
export function orgAutomationBody(
  draft: OrgAutomationDraft,
): Record<string, unknown> {
  return {
    name: draft.name.trim(),
    trigger: {
      event: draft.event,
      ...(draft.filter.trim() ? { filter: draft.filter.trim() } : {}),
      ...conditionsFromRows(draft.conditionRows, draft.conditionCombinator),
    },
    steps: draft.steps,
    enabled: draft.enabled,
    visibleTo: draftPlacement(draft),
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
  const placement = useMemo(
    () => (draft ? draftPlacement(draft) : [ORG_SCOPE_TOKEN]),
    [draft],
  )
  const { pickers, truncated } = useOrgAutomationStepPickers(
    mount.orgId,
    opened,
    placement,
  )
  const sites = useMemo(() => orgSiteOptions(mount), [mount])
  const tooManySites = (draft?.siteIds.length ?? 0) > MAX_SCOPE_HOSTS
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
            placeholder={'source == "form"'}
            helperText={hostEventPayloadHint(draft?.event) ?? undefined}
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
        <Typography variant="overline" color="text.secondary">
          {'Runs on'}
        </Typography>
        <RadioGroup
          row
          value={draft?.placement ?? 'org'}
          onChange={(event) =>
            onDraft((previous) => ({
              ...previous,
              placement: event.target.value === 'sites' ? 'sites' : 'org',
            }))
          }
        >
          <FormControlLabel
            value="org"
            control={<Radio size="small" />}
            label="Every site"
          />
          <FormControlLabel
            value="sites"
            control={<Radio size="small" />}
            label="Chosen sites"
          />
        </RadioGroup>
        {draft?.placement === 'sites' ? (
          <FormGroup aria-label="Sites it runs on">
            {!mount.hostsReady ? (
              <Typography variant="caption" color="text.secondary">
                {'…'}
              </Typography>
            ) : !sites.length ? (
              <Typography variant="body2" color="text.secondary">
                {'This organization has no sites yet.'}
              </Typography>
            ) : (
              sites.map((site) => (
                <FormControlLabel
                  key={site.value}
                  control={
                    <Checkbox
                      size="small"
                      checked={draft.siteIds.includes(site.value)}
                      onChange={(event) =>
                        onDraft((previous) => ({
                          ...previous,
                          siteIds: event.target.checked
                            ? [...previous.siteIds, site.value]
                            : previous.siteIds.filter((id) => id !== site.value),
                        }))
                      }
                    />
                  }
                  label={site.label}
                />
              ))
            )}
            {tooManySites ? (
              <Typography variant="caption" color="error">
                {`Choose ${MAX_SCOPE_HOSTS} sites or fewer, or run it on every site.`}
              </Typography>
            ) : null}
          </FormGroup>
        ) : null}
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
