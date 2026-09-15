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
 * WHAT EXACTLY IS SENT (AGL-2979).
 *
 * The composer turns a step, an enrollment and the organization's settings
 * into the message the transport sends: the recipient, the subject, the
 * plain text, and the headers that thread it and let the recipient leave.
 * The transport adds the From line and the MIME; nothing here knows either.
 *
 * ## The footer is not optional
 *
 * Every email ends with the organization's legal name, its postal address,
 * a sentence saying the email is a business solicitation, and the way out —
 * reply "no". Those are what CAN-SPAM requires of a commercial email, and
 * the composer appends them itself, after the merge, as literal text: no
 * template can leave them off, and no merge field can rewrite them. With no
 * postal address or no legal name, it refuses to compose at all.
 *
 * ## Threading
 *
 * An email after the first is a reply in the thread unless its step says
 * otherwise: `Re:` and the thread's own subject, `In-Reply-To` the last
 * message sent into the thread, `References` every one of them, and the
 * provider thread to send into. A `Re:` on an email that answers nothing is
 * a deception, so a reply step with no thread to answer is refused rather
 * than sent with a borrowed one, and a subject that starts with `Re:` or
 * `Fwd:` on an email that starts a thread is refused too.
 *
 * ## Merge fields
 *
 * The CRM's own resolver fills them, from the documents the runtime already
 * read, and the enrollment's personal line joins them as
 * `{{enrollment.personalLine}}` through the resolver's `extra` fields.
 * Fields that render empty are returned beside the message, for the
 * runtime to decide whether "Hi ," is worth sending.
 *==========================================*/

import { normalizeContactEmail } from '@aglyn/aglyn/app-utils/contacts'
import { CRM_EMAIL_SUBJECT_MAX } from '@aglyn/aglyn/app-utils/crm'
import {
  type CrmMergeContext,
  resolveCrmMergeFields,
} from '@aglyn/aglyn/app-utils/crm-email-templates'
import { crmThreadSubject } from '@aglyn/aglyn/app-utils/crm-inbound'
import type {
  OutreachEnrollment,
  OutreachOrgSettings,
  OutreachSequence,
} from '../model/outreach.types'
import { normalizeOutreachPersonalLine } from './gates'
import {
  isInThreadEmailStep,
  OUTREACH_PERSONAL_LINE_FIELD,
  outreachSubjectHasReplyPrefix,
} from './sequence-validation'

/** The way out every email offers, word for word. */
export const OUTREACH_OPT_OUT_LINE = 'Not relevant? Reply "no" and I won\'t email again.'

/** The sentence that says what the email is. */
export function outreachSolicitationStatement(senderName: string): string {
  return `This is a business solicitation from ${senderName}.`
}

/**
 * The message the transport sends. Header values are single lines already;
 * the text uses `\n` line breaks, which the transport writes as CRLF.
 */
export interface ComposedOutreachEmail {
  /** The recipient's address, normalized. */
  to: string
  subject: string
  /** The plain-text body, footer included. */
  text: string
  /** The provider thread a reply step is sent into. */
  threadId?: string
  /** The `Message-ID` this email answers, angle brackets included. */
  inReplyTo?: string
  /** Every `Message-ID` in the thread so far, oldest first, space-separated. */
  references?: string
  /** The one-click unsubscribe URL, for `List-Unsubscribe` with `List-Unsubscribe-Post`. */
  listUnsubscribeUrl?: string
  /** A `mailto:` URI for `List-Unsubscribe`. */
  listUnsubscribeMailto?: string
}

export type OutreachComposeErrorCode =
  | 'missing_postal_address'
  | 'missing_legal_name'
  | 'not_an_email_step'
  | 'invalid_recipient'
  | 'missing_subject'
  | 'subject_reply_prefix'
  | 'missing_body'
  | 'missing_thread'
  | 'invalid_unsubscribe_url'
  | 'invalid_unsubscribe_mailto'

export interface OutreachComposeError {
  code: OutreachComposeErrorCode
  message: string
}

export interface ComposeOutreachEmailInput {
  sequence: Pick<OutreachSequence, 'steps'>
  enrollment: Pick<
    OutreachEnrollment,
    'email' | 'stepIndex' | 'personalLine' | 'threadSubject' | 'messageIds' | 'gmailThreadId'
  >
  orgSettings: Pick<OutreachOrgSettings, 'legalName' | 'brandName' | 'postalAddress'> | null | undefined
  /**
   * What the CRM resolver reads: the contact, the sending site's group id,
   * the sender (the mailbox's display name and address), the site. Its
   * `extra` may carry fields of the caller's own; the personal line is added
   * here.
   */
  merge: CrmMergeContext | null | undefined
  /** The CRM template's body, read by the caller, when the step names a template. */
  templateBody?: string | null
  /** The signed one-click unsubscribe URL, minted by the runtime. */
  listUnsubscribeUrl?: string | null
  /** An address, or a `mailto:` URI, that unsubscribes whoever writes to it. */
  listUnsubscribeMailto?: string | null
}

export interface OutreachComposeResult {
  email: ComposedOutreachEmail | null
  error: OutreachComposeError | null
  /** Merge fields that rendered empty, unique, in order of appearance. */
  unresolvedFields: string[]
}

const oneLine = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''

/**
 * The footer every email ends with, or the reason it cannot be written.
 *
 * The postal address may be stored over several lines; the footer prints it
 * on one, the parts separated by commas.
 */
