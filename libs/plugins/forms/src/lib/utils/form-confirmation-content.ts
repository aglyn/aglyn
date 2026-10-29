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

import {
  isMarketingConsentFieldName,
  type FormFieldDecl,
  type FormRequest,
} from '@aglyn/aglyn/app-utils/forms'

/*==========================================
 * WHAT A FORM'S CONFIRMATION SAYS (AGL-4098).
 *
 * The `form-confirmation` catalog email's tokens, composed per send: a
 * subject, what they sent as they would call it (never the form's own name,
 * which is the business's internal label for it), a
 * heading and a sentence on what this is (a request, or a message), a copy of
 * the answers under the form's own labels, the files by name, what happens
 * next, and how to reach the business beyond a reply. The opt-in box and the
 * file fields' own lines are left out of the answers: a tick says nothing
 * worth a copy, and the files are named on their own line. Links typed into
 * an answer are left out too ({@link TYPED_LINK}).
 *
 * THE SUBJECT NAMES THE CONVERSATION. The confirmation starts the email
 * conversation the business's answer replies into, and every later email in
 * it (a quote started from the request, its invoice) keeps its subject. So a
 * request's subject says what the conversation is about, "Your quote request
 * with Northwind Signs", rather than the one event of it arriving.
 *
 * Pure: the submit route and the sample renders call the same function.
 *=========================================*/

/** The most answers copied into the email; a long survey keeps its first ones. */
export const FORM_CONFIRMATION_MAX_ANSWERS = 12

/** The most characters of one answer the email repeats. */
export const FORM_CONFIRMATION_MAX_ANSWER_CHARS = 300

/** The most file names listed before "and N more". */
const MAX_NAMED_FILES = 6

export interface FormConfirmationInput {
  businessName: string
  request: FormRequest | null
  /** The answers as stored, in the order the form posted them. */
  answers: Readonly<Record<string, string>>
  /** The form's declared fields, for their labels and types. */
  decls: readonly FormFieldDecl[]
  /** The field the form names as its opt-in, when it names one. */
  consentFieldName?: string | null
  /** The names of the files they attached, in order. */
  fileNames: readonly string[]
  /** The site's contact email (its listing's, else its support address). */
  contactEmail: string | null
  /** The phone the site's listing gives, when it gives one. */
  contactPhone: string | null
}

export interface FormConfirmationContent {
  subject: string
  tokens: Record<string, string>
  /** The plain-text twin, for a send with no design to render. */
  text: string
}

/**
 * Links typed into a form, as the confirmation leaves them out. Whoever sends
 * a form chooses the address it goes to, so a copy that kept a link would let
 * a stranger mail anybody a link of their choosing from the site's domain.
 */
const TYPED_LINK = /\b(?:https?:\/\/|www\.)\S+/gi

/** One answer as a line of the details panel: on one line, links out, and not too long. */
function answerLine(label: string, value: string): string {
  const flat = value.replace(TYPED_LINK, '[link]').replace(/\s+/g, ' ').trim()
  const shown =
    flat.length > FORM_CONFIRMATION_MAX_ANSWER_CHARS
      ? `${flat.slice(0, FORM_CONFIRMATION_MAX_ANSWER_CHARS - 1).trimEnd()}…`
      : flat
  return `${label}: ${shown}`
}

/** The answers worth a copy, under the form's labels. */
export function formConfirmationAnswers(input: Pick<FormConfirmationInput, 'answers' | 'decls' | 'consentFieldName'>): string[] {
  const lines: string[] = []
  for (const [key, value] of Object.entries(input.answers)) {
    if (lines.length >= FORM_CONFIRMATION_MAX_ANSWERS) break
    if (key === 'formId' || !String(value ?? '').trim()) continue
    const decl = input.decls.find((entry) => entry?.fieldName === key)
    if (decl?.fieldType === 'file') continue
    if (key === input.consentFieldName || decl?.role === 'consent' || isMarketingConsentFieldName(key)) continue
    const label = (typeof decl?.label === 'string' && decl.label.trim()) || key
    lines.push(answerLine(label, String(value)))
  }
  return lines
}

/** `logo.ai, sketch.pdf and 2 more`. */
function namedFiles(names: readonly string[]): string {
  const shown = names.slice(0, MAX_NAMED_FILES)
  const more = names.length - shown.length
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ')
}

/** The confirmation's tokens and its plain-text twin. */
export function formConfirmationContent(input: FormConfirmationInput): FormConfirmationContent {
  const business = input.businessName.trim() || 'the business'
  const quote = input.request?.kind === 'quote'
  const subject = (quote ? `Your quote request with ${business}` : `We got your message — ${business}`).slice(0, 200)
  const label = quote ? 'Quote request' : 'Your message'
  const heading = quote ? 'We got your request' : 'Thanks, we got your message'
  const intro = quote
    ? `Thanks for asking ${business} for a quote. Here is a copy of what you sent.`
    : `Thanks for getting in touch with ${business}. Here is a copy of what you sent.`
  const answers = formConfirmationAnswers(input)
  const files = input.fileNames.length
    ? `${input.fileNames.length === 1 ? 'The file you sent' : 'Files you sent'}: ${namedFiles(input.fileNames)}`
    : ''
  const nextStep = quote
    ? `${business} will look over your request and email you a quote. Reply to this email if anything changes or you want to add something.`
    : `${business} will get back to you soon. Reply to this email if you want to add anything.`
  const ways = [input.contactEmail, input.contactPhone].map((entry) => String(entry ?? '').trim()).filter(Boolean)
  const contact = ways.length ? `You can also reach ${business} at ${ways.join(' or ')}.` : ''
  const tokens: Record<string, string> = {
    'form.subject': subject,
    'form.name': label,
    'form.heading': heading,
    'form.intro': intro,
    'form.answers': answers.join('\n'),
    'form.files': files,
    'form.nextStep': nextStep,
    'business.contact': contact,
  }
  const text = [heading, intro, answers.join('\n'), files, nextStep, contact].filter(Boolean).join('\n\n')
  return { subject, tokens, text }
}
