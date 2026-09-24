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
 * WHAT THE AI IS ASKED, WHEN IT DRAFTS ONE PERSON'S EMAILS (AGL-3324).
 *
 * A sequence's step is one template for everyone plus the personal line.
 * Curating asks the workspace's AI for this one person's copy of each email
 * step: the step's own words as the skeleton, the person's record as the
 * facts, the rep's personal line as the reason for writing now. What comes
 * back is a draft the member reads, edits and confirms — never a send.
 *
 * ## The playbook rides in the standing instructions
 *
 * The outbound playbook's rules a sequence author is trusted with, an AI
 * draft is not: list price and never a discount, a cohort, a slot count or a
 * deadline; no invented anecdotes or statistics; one link at most, and only
 * the link the step already carries; plain text; the footer left to the
 * composer, which appends it to every email. They are stated here, and the
 * validator (`sequence-validation.ts`) refuses a draft that breaks one
 * anyway, because an instruction is not a guarantee.
 *
 * The standing block is byte-identical from one call to the next, so a
 * provider that caches a prefix can; everything about the person rides in
 * the prompt. Pure and client-safe: the route builds the prompt, the stored
 * override keeps it for the audit log, and a spec pins the words.
 *==========================================*/

/** The standing instructions. Kept as one string so it caches as a prefix. */
export const OUTREACH_CURATION_SYSTEM = [
  'You draft one-to-one sales emails for a person on a sales team, one person at a time.',
  'You are given the emails of a sequence as its author wrote them, the facts a CRM holds about one recipient, and a sentence the sender wrote about why they are writing to this recipient now.',
  'Rewrite each email for this one recipient. Keep the author’s structure, intent, length and voice; make it read as though the sender wrote it for this person, using the facts given.',
  'Rules, which the emails are checked against before anything is kept:',
  '- Plain text only. No markdown, no HTML, no bold, no headings, no bullet symbols.',
  '- One link at most in an email, and only a link the author’s email already carries, unchanged. Never add a link.',
  '- List price only. Never a discount, a coupon, a promo code, a cohort, a slot count, a deadline or “limited time”.',
  '- Never invent facts, anecdotes, statistics, customer names, results or claims. Use only the facts given; where a fact is missing, leave it out rather than guess. No placeholders in brackets.',
  '- Do not write a signature block, a postal address, a company footer or an unsubscribe line. They are appended by the system.',
  '- Keep any {{merge.field}} token the author used for the sender ({{sender.firstName}}, {{sender.name}}) exactly as written. You may write the recipient’s own name and company directly.',
  '- An email marked as a reply in the thread has no subject: answer it with an empty subject.',
  '- Never mention that an AI drafted the email.',
  'Answer with JSON only, no code fence and no commentary: {"steps":[{"stepIndex":<number>,"subject":"<text>","body":"<text>"}]} — one entry per email given, in the order given, with the body’s line breaks as \\n.',
].join('\n')

/** The most of a lead's notes the prompt carries. */
export const OUTREACH_CURATION_NOTES_MAX = 600

/** What the CRM holds about the person, as the prompt states it. */
export interface OutreachCurationFacts {
  name: string
  email: string
  company: string
  title: string
  website: string
  tags: readonly string[]
  /** How the person came to the workspace: a form, an import, a booking. */
  sources: readonly string[]
  /** The campaigns the person is filed under, by name. */
  campaigns: readonly string[]
  /** A lead's notes, when it has any. */
  notes: string
  /** Whether the person is a lead or a contact. */
  record: 'lead' | 'contact'
  siteName: string
  /** The sender, as the mailbox names them. */
  senderName: string
  personalLine: string
}

/** One email step as the prompt states it. */
export interface OutreachCurationStep {
  stepIndex: number
  /** Which email this is, one-based, of how many the sequence sends. */
  position: number
  count: number
  subject: string
  body: string
  /** Whether the email starts a thread; an in-thread email is answered with no subject. */
  startsThread: boolean
}

const clean = (value: unknown): string => String(value ?? '').replace(/\s+/g, ' ').trim()

