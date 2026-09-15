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

/*==========================================
 * WHAT A SEQUENCE MAY BE (AGL-2979).
 *
 * One validator for the three readers that need it: the editor, which shows
 * every issue beside the field it belongs to; the route that saves, which
 * refuses a sequence with an error; and activation, which also refuses while
 * the organization's footer cannot be written. Each issue names its field by
 * a dotted path (`steps.2.subject`) and says what to do in a sentence.
 *
 * ERRORS AND WARNINGS. An error is a sequence the engine cannot send or the
 * rules forbid: a fifth email, a first email with no subject, a `Re:` on a
 * message that answers nothing. A warning is a sequence that sends and
 * probably is not what its author meant — a merge field nobody fills, a
 * first email that never uses the personal line the rep writes at
 * enrollment.
 *==========================================*/

import { CRM_EMAIL_BODY_MAX, CRM_EMAIL_SUBJECT_MAX } from '@aglyn/aglyn/app-utils/crm'
import {
  CRM_MERGE_FIELDS,
  type CrmMergeFieldGroup,
  crmMergeFieldsIn,
} from '@aglyn/aglyn/app-utils/crm-email-templates'
import { crmThreadSubject } from '@aglyn/aglyn/app-utils/crm-inbound'
import {
  OUTREACH_DEFAULT_ALLOWED_COUNTRIES,
  OUTREACH_MAX_EMAIL_STEPS,
  OUTREACH_MAX_STEP_DELAY_BUSINESS_DAYS,
  OUTREACH_MAX_STEPS,
  OUTREACH_MIN_EMAIL_FOLLOW_UP_BUSINESS_DAYS,
  OUTREACH_TASK_KINDS,
  type OutreachEmailStep,
  type OutreachOrgSettings,
  type OutreachSendWindow,
  type OutreachSequence,
  type OutreachSequenceSettings,
  type OutreachSequenceStep,
} from '../model/outreach.types'

/** The merge field the rep's signal sentence is written into a step with. */
export const OUTREACH_PERSONAL_LINE_FIELD = 'enrollment.personalLine'

/** A merge field as the Outreach editor's picker offers it. */
export interface OutreachMergeFieldDefinition {
  key: string
  label: string
  group: CrmMergeFieldGroup | 'Enrollment'
}

/**
 * Every field an Outreach step may use: the CRM's, which the composer fills
 * through the CRM's own resolver, and the enrollment's.
 */
export const OUTREACH_MERGE_FIELDS: readonly OutreachMergeFieldDefinition[] = [
  ...CRM_MERGE_FIELDS,
  { key: OUTREACH_PERSONAL_LINE_FIELD, label: 'Personal line', group: 'Enrollment' },
]

/** The longest name a sequence carries. */
export const OUTREACH_SEQUENCE_NAME_MAX = 120

/** The longest title a task step carries. */
export const OUTREACH_TASK_TITLE_MAX = 200

export type OutreachValidationSeverity = 'error' | 'warning'

export type OutreachValidationCode =
  | 'name_required'
  | 'name_too_long'
  | 'mailbox_required'
  | 'steps_required'
  | 'too_many_steps'
  | 'too_many_email_steps'
  | 'step_id_required'
  | 'duplicate_step_id'
  | 'unknown_step_kind'
  | 'delay_invalid'
  | 'subject_required'
  | 'subject_too_long'
  | 'subject_reply_prefix'
  | 'body_required'
  | 'body_and_template'
  | 'body_too_long'
  | 'unknown_merge_field'
  | 'personal_line_unused'
  | 'task_kind_invalid'
  | 'task_title_required'
  | 'task_title_too_long'
  | 'window_days_invalid'
  | 'window_hours_invalid'
  | 'countries_required'
  | 'country_invalid'
  | 'legal_name_required'
  | 'postal_address_required'

export interface OutreachValidationIssue {
  /** The field, dotted: `name`, `steps.2.subject`, `settings.window`, `orgSettings.postalAddress`. */
  path: string
  code: OutreachValidationCode
  message: string
  severity: OutreachValidationSeverity
}

/** Whether any issue in the list stops a save or an activation. */
export function hasOutreachValidationErrors(
  issues: readonly OutreachValidationIssue[],
): boolean {
  return issues.some((issue) => issue.severity === 'error')
}

const error = (
  path: string,
  code: OutreachValidationCode,
  message: string,
): OutreachValidationIssue => ({ path, code, message, severity: 'error' })

const warning = (
  path: string,
  code: OutreachValidationCode,
  message: string,
): OutreachValidationIssue => ({ path, code, message, severity: 'warning' })

const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

