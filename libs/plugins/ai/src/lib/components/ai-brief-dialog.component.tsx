'use client'

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

import { lockdownRefusalText, parseLockdownRefusal } from '@aglyn/aglyn'
import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { HelpTip } from '@aglyn/shared-ui-jsx'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiJobSummary } from '../model/ai-jobs.types'
import { AI_PAGE_TYPES, type AiPageType } from '../model/ai-page-job'
import { AI_TEMPLATE_SUBJECTS, type AiTemplateSubject } from '../model/ai-template-subjects'
import {
  AI_BRIEF_COPY,
  AI_BRIEF_MAX_CHARS,
  AI_BRIEF_NO_CHOICE,
  AI_EMAIL_TYPE_LABELS,
  AI_TEMPLATE_SUBJECT_LABELS,
  aiBriefJobInputs,
  aiBriefJobKind,
  type AiBriefChoice,
  type AiBriefKind,
} from '../model/ai-brief-copy'
import { AI_SITE_BUILD_IN_FLIGHT_COPY, aiSiteBuildInFlight } from '../model/ai-job-activity'
import { AiJobFollow } from './ai-job-follow.component'
import { publishAiJob, useAiJobsInFlightKnown } from './ai-jobs-store'
import { AiTemplateCollectionField } from './ai-template-collection-field.component'

/**
 * The brief dialog every "Create with AI" opens (AGL-2907, AGL-3043, AGL-3051):
 * a page from the Screens page and from the Assist panel's AI jobs, a page
 * template from Templates, a layout from Layouts, a form from Forms, a
 * reusable component from Components, and an email design from the Emails
 * page's templates (AGL-3596). The `campaign` kind is the job an email's door
 * starts when the campaign is asked for too; the Campaigns section's own door
 * is a dialog of its own (`ai-campaign-create.component`, AGL-3603).
 *
 * One text box, and whatever the kind's door reads beside it, start one job of
 * that kind: a page's optional page type; a template's subject and, for a
 * collection entry's page, its collection. A layout, a form and a component
 * read nothing but the brief and the site. An email's reads the optional
 * kind of email, and its door also offers to draft the
 * campaign that would send it, which starts a `campaign` job instead — the
 * same design, plus a draft campaign aimed at nobody. The job plans first; once it
 * exists the dialog follows it live (AGL-3593) — planning, the plan with its
 * Confirm, building, then the draft to open — and "Open AI jobs" follows it
 * anywhere else in the console. Nothing here builds or writes anything until
 * the member confirms the plan.
 */

// The words and the request each kind starts are the model's (AGL-3854), so
// the native apps' door reads the same ones; re-exported for this dialog's
// existing readers.
export {
  AI_BRIEF_COPY,
  AI_BRIEF_NO_CHOICE,
  AI_EMAIL_TYPE_LABELS,
  AI_TEMPLATE_SUBJECT_LABELS,
  aiBriefJobInputs,
  aiBriefJobKind,
}
export type { AiBriefChoice, AiBriefCopy, AiBriefKind } from '../model/ai-brief-copy'

/**
 * Each kind's own help beside the dialog's title (AGL-3660): the guide for
 * the thing being described, opened at the section about writing its brief,
 * never one page shared by all seven.
 */
const AI_BRIEF_HELP: Readonly<Record<AiBriefKind, ReturnType<typeof pluginDocsHelp>>> = {
  page: pluginDocsHelp('aiPage', {
    anchor: '#describe-the-page',
    excerpt:
      'Say what the page is for and who it is for. A plan comes first, and the page is built as an unpublished draft once you confirm it.',
  }),
  template: pluginDocsHelp('aiTemplate', {
    anchor: '#generate-a-page-template-with-aglyn-ai',
    excerpt:
      'Describe what each page made from the template should show. What changes per page is filled in from each record.',
  }),
  layout: pluginDocsHelp('aiLayout', {
    anchor: '#generate-a-layout-with-aglyn-ai',
    excerpt:
      'Describe the header, navigation and footer. The layout is built as a draft, and no page uses it until you assign it.',
  }),
  form: pluginDocsHelp('aiForm', {
    anchor: '#describe-the-form',
    excerpt:
      'Say what the form is for. Its fields, marketing consent and where submissions go are planned together, and it collects nothing until you place it.',
  }),
  component: pluginDocsHelp('aiComponent', {
    anchor: '#from-a-brief',
    excerpt:
      'Describe one reusable block. What each page can change, such as a name or a photo, becomes a property of the component.',
  }),
  email: pluginDocsHelp('aiEmail', {
    anchor: '#write-the-brief',
    excerpt:
      'Say what the email is for. It is built from email blocks with three subject lines to choose from, and nothing is sent.',
  }),
  campaign: pluginDocsHelp('aiEmail', {
    anchor: '#where-to-start-it',
    excerpt:
      'Writes the email and a draft campaign that would send it. The campaign is aimed at nobody until you pick its lists and schedule it.',
  }),
}