export function composeOutreachFooter(
  settings: Pick<OutreachOrgSettings, 'legalName' | 'brandName' | 'postalAddress'> | null | undefined,
): { footer: string | null; error: OutreachComposeError | null } {
  const postalAddress = String(settings?.postalAddress ?? '')
    .split(/\r\n|\r|\n/)
    .map((line) => oneLine(line).replace(/,+$/, ''))
    .filter(Boolean)
    .join(', ')
  if (!postalAddress) {
    return {
      footer: null,
      error: {
        code: 'missing_postal_address',
        message:
          "This email can't be sent without your organization's postal address. Add it in Outreach settings.",
      },
    }
  }
  const legalName = oneLine(settings?.legalName)
  if (!legalName) {
    return {
      footer: null,
      error: {
        code: 'missing_legal_name',
        message:
          "This email can't be sent without your organization's legal name. Add it in Outreach settings.",
      },
    }
  }
  const senderName = oneLine(settings?.brandName) || legalName
  return {
    footer: `${legalName} · ${postalAddress}\n${outreachSolicitationStatement(senderName)} ${OUTREACH_OPT_OUT_LINE}`,
    error: null,
  }
}

/** A `Message-ID` in its header form — `<id@host>` — or `null` for one that is not. */
export function outreachMessageIdHeader(value: unknown): string | null {
  const bare = String(value ?? '').trim().replace(/^<+/, '').replace(/>+$/, '')
  if (!bare || /[\s<>]/.test(bare)) return null
  return `<${bare}>`
}

function unsubscribeUrl(value: unknown): string | null | undefined {
  const raw = String(value ?? '').trim()
  if (!raw) return undefined
  if (/[\r\n]/.test(raw)) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function unsubscribeMailto(value: unknown): string | null | undefined {
  const raw = String(value ?? '').trim()
  if (!raw) return undefined
  if (/[\r\n]/.test(raw)) return null
  if (!/^mailto:/i.test(raw)) {
    const address = normalizeContactEmail(raw)
    return address ? `mailto:${address}?subject=unsubscribe` : null
  }
  let target = raw.slice('mailto:'.length).split('?')[0]
  try {
    target = decodeURIComponent(target)
  } catch {
    return null
  }
  return normalizeContactEmail(target) ? raw : null
}

const refuse = (
  code: OutreachComposeErrorCode,
  message: string,
): OutreachComposeResult => ({ email: null, error: { code, message }, unresolvedFields: [] })

/** The email one step sends to one person — see the module note. */
export function composeOutreachEmail(input: ComposeOutreachEmailInput): OutreachComposeResult {
  const { footer, error } = composeOutreachFooter(input.orgSettings)
  if (error) return { email: null, error, unresolvedFields: [] }

  const steps = input.sequence?.steps ?? []
  const stepIndex = input.enrollment?.stepIndex
  const step = steps[stepIndex]
  if (step?.kind !== 'email') {
    return refuse('not_an_email_step', 'The step this enrollment is on does not send an email.')
  }
  const to = normalizeContactEmail(input.enrollment.email)
  if (!to) {
    return refuse('invalid_recipient', "This enrollment's address isn't a valid email address.")
  }

  const context: CrmMergeContext = {
    ...(input.merge ?? {}),
    extra: {
      ...(input.merge?.extra ?? {}),
      [OUTREACH_PERSONAL_LINE_FIELD]: normalizeOutreachPersonalLine(input.enrollment.personalLine),
    },
  }
  const unresolved: string[] = []
  const render = (text: string): string => {
    const result = resolveCrmMergeFields(text, context)
    for (const key of result.unresolved) if (!unresolved.includes(key)) unresolved.push(key)
    return result.text
  }

  const email: ComposedOutreachEmail = { to, subject: '', text: '' }
  if (isInThreadEmailStep(steps, stepIndex)) {
    const threadSubject = crmThreadSubject(input.enrollment.threadSubject)
    const messageIds = (input.enrollment.messageIds ?? [])
      .map(outreachMessageIdHeader)
      .filter((id): id is string => id !== null)
    const threadId = String(input.enrollment.gmailThreadId ?? '').trim()
    if (!threadSubject || !messageIds.length || !threadId) {
      return refuse(
        'missing_thread',
        'This email replies in the thread, and no earlier email in the thread was sent.',
      )
    }
    email.subject = `Re: ${threadSubject}`.slice(0, CRM_EMAIL_SUBJECT_MAX)
    email.threadId = threadId
    email.inReplyTo = messageIds[messageIds.length - 1]
    email.references = messageIds.join(' ')
  } else {
    const subject = oneLine(render(String(step.subject ?? '')))
    if (!subject) return refuse('missing_subject', 'This email has no subject.')
    if (outreachSubjectHasReplyPrefix(subject)) {
      return refuse(
        'subject_reply_prefix',
        'This email starts a thread, so its subject may not begin with "Re:" or "Fwd:".',
      )
    }
    email.subject = subject.slice(0, CRM_EMAIL_SUBJECT_MAX)
  }

  const source = step.templateId ? String(input.templateBody ?? '') : String(step.body ?? '')
  const body = render(source)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '')
  if (!body.trim()) return refuse('missing_body', 'This email has no body.')
  email.text = `${body}\n\n${footer}`

  const url = unsubscribeUrl(input.listUnsubscribeUrl)
  if (url === null) {
    return refuse('invalid_unsubscribe_url', 'The unsubscribe link must be an https URL.')
  }
  if (url) email.listUnsubscribeUrl = url
  const mailto = unsubscribeMailto(input.listUnsubscribeMailto)
  if (mailto === null) {
    return refuse('invalid_unsubscribe_mailto', 'The unsubscribe address is not an email address.')
  }
  if (mailto) email.listUnsubscribeMailto = mailto

  return { email, error: null, unresolvedFields: unresolved }
}