function factLines(facts: OutreachCurationFacts): string[] {
  const lines: string[] = []
  const fact = (label: string, value: string) => {
    const text = clean(value)
    if (text) lines.push(`${label}: ${text}`)
  }
  fact('Name', facts.name)
  fact('Email', facts.email)
  fact('Company', facts.company)
  fact('Title', facts.title)
  fact('Website', facts.website)
  if (facts.tags.length) lines.push(`Tags: ${facts.tags.map(clean).filter(Boolean).join(', ')}`)
  if (facts.sources.length) lines.push(`How they came to us: ${facts.sources.map(clean).filter(Boolean).join(', ')}`)
  if (facts.campaigns.length) lines.push(`Campaigns: ${facts.campaigns.map(clean).filter(Boolean).join(', ')}`)
  const notes = String(facts.notes ?? '').trim()
  if (notes) lines.push(`Notes: ${notes.slice(0, OUTREACH_CURATION_NOTES_MAX)}`)
  lines.push(`Record: ${facts.record === 'lead' ? 'a lead' : 'a contact'}`)
  return lines
}

/** The prompt: the sender, the person, the reason, and each email as written. */
export function outreachCurationPrompt(
  facts: OutreachCurationFacts,
  steps: readonly OutreachCurationStep[],
): string {
  const parts: string[] = []
  parts.push(`Sender: ${clean(facts.senderName) || 'the sender'}${clean(facts.siteName) ? ` at ${clean(facts.siteName)}` : ''}`)
  parts.push('')
  parts.push('Recipient:')
  parts.push(...factLines(facts))
  parts.push('')
  const line = clean(facts.personalLine)
  parts.push(`Why the sender is writing now: ${line || '(the sender wrote no personal line)'}`)
  parts.push('')
  parts.push(`Emails to rewrite (${steps.length} of the sequence’s ${steps[0]?.count ?? steps.length}):`)
  for (const step of steps) {
    parts.push('')
    parts.push(
      `--- Email ${step.position} of ${step.count} · stepIndex ${step.stepIndex} · ${
        step.startsThread ? 'starts the thread' : 'a reply in the thread (no subject)'
      } ---`,
    )
    if (step.startsThread) parts.push(`Subject: ${step.subject}`)
    parts.push('Body:')
    parts.push(step.body)
  }
  return parts.join('\n')
}

/** One drafted email, as the answer named it. */
export interface OutreachCurationDraft {
  stepIndex: number
  /** `null` for an in-thread email, which has none. */
  subject: string | null
  body: string
}

/**
 * The drafts in the model's answer, one per step asked for, or `null` when
 * the answer is not what was asked for. A code fence around the JSON is
 * forgiven; a step the answer left out, or named twice, is not — the member
 * would be shown a draft for one email and a template for another without
 * knowing which the model skipped.
 */
export function parseOutreachCurationAnswer(
  text: string,
  steps: readonly OutreachCurationStep[],
): OutreachCurationDraft[] | null {
  const raw = String(text ?? '').trim()
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = unfenced.indexOf('{')
  const end = unfenced.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(unfenced.slice(start, end + 1))
  } catch {
    return null
  }
  const entries = (parsed as { steps?: unknown } | null)?.steps
  if (!Array.isArray(entries)) return null
  const byIndex = new Map<number, OutreachCurationDraft>()
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') return null
    const record = entry as Record<string, unknown>
    const stepIndex = Number(record['stepIndex'])
    const step = steps.find((candidate) => candidate.stepIndex === stepIndex)
    if (!step || byIndex.has(stepIndex)) return null
    const body = typeof record['body'] === 'string' ? record['body'].replace(/\r\n?/g, '\n').trim() : ''
    const subject = step.startsThread && typeof record['subject'] === 'string' ? clean(record['subject']) : null
    byIndex.set(stepIndex, { stepIndex, subject, body })
  }
  if (byIndex.size !== steps.length) return null
  return steps.map((step) => byIndex.get(step.stepIndex) as OutreachCurationDraft)
}