const isEmailStep = (step: OutreachSequenceStep | null | undefined): step is OutreachEmailStep =>
  step?.kind === 'email'

/** The index of the first email step, or `-1` for a sequence with none. */
export function firstEmailStepIndex(
  steps: readonly OutreachSequenceStep[] | null | undefined,
): number {
  return (steps ?? []).findIndex(isEmailStep)
}

/**
 * Whether the email at `index` is sent as a reply in the thread an earlier
 * email started: every email after the first unless it says otherwise. The
 * first email starts the thread whatever its `replyInThread` says.
 */
export function isInThreadEmailStep(
  steps: readonly OutreachSequenceStep[] | null | undefined,
  index: number,
): boolean {
  const step = steps?.[index]
  if (!isEmailStep(step)) return false
  const first = firstEmailStepIndex(steps)
  return index > first && step.replyInThread !== false
}

/**
 * Whether a subject opens with a reply or forward prefix — `Re:`, `Fwd:`,
 * `AW:` — which on an email that answers nothing tells the recipient a
 * conversation exists that does not. The prefixes are the CRM thread
 * reader's, so the two agree on what one looks like.
 */
export function outreachSubjectHasReplyPrefix(subject: unknown): boolean {
  const collapsed = asText(subject).replace(/\s+/g, ' ').trim()
  return collapsed !== '' && crmThreadSubject(collapsed) !== collapsed.slice(0, CRM_EMAIL_SUBJECT_MAX)
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** A sending window's shape: at least one weekday, and an opening before a close. */
export function validateOutreachSendWindow(
  window: OutreachSendWindow | null | undefined,
  path = 'window',
): OutreachValidationIssue[] {
  const issues: OutreachValidationIssue[] = []
  const days = Array.isArray(window?.days) ? window.days : []
  const daysValid =
    days.length > 0 &&
    days.every((day) => Number.isInteger(day) && day >= 0 && day < WEEKDAY_NAMES.length) &&
    new Set(days).size === days.length
  if (!daysValid) {
    issues.push(
      error(`${path}.days`, 'window_days_invalid', 'Pick at least one day of the week to send on.'),
    )
  }
  const start = window?.startMinute
  const end = window?.endMinute
  const hoursValid =
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end <= 24 * 60 &&
    start < end
  if (!hoursValid) {
    issues.push(
      error(
        path,
        'window_hours_invalid',
        'The sending hours need a start time before the end time, within one day.',
      ),
    )
  }
  return issues
}

/**
 * The allowed countries, as stored or typed, reduced to unique uppercase
 * alpha-2 codes in the order given. Anything that is not two letters is
 * dropped, so a caller that needs to report it checks the raw value.
 */
export function normalizeOutreachAllowedCountries(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const codes: string[] = []
  for (const entry of value) {
    const code = asText(entry).trim().toUpperCase()
    if (/^[A-Z]{2}$/.test(code) && !codes.includes(code)) codes.push(code)
  }
  return codes
}

/**
 * A stored settings map with the defaults applied: the United States alone,
 * no customers, the mailbox's own window. A field a writer never set reads
 * as its default rather than as a permission nobody gave.
 */
export function readOutreachSequenceSettings(
  raw: Partial<OutreachSequenceSettings> | Record<string, unknown> | null | undefined,
): OutreachSequenceSettings {
  const data = (raw ?? {}) as Record<string, unknown>
  const countries = normalizeOutreachAllowedCountries(data['allowedCountries'])
  const window = data['window'] as OutreachSendWindow | null | undefined
  return {
    window: window && typeof window === 'object' ? window : null,
    allowedCountries: Array.isArray(data['allowedCountries'])
      ? countries
      : [...OUTREACH_DEFAULT_ALLOWED_COUNTRIES],
    allowCustomers: data['allowCustomers'] === true,
  }
}

export function validateOutreachSequenceSettings(
  settings: OutreachSequenceSettings | null | undefined,
  path = 'settings',
): OutreachValidationIssue[] {
  const issues: OutreachValidationIssue[] = []
  if (settings?.window) {
    issues.push(...validateOutreachSendWindow(settings.window, `${path}.window`))
  }
  const raw = Array.isArray(settings?.allowedCountries) ? settings.allowedCountries : []
  if (!raw.length) {
    issues.push(
      error(
        `${path}.allowedCountries`,
        'countries_required',
        'Choose at least one country this sequence may send to.',
      ),
    )
  }
  raw.forEach((entry, index) => {
    if (!/^[A-Z]{2}$/.test(asText(entry))) {
      issues.push(
        error(
          `${path}.allowedCountries.${index}`,
          'country_invalid',
          `"${asText(entry)}" isn't a two-letter country code, like US.`,
        ),
      )
    }
  })
  return issues
}

const KNOWN_MERGE_FIELDS = new Set(OUTREACH_MERGE_FIELDS.map((field) => field.key))

function mergeFieldWarnings(text: string, path: string): OutreachValidationIssue[] {
  return crmMergeFieldsIn(text)
    .filter((key) => !KNOWN_MERGE_FIELDS.has(key))
    .map((key) =>
      warning(
        path,
        'unknown_merge_field',
        `{{${key}}} isn't a merge field, so it will be sent empty.`,
      ),
    )
}

function delayIssues(
  steps: readonly OutreachSequenceStep[],
  step: OutreachSequenceStep,
  index: number,
  path: string,
): OutreachValidationIssue[] {
  const delay = step.delayBusinessDays
  const followsAnEmail = isEmailStep(step) && index > firstEmailStepIndex(steps)
  const min = followsAnEmail ? OUTREACH_MIN_EMAIL_FOLLOW_UP_BUSINESS_DAYS : 0
  if (Number.isInteger(delay) && delay >= min && delay <= OUTREACH_MAX_STEP_DELAY_BUSINESS_DAYS) {
    return []
  }
  const message =
    min > 0
      ? `Wait ${min}–${OUTREACH_MAX_STEP_DELAY_BUSINESS_DAYS} business days before this email.`
      : `Wait 0–${OUTREACH_MAX_STEP_DELAY_BUSINESS_DAYS} business days before this step.`
  return [error(`${path}.delayBusinessDays`, 'delay_invalid', message)]
}

function emailStepIssues(
  steps: readonly OutreachSequenceStep[],
  step: OutreachEmailStep,
  index: number,
  path: string,
): OutreachValidationIssue[] {
  const issues: OutreachValidationIssue[] = []
  const first = firstEmailStepIndex(steps) === index
  const startsThread = !isInThreadEmailStep(steps, index)
  const subject = asText(step.subject)
  if (startsThread) {
    if (!subject.trim()) {
      issues.push(
        error(
          `${path}.subject`,
          'subject_required',
          first
            ? 'The first email needs a subject.'
            : 'An email that starts a new thread needs a subject.',
        ),
      )
    } else if (outreachSubjectHasReplyPrefix(subject)) {
      issues.push(
        error(
          `${path}.subject`,
          'subject_reply_prefix',
          'Remove the "Re:" or "Fwd:" — this email starts a conversation, it doesn\'t answer one.',
        ),
      )
    }
    if (subject.length > CRM_EMAIL_SUBJECT_MAX) {
      issues.push(
        error(
          `${path}.subject`,
          'subject_too_long',
          `Keep the subject under ${CRM_EMAIL_SUBJECT_MAX} characters.`,
        ),
      )
    }
    issues.push(...mergeFieldWarnings(subject, `${path}.subject`))
  }
  const body = asText(step.body)
  const templateId = asText(step.templateId).trim()
  if (body.trim() && templateId) {
    issues.push(
      error(
        `${path}.body`,
        'body_and_template',
        'Write the email here or pick a template, not both.',
      ),
    )
  } else if (!body.trim() && !templateId) {
    issues.push(error(`${path}.body`, 'body_required', 'Write the email, or pick a template.'))
  }
  if (body.length > CRM_EMAIL_BODY_MAX) {
    issues.push(
      error(
        `${path}.body`,
        'body_too_long',
        `Keep the email under ${CRM_EMAIL_BODY_MAX.toLocaleString('en-US')} characters.`,
      ),
    )
  }
  if (body.trim()) {
    issues.push(...mergeFieldWarnings(body, `${path}.body`))
    if (first && !crmMergeFieldsIn(body).includes(OUTREACH_PERSONAL_LINE_FIELD)) {
      issues.push(
        warning(
          `${path}.body`,
          'personal_line_unused',
          `The first email doesn't use {{${OUTREACH_PERSONAL_LINE_FIELD}}}, so the line written for each person won't appear.`,
        ),
      )
    }
  }
  return issues
}

/** The steps of a sequence: their count, their ids, and each one's own fields. */
export function validateOutreachSteps(
  steps: readonly OutreachSequenceStep[] | null | undefined,
  path = 'steps',
): OutreachValidationIssue[] {
  const list = Array.isArray(steps) ? steps : []
  const issues: OutreachValidationIssue[] = []
  if (!list.length) {
    issues.push(error(path, 'steps_required', 'Add at least one step.'))
    return issues
  }
  if (list.length > OUTREACH_MAX_STEPS) {
    issues.push(
      error(path, 'too_many_steps', `A sequence holds at most ${OUTREACH_MAX_STEPS} steps.`),
    )
  }
  const emailCount = list.filter(isEmailStep).length
  if (emailCount > OUTREACH_MAX_EMAIL_STEPS) {
    issues.push(
      error(
        path,
        'too_many_email_steps',
        `A sequence sends at most ${OUTREACH_MAX_EMAIL_STEPS} emails to one person.`,
      ),
    )
  }
  const seen = new Set<string>()
  list.forEach((step, index) => {
    const stepPath = `${path}.${index}`
    const id = asText(step?.id).trim()
    if (!id) {
      issues.push(error(`${stepPath}.id`, 'step_id_required', 'Every step needs an id.'))
    } else if (seen.has(id)) {
      issues.push(error(`${stepPath}.id`, 'duplicate_step_id', 'Two steps share an id.'))
    }
    seen.add(id)
    if (isEmailStep(step)) {
      issues.push(...delayIssues(list, step, index, stepPath))
      issues.push(...emailStepIssues(list, step, index, stepPath))
    } else if (step?.kind === 'task') {
      issues.push(...delayIssues(list, step, index, stepPath))
      if (!(OUTREACH_TASK_KINDS as readonly string[]).includes(step.taskKind)) {
        issues.push(
          error(`${stepPath}.taskKind`, 'task_kind_invalid', 'Pick LinkedIn, Call or To-do.'),
        )
      }
      const title = asText(step.title)
      if (!title.trim()) {
        issues.push(error(`${stepPath}.title`, 'task_title_required', 'Give the task a title.'))
      } else if (title.length > OUTREACH_TASK_TITLE_MAX) {
        issues.push(
          error(
            `${stepPath}.title`,
            'task_title_too_long',
            `Keep the title under ${OUTREACH_TASK_TITLE_MAX} characters.`,
          ),
        )
      }
    } else {
      issues.push(
        error(stepPath, 'unknown_step_kind', 'A step is an email or a task.'),
      )
    }
  })
  return issues
}

/** Everything a stored sequence has to be before it may be saved. */
export function validateOutreachSequence(
  sequence: Pick<OutreachSequence, 'name' | 'mailboxId' | 'steps' | 'settings'> | null | undefined,
): OutreachValidationIssue[] {
  const issues: OutreachValidationIssue[] = []
  const name = asText(sequence?.name)
  if (!name.trim()) {
    issues.push(error('name', 'name_required', 'Name the sequence.'))
  } else if (name.length > OUTREACH_SEQUENCE_NAME_MAX) {
    issues.push(
      error('name', 'name_too_long', `Keep the name under ${OUTREACH_SEQUENCE_NAME_MAX} characters.`),
    )
  }
  const steps = sequence?.steps ?? []
  if (steps.some(isEmailStep) && !asText(sequence?.mailboxId).trim()) {
    issues.push(
      error('mailboxId', 'mailbox_required', 'Choose the mailbox this sequence sends from.'),
    )
  }
  issues.push(...validateOutreachSteps(steps))
  issues.push(...validateOutreachSequenceSettings(sequence?.settings))
  return issues
}

/**
 * The organization's footer fields: a legal name and a postal address, the
 * two things the law requires every commercial email to carry.
 */
export function validateOutreachOrgSettings(
  settings: Pick<OutreachOrgSettings, 'legalName' | 'postalAddress'> | null | undefined,
  path = 'orgSettings',
): OutreachValidationIssue[] {
  const issues: OutreachValidationIssue[] = []
  if (!asText(settings?.legalName).trim()) {
    issues.push(
      error(
        `${path}.legalName`,
        'legal_name_required',
        "Add your organization's legal name in Outreach settings. It goes in every email's footer.",
      ),
    )
  }
  if (!asText(settings?.postalAddress).trim()) {
    issues.push(
      error(
        `${path}.postalAddress`,
        'postal_address_required',
        "Add your organization's postal address in Outreach settings. The law requires one in every sales email.",
      ),
    )
  }
  return issues
}

/**
 * What activating a sequence refuses on: every issue saving refuses on, and
 * an organization whose footer cannot be written yet.
 */
export function validateOutreachSequenceActivation(
  sequence: Pick<OutreachSequence, 'name' | 'mailboxId' | 'steps' | 'settings'> | null | undefined,
  orgSettings: Pick<OutreachOrgSettings, 'legalName' | 'postalAddress'> | null | undefined,
): OutreachValidationIssue[] {
  return [...validateOutreachSequence(sequence), ...validateOutreachOrgSettings(orgSettings)]
}
