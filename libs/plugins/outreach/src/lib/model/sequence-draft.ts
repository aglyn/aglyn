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
 * A SEQUENCE AS THE EDITOR HOLDS IT (AGL-2980).
 *
 * The editor builds a draft, the save route reads the draft it was sent
 * through the same reader, and the engine's validator judges both — so the
 * issues the editor shows beside a field are the ones the route would
 * refuse the save with. Client-safe.
 *
 * ## Once someone is enrolled, the steps they stand on stay put
 *
 * An enrollment points at its next step by POSITION (`stepIndex`), and it
 * was enrolled into a site's CRM from one mailbox. So after the first
 * enrollment, a save may edit any step's wording and delay and may add
 * steps at the end, but may not remove, reorder or change the kind of a
 * step that already exists, and may not move the sequence to another site
 * or mailbox: each of those would send an enrolled person a step they were
 * never going to get, from an address they never heard from. A new
 * sequence is the way to change them.
 *==========================================*/

import { normalizeCampaignIds } from '@aglyn/aglyn/app-utils/campaign-membership'
import {
  readOutreachSequenceSettings,
  type OutreachValidationIssue,
  type OutreachValidationCode,
} from '../engine/sequence-validation'
import {
  type OutreachEmailStep,
  type OutreachMailbox,
  type OutreachSendWindow,
  type OutreachSequence,
  type OutreachSequenceSettings,
  type OutreachSequenceStep,
  type OutreachTaskKind,
  type OutreachTaskStep,
} from './outreach.types'

/** A sequence as the editor holds it and the save route receives it. */
export interface OutreachSequenceDraft {
  name: string
  /** The site whose CRM the enrolled people are records of. */
  hostId: string
  /** `''` until a mailbox is chosen. */
  mailboxId: string
  steps: OutreachSequenceStep[]
  settings: OutreachSequenceSettings
  /**
   * The site's campaigns the sequence is in (AGL-3254), as the picker holds
   * them: clean ids, `[]` for none — stored as `[]` too, for the reason
   * `campaignMembershipValue` gives.
   */
  campaignIds: string[]
}

/** The most steps a draft is read with; the validator refuses past the real limit. */
const STEPS_READ_MAX = 20

/** The delay a new email after the first starts with, in business days. */
export const OUTREACH_DEFAULT_FOLLOW_UP_DAYS = 3

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** A whole number, or `NaN` for anything else, so the validator names it. */
const wholeNumber = (value: unknown): number => {
  const number = typeof value === 'number' ? value : Number(text(value) || NaN)
  return Number.isInteger(number) ? number : Number.NaN
}

function readWindow(value: unknown): OutreachSendWindow | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  return {
    days: Array.isArray(raw['days']) ? raw['days'].map((day) => wholeNumber(day)) : [],
    startMinute: wholeNumber(raw['startMinute']),
    endMinute: wholeNumber(raw['endMinute']),
  }
}

function readStep(value: unknown): OutreachSequenceStep {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const id = text(raw['id']).trim().slice(0, 64)
  const delayBusinessDays = wholeNumber(raw['delayBusinessDays'])
  if (raw['kind'] === 'email') {
    const templateId = text(raw['templateId']).trim()
    const step: OutreachEmailStep = {
      id,
      kind: 'email',
      delayBusinessDays,
      subject: text(raw['subject']),
      replyInThread: raw['replyInThread'] !== false,
      body: text(raw['body']),
      templateId: templateId || null,
    }
    return step
  }
  if (raw['kind'] === 'task') {
    const step: OutreachTaskStep = {
      id,
      kind: 'task',
      taskKind: text(raw['taskKind']) as OutreachTaskKind,
      title: text(raw['title']),
      delayBusinessDays,
    }
    return step
  }
  // Neither kind: kept, so the validator can say "a step is an email or a
  // task" beside it rather than the step silently disappearing.
  return { id, kind: text(raw['kind']) } as unknown as OutreachSequenceStep
}

/**
 * A draft read out of anything — a request body, a stored sequence — with
 * every field the model does not name left behind and every value coerced
 * to its type. Nothing is judged here; that is the validator's.
 */
