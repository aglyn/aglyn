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
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiJobKind } from '../model/ai-jobs.types'
import { AI_PAGE_TYPES, type AiPageType } from '../model/ai-page-job'
import {
  AI_TEMPLATE_SUBJECTS,
  parseAiTemplateJobInputs,
  type AiTemplateSubject,
} from '../model/ai-template-subjects'
import { AiTemplateCollectionField } from './ai-template-collection-field.component'

/**
 * The brief dialog every "Describe it" opens (AGL-2907, AGL-3043): a page
 * from the Screens page and from the Assist panel's AI jobs, a page template
 * from Templates, a layout from Layouts and a form from Forms.
 *
 * One text box, and whatever the kind's door reads beside it, start one job of
 * that kind: a page's optional page type; a template's subject and, for a
 * collection entry's page, its collection. A layout and a form read nothing
 * but the brief and the site. The job plans first and waits in AI jobs, where
 * the member confirms the plan and opens the draft once it is built; nothing
 * here builds or writes anything.
 */

/** The longest brief a job admits. */
const BRIEF_MAX_CHARS = 4_000

/** The job kinds a member describes from a console page. */
export type AiBriefKind = Extract<AiJobKind, 'page' | 'template' | 'layout' | 'form'>

/** What the dialog says for one kind. */
export interface AiBriefCopy {
  title: string
  /** The brief box's label. */
  briefLabel: string
  placeholder: string
  /** What happens after the member starts the job, under the fields. */
  next: string
  /** The action that starts the job. */
  submit: string
  /** What the dialog says once the job exists. */
  started: string
  /** What it says when the door gave no reason, or could not be reached. */
  failed: string
}

export const AI_BRIEF_COPY: Readonly<Record<AiBriefKind, AiBriefCopy>> = {
  page: {
    title: 'Describe a page',
    briefLabel: 'What is the page for?',
    placeholder:
      'A landing page for our spring roof inspection offer, with the quote request form',
    next:
      'A plan comes first, and nothing is built until you confirm it. The page uses your ' +
      'theme and what the site already has, and the plan lists anything the job builds first.',
    submit: 'Plan the page',
    started:
      'The page is being planned. Open AI jobs in the Assist panel to review the plan and ' +
      'confirm it. The page is built as an unpublished draft.',
    failed: 'The page could not be started. Try again.',
  },
  template: {
    title: 'Describe a page template',
    briefLabel: 'What should each page show?',
    placeholder:
      'A page for each of our team members: their name and photo, their role, a short ' +
      'biography and a way to get in touch',
    next:
      'A plan comes first, and nothing is built until you confirm it. What changes from one ' +
      'page to the next, such as a name or a photo, is filled in from each record rather ' +
      'than typed.',
    submit: 'Plan the template',
    started:
      'The template is being planned. Open AI jobs in the Assist panel to review the plan ' +
      'and confirm it. The template is built as a draft in your library, and nothing on ' +
      'your site uses it until you do.',
    failed: 'The template could not be started. Try again.',
  },
  layout: {
    title: 'Describe a layout',
    briefLabel: 'What should the layout hold?',
    placeholder:
      'A header with our name and links to Services, About and Contact, and a footer with ' +
      'our address and opening hours',
    next:
      'A plan comes first, and nothing is built until you confirm it. The layout links your ' +
      'screens, and places your navigation or menu component when the site has one.',
    submit: 'Plan the layout',
    started:
      'The layout is being planned. Open AI jobs in the Assist panel to review the plan and ' +
      'confirm it. The layout is built as a draft, and no screen uses it until you assign it.',
    failed: 'The layout could not be started. Try again.',
  },
  form: {
    title: 'Describe a form',
    briefLabel: 'What is the form for?',
    placeholder:
      'A quote request form for a roofing company, asking what needs fixing and the best ' +
      'time to call',
    next:
      'A plan comes first, and nothing is built until you confirm it. The form’s fields, its ' +
      'marketing consent and where each submission goes are planned together.',
    submit: 'Plan the form',
    started:
      'The form is being planned. Open AI jobs in the Assist panel to review the plan and ' +
      'confirm it. The form is built as a draft, and it collects nothing until you place it ' +
      'on a screen.',
    failed: 'The form could not be started. Try again.',
  },
}