export interface AiBriefDialogProps {
  /** The job the brief starts. */
  kind: AiBriefKind
  open: boolean
  onClose: () => void
  orgId: string | undefined
  hostId: string
  /** Who is signed in, whose token the request carries. */
  user: Parameters<typeof authorizedFetch>[0]
  /** Path slug for the link to the draft; read from the address when omitted. */
  orgSlug?: string | null
  /** The viewer is staff (AGL-3078), for a refused plan's details. */
  isStaff?: boolean
}

export function AiBriefDialog({
  kind,
  open,
  onClose,
  orgId,
  hostId,
  user,
  orgSlug,
  isStaff,
}: AiBriefDialogProps) {
  // Held in a ref so the request reads WHO is signed in, and nothing keys on
  // the identity of the object that says so.
  const userRef = useRef(user)
  userRef.current = user
  const [brief, setBrief] = useState('')
  const [choice, setChoice] = useState<AiBriefChoice>(AI_BRIEF_NO_CHOICE)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  /** The job the brief started, as the create door answered with it. */
  const [started, setStarted] = useState<AiJobSummary | null>(null)
  // An email that asked for its campaign is said as the campaign it starts,
  // and a started job as the kind it is (the choice is cleared once it starts).
  const shownKind =
    started && (started.kind === 'email' || started.kind === 'campaign')
      ? started.kind
      : aiBriefJobKind(kind, choice)
  const copy = AI_BRIEF_COPY[shownKind]
  // Another page already being built on this site (AGL-3765), from the list
  // the top-bar indicator already holds, read again by nothing here: two at
  // once each plan against the site as it was, and race for what its plan
  // holds one of. A warning, not a stop.
  const asking = open && kind === 'page' && !started
  const inFlight = useAiJobsInFlightKnown(user, orgId, asking)
  const building = asking ? aiSiteBuildInFlight(inFlight, { hostId }) : null

  useEffect(() => {
    if (!open) return
    setNotice(null)
    setStarted(null)
  }, [open])

  const pick = useCallback(
    (patch: Partial<AiBriefChoice>) => setChoice((current) => ({ ...current, ...patch })),
    [],
  )
  const ready = aiBriefJobInputs(kind, choice) !== null

  const start = useCallback(async () => {
    const inputs = aiBriefJobInputs(kind, choice)
    const jobKind = aiBriefJobKind(kind, choice)
    if (!orgId || !brief.trim() || !inputs) return
    setBusy(true)
    setNotice(null)
    try {
      const response = await authorizedFetch(userRef.current, '/api/ai/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, hostId, kind: jobKind, brief: brief.trim(), inputs }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const locked = parseLockdownRefusal(response.status, payload)
        setNotice(locked ? lockdownRefusalText(locked) : String(payload?.error ?? copy.failed))
        return
      }
      const created = (payload?.job as AiJobSummary | undefined) ?? null
      if (!created) {
        setNotice(copy.failed)
        return
      }
      // The indicator and the launcher count it from the moment it exists.
      publishAiJob(created)
      setStarted(created)
      setBrief('')
      setChoice(AI_BRIEF_NO_CHOICE)
    } catch {
      setNotice(copy.failed)
    } finally {
      setBusy(false)
    }
  }, [orgId, hostId, kind, brief, choice, copy])

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {copy.title}
        <HelpTip {...AI_BRIEF_HELP[shownKind]} />
      </DialogTitle>
      <DialogContent>
        {started && orgId ? (
          <AiJobFollow
            job={started}
            orgId={orgId}
            orgSlug={orgSlug}
            user={user}
            intro={copy.started}
            staff={isStaff}
            // The dialog covers the panel AI jobs opens in.
            onOpenJobs={onClose}
          />
        ) : (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label={copy.briefLabel}
              placeholder={copy.placeholder}
              multiline
              minRows={4}
              value={brief}
              onChange={(event) => setBrief(event.target.value.slice(0, AI_BRIEF_MAX_CHARS))}
              helperText={`${brief.length.toLocaleString('en-US')} / ${AI_BRIEF_MAX_CHARS.toLocaleString('en-US')}`}
              disabled={busy}
              autoFocus
            />
            {kind === 'page' ? (
              <ChipGroup
                id="ai-page-type-label"
                label="Page type (optional)"
                options={AI_PAGE_TYPES.map((type) => ({ id: type.id, label: type.label }))}
                value={choice.pageType}
                // Optional: pressing the pressed type again sends none.
                onPress={(id) =>
                  pick({ pageType: choice.pageType === id ? null : (id as AiPageType) })
                }
                disabled={busy}
              />
            ) : null}
            {kind === 'email' || kind === 'campaign' ? (
              <ChipGroup
                id="ai-email-type-label"
                label="Kind of email (optional)"
                options={Object.entries(AI_EMAIL_TYPE_LABELS).map(([id, label]) => ({
                  id,
                  label,
                }))}
                value={choice.emailType ?? null}
                // Optional: pressing the pressed kind again sends none.
                onPress={(id) =>
                  pick({
                    emailType:
                      choice.emailType === id ? null : (id as AiBriefChoice['emailType']),
                  })
                }
                disabled={busy}
              />
            ) : null}
            {kind === 'email' ? (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={Boolean(choice.withCampaign)}
                    onChange={(event) => pick({ withCampaign: event.target.checked })}
                    disabled={busy}
                  />
                }
                label="Also draft a campaign that sends it"
              />
            ) : null}
            {kind === 'template' ? (
              <>
                <ChipGroup
                  id="ai-template-subject-label"
                  // Marked required because it IS (AGL-3143 §12): "Plan the
                  // template" stays disabled until one is picked, and the page
                  // dialog's chip group beside it reads "(optional)" — so an
                  // unmarked label here read as optional too, and a member who
                  // wrote a brief and stopped had nothing telling them why the
                  // button would not light.
                  label="One page for each (required)"
                  options={AI_TEMPLATE_SUBJECTS.map((subject) => ({
                    id: subject,
                    label: AI_TEMPLATE_SUBJECT_LABELS[subject],
                  }))}
                  value={choice.subject}
                  // Required, so a press picks and never clears.
                  onPress={(id) => pick({ subject: id as AiTemplateSubject })}
                  disabled={busy}
                />
                {choice.subject === 'entry' ? (
                  <AiTemplateCollectionField
                    hostId={hostId}
                    value={choice.collectionId}
                    onChange={(collectionId) => pick({ collectionId })}
                    disabled={busy}
                  />
                ) : null}
              </>
            ) : null}
            <Typography variant="body2" color="text.secondary">
              {copy.next}
            </Typography>
            {building ? <Alert severity="info">{AI_SITE_BUILD_IN_FLIGHT_COPY}</Alert> : null}
            {notice ? <Alert severity="warning">{notice}</Alert> : null}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {started ? 'Close' : 'Cancel'}
        </Button>
        {started ? null : (
          <Button
            variant="contained"
            onClick={() => void start()}
            disabled={busy || !orgId || !brief.trim() || !ready}
          >
            {copy.submit}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}

/** A labeled row of chips, each a toggle button that says whether it is pressed. */
function ChipGroup(props: {
  id: string
  label: string
  options: ReadonlyArray<{ id: string; label: string }>
  value: string | null
  onPress: (id: string) => void
  disabled: boolean
}) {
  const { id, label, options, value, onPress, disabled } = props
  return (
    <Stack spacing={1}>
      <Typography variant="body2" color="text.secondary" id={id}>
        {label}
      </Typography>
      <Stack
        direction="row"
        useFlexGap
        role="group"
        aria-labelledby={id}
        sx={{ flexWrap: 'wrap', gap: 1 }}
      >
        {options.map((option) => (
          <Chip
            key={option.id}
            label={option.label}
            color={value === option.id ? 'primary' : 'default'}
            variant={value === option.id ? 'filled' : 'outlined'}
            onClick={() => onPress(option.id)}
            aria-pressed={value === option.id}
            disabled={disabled}
          />
        ))}
      </Stack>
    </Stack>
  )
}

export default AiBriefDialog