export function readOutreachSequenceDraft(input: unknown): OutreachSequenceDraft {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const settings = readOutreachSequenceSettings(
    (raw['settings'] && typeof raw['settings'] === 'object'
      ? raw['settings']
      : {}) as Record<string, unknown>,
  )
  return {
    name: text(raw['name']).replace(/\s+/g, ' ').trim(),
    hostId: text(raw['hostId']).trim(),
    mailboxId: text(raw['mailboxId']).trim(),
    steps: (Array.isArray(raw['steps']) ? raw['steps'] : []).slice(0, STEPS_READ_MAX).map(readStep),
    settings: {
      ...settings,
      window: readWindow((raw['settings'] as Record<string, unknown> | undefined)?.['window']),
    },
    campaignIds: normalizeCampaignIds(raw['campaignIds']),
  }
}

/** The draft a stored sequence opens as in the editor. */
export function outreachSequenceDraftOf(
  sequence: Pick<OutreachSequence, 'name' | 'hostId' | 'mailboxId' | 'steps' | 'settings' | 'campaignIds'>,
): OutreachSequenceDraft {
  return readOutreachSequenceDraft(sequence)
}

/** A step id nothing else in the sequence carries. */
export function newOutreachStepId(
  steps: readonly Pick<OutreachSequenceStep, 'id'>[] = [],
  random: () => number = Math.random,
): string {
  const taken = new Set(steps.map((step) => step.id))
  for (let attempt = 0; ; attempt += 1) {
    const drawn = `step-${Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0')}`
    // A source that keeps answering the same number still ends: the attempt
    // count makes the id unique once the draws stop being.
    const id = attempt < 4 ? drawn : `${drawn}-${attempt}`
    if (!taken.has(id)) return id
  }
}

/**
 * A new email step for the end of `steps`: the first email waits for the
 * next opening; a later one waits a few business days and replies in the
 * thread the first started.
 */
export function newOutreachEmailStep(
  steps: readonly OutreachSequenceStep[],
  random?: () => number,
): OutreachEmailStep {
  const follows = steps.some((step) => step.kind === 'email')
  return {
    id: newOutreachStepId(steps, random),
    kind: 'email',
    delayBusinessDays: follows ? OUTREACH_DEFAULT_FOLLOW_UP_DAYS : 0,
    subject: '',
    replyInThread: true,
    body: '',
    templateId: null,
  }
}

/** A new task step for the end of `steps`, titled for its kind. */
export function newOutreachTaskStep(
  steps: readonly OutreachSequenceStep[],
  taskKind: OutreachTaskKind,
  random?: () => number,
): OutreachTaskStep {
  const titles: Record<OutreachTaskKind, string> = {
    linkedin: 'Connect on LinkedIn',
    call: 'Call',
    todo: '',
  }
  return {
    id: newOutreachStepId(steps, random),
    kind: 'task',
    taskKind,
    title: titles[taskKind] ?? '',
    delayBusinessDays: 1,
  }
}

/** A new sequence: one email, for `hostId`, sending to the countries given. */
export function emptyOutreachSequenceDraft(input: {
  hostId: string
  mailboxId?: string
  allowedCountries: readonly string[]
  random?: () => number
}): OutreachSequenceDraft {
  return {
    name: '',
    hostId: input.hostId,
    mailboxId: input.mailboxId ?? '',
    steps: [newOutreachEmailStep([], input.random)],
    settings: {
      window: null,
      allowedCountries: [...input.allowedCountries],
      allowCustomers: false,
      // Off for a NEW sequence too (AGL-3239), not only for the ones that
      // predate it: a tracked link is visible in the body a cold recipient
      // reads, so it is turned on deliberately or not at all.
      trackClicks: false,
      // Off for a new sequence (AGL-3296): a sequence is one-to-one mail,
      // and the header makes mail clients present it as a mailing list.
      listUnsubscribe: false,
    },
    campaignIds: [],
  }
}

/** The issues a save can be refused with beyond the engine's own. */
export type OutreachSequenceIssueCode =
  | OutreachValidationCode
  | 'steps_locked'
  | 'host_locked'
  | 'mailbox_locked'
  | 'host_unknown'
  | 'mailbox_unknown'
  | 'mailbox_not_yours'
  | 'mailbox_not_sending'
  | 'country_not_in_org'
  | 'campaign_unknown'