/** Each template subject as its chip names it: what one page is drawn for. */
export const AI_TEMPLATE_SUBJECT_LABELS: Readonly<Record<AiTemplateSubject, string>> = {
  entry: 'Collection entry',
  product: 'Product',
  author: 'Author',
}

/** What a member picked beside the brief; each kind reads only its own. */
export interface AiBriefChoice {
  /** A page's type, or `null` for none. */
  pageType: AiPageType | null
  /** What a template's pages are drawn for, or `null` until one is picked. */
  subject: AiTemplateSubject | null
  /** A collection entry template's collection, or `null` until one is picked. */
  collectionId: string | null
}

export const AI_BRIEF_NO_CHOICE: AiBriefChoice = {
  pageType: null,
  subject: null,
  collectionId: null,
}

/**
 * The job's `inputs` for what the member picked, or `null` while the kind's
 * door would refuse them.
 *
 * A template's are read by the parser its door reads, so the dialog cannot
 * send a subject the door does not know or an entry page with no collection.
 * A page's type is optional. A layout and a form read no inputs at all
 * (AGL-2909, AGL-2913), so theirs are empty.
 */
export function aiBriefJobInputs(
  kind: AiBriefKind,
  choice: AiBriefChoice,
): Record<string, string> | null {
  if (kind === 'page') return choice.pageType ? { pageType: choice.pageType } : {}
  if (kind === 'template') {
    const inputs = parseAiTemplateJobInputs({
      subject: choice.subject,
      collectionId: choice.collectionId,
    })
    if (typeof inputs === 'string') return null
    return inputs.collectionId
      ? { subject: inputs.subject, collectionId: inputs.collectionId }
      : { subject: inputs.subject }
  }
  return {}
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
}

export function AiBriefDialog({ kind, open, onClose, orgId, hostId, user }: AiBriefDialogProps) {
  const copy = AI_BRIEF_COPY[kind]
  // Held in a ref so the request reads WHO is signed in, and nothing keys on
  // the identity of the object that says so.
  const userRef = useRef(user)
  userRef.current = user
  const [brief, setBrief] = useState('')
  const [choice, setChoice] = useState<AiBriefChoice>(AI_BRIEF_NO_CHOICE)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [started, setStarted] = useState(false)

  useEffect(() => {
    if (!open) return
    setNotice(null)
    setStarted(false)
  }, [open])

  const pick = useCallback(
    (patch: Partial<AiBriefChoice>) => setChoice((current) => ({ ...current, ...patch })),
    [],
  )
  const ready = aiBriefJobInputs(kind, choice) !== null

  const start = useCallback(async () => {
    const inputs = aiBriefJobInputs(kind, choice)
    if (!orgId || !brief.trim() || !inputs) return
    setBusy(true)
    setNotice(null)
    try {
      const response = await authorizedFetch(userRef.current, '/api/ai/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, hostId, kind, brief: brief.trim(), inputs }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const locked = parseLockdownRefusal(response.status, payload)
        setNotice(locked ? lockdownRefusalText(locked) : String(payload?.error ?? copy.failed))
        return
      }
      setStarted(true)
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
      <DialogTitle>{copy.title}</DialogTitle>
      <DialogContent>
        {started ? (
          <Alert severity="success">{copy.started}</Alert>
        ) : (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label={copy.briefLabel}
              placeholder={copy.placeholder}
              multiline
              minRows={4}
              value={brief}
              onChange={(event) => setBrief(event.target.value.slice(0, BRIEF_MAX_CHARS))}
              helperText={`${brief.length.toLocaleString('en-US')} / ${BRIEF_MAX_CHARS.toLocaleString('en-US')}`}
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
            {kind === 'template' ? (
              <>
                <ChipGroup
                  id="ai-template-subject-label"
                  label="One page for each"
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