export interface OutreachSequenceIssue extends Omit<OutreachValidationIssue, 'code'> {
  code: OutreachSequenceIssueCode
}

/**
 * What a save may not change once someone is enrolled — see the module
 * note. `previous` is the stored sequence; `next` the draft being saved.
 */
export function outreachEnrolledSequenceIssues(
  previous: Pick<OutreachSequenceDraft, 'hostId' | 'mailboxId' | 'steps'>,
  next: Pick<OutreachSequenceDraft, 'hostId' | 'mailboxId' | 'steps'>,
): OutreachSequenceIssue[] {
  const issues: OutreachSequenceIssue[] = []
  const locked = (path: string, code: OutreachSequenceIssueCode, message: string) =>
    issues.push({ path, code, message, severity: 'error' })
  const kept = previous.steps.every(
    (step, index) => next.steps[index]?.id === step.id && next.steps[index]?.kind === step.kind,
  )
  if (!kept) {
    locked(
      'steps',
      'steps_locked',
      "People are enrolled in this sequence, so its steps can't be removed, reordered or changed to another kind. Edit their wording, add steps at the end, or start a new sequence.",
    )
  }
  if (previous.hostId !== next.hostId) {
    locked('hostId', 'host_locked', "People are enrolled from this site's CRM, so the site can't change.")
  }
  if (previous.mailboxId !== next.mailboxId) {
    locked(
      'mailboxId',
      'mailbox_locked',
      "People are enrolled from this mailbox, so it can't change. Start a new sequence to send from another.",
    )
  }
  return issues
}

/**
 * Whether a sequence's mailbox can send right now, as activation asks it:
 * `none` when no mailbox is chosen, `gone` when it was disconnected or is
 * not this organization's, `paused` or `reconnect_required` while it is
 * connected but not sending, and `sending` when it is connected.
 */
export type OutreachSequenceMailboxState =
  | 'none'
  | 'gone'
  | 'paused'
  | 'reconnect_required'
  | 'sending'

export function outreachSequenceMailboxState(
  mailboxId: string,
  mailbox: Pick<OutreachMailbox, 'status'> | null | undefined,
): OutreachSequenceMailboxState {
  if (!mailboxId) return 'none'
  if (!mailbox || mailbox.status === 'disconnected') return 'gone'
  if (mailbox.status === 'paused' || mailbox.status === 'reconnect_required') {
    return mailbox.status
  }
  return 'sending'
}

/** What activation refuses with for each mailbox that cannot send. */
const MAILBOX_ACTIVATION_ISSUES: Record<
  Exclude<OutreachSequenceMailboxState, 'sending'>,
  { code: OutreachSequenceIssueCode; message: string }
> = {
  none: {
    code: 'mailbox_required',
    message: 'Choose the mailbox this sequence sends from before activating it.',
  },
  gone: {
    code: 'mailbox_unknown',
    message: "This sequence's mailbox is no longer connected. Choose another before activating it.",
  },
  paused: {
    code: 'mailbox_not_sending',
    message: "This sequence's mailbox is paused. Resume it in Mailboxes, then activate the sequence.",
  },
  reconnect_required: {
    code: 'mailbox_not_sending',
    message:
      "Google stopped accepting this sequence's mailbox. Reconnect it in Mailboxes, then activate the sequence.",
  },
}

/**
 * Why a sequence cannot be activated on its mailbox, or `null` when it can
 * (AGL-2980). A sequence is activated only onto a mailbox that is sending:
 * connected, not paused, and not waiting for its member to reconnect it —
 * whether or not its steps include an email, because every step's due time
 * is read in the mailbox's timezone and sending hours.
 *
 * The status route refuses with it, and the sequence page shows it beside
 * a disabled Activate button, so the page says why before anyone clicks.
 */
export function outreachMailboxActivationIssue(
  mailboxId: string,
  mailbox: Pick<OutreachMailbox, 'status'> | null | undefined,
): OutreachSequenceIssue | null {
  const state = outreachSequenceMailboxState(mailboxId, mailbox)
  if (state === 'sending') return null
  const { code, message } = MAILBOX_ACTIVATION_ISSUES[state]
  return { path: 'mailboxId', code, message, severity: 'error' }
}
