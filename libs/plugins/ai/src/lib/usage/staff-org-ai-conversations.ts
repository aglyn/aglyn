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
 * WHAT A WORKSPACE ASKED AGLYN AI, FOR STAFF (AGL-3675).
 *
 * The staff org page showed what an org's AI cost and how many jobs ran,
 * never what anybody asked or what came back. Those words are kept — an
 * Assist exchange for 180 days, a job's brief and result for as long as the
 * job — and the Privacy policy says they are accessible to us, but nothing
 * read them, so a stalled sign-up's question could only be found in the
 * database by hand.
 *
 * These are the rows the staff card lists, composed from the stored
 * documents by pure functions so the shape is tested without Firestore:
 *
 *  - an Assist row joins `assistExchanges/{id}` (the question, the answer,
 *    who asked) with `assistSignals/{id}` (the console route, the model, the
 *    cost and the thumbs), which share the id by design;
 *  - a job row reads `aiJobs/{id}` (the brief, the kind, the status, the
 *    credits, the outputs) and, for the kinds whose result is kept beside
 *    the job rather than as a draft, that result: an insight's answer or a
 *    CRM answer.
 *
 * The text is shown to the staff member who asked for it and goes nowhere
 * else. The audit row the route writes says that it was read, never what.
 *==========================================*/

/** Rows a page lists; the route asks for one more to learn whether there is a next page. */
export const STAFF_AI_CONVERSATIONS_PAGE = 25

/** The two lists the card switches between. */
export const STAFF_AI_CONVERSATION_KINDS = ['assist', 'jobs'] as const
export type StaffAiConversationKind = (typeof STAFF_AI_CONVERSATION_KINDS)[number]

export function isStaffAiConversationKind(value: unknown): value is StaffAiConversationKind {
  return typeof value === 'string' && (STAFF_AI_CONVERSATION_KINDS as readonly string[]).includes(value)
}

/** Who a row is from, as the org's member list names them. */
export interface StaffAiConversationPerson {
  uid: string | null
  email: string | null
  name: string | null
}

export interface StaffAiAssistRow {
  id: string
  /** The organization the exchange is filed under (AGL-3660). */
  orgId: string | null
  at: string | null
  by: StaffAiConversationPerson
  hostId: string | null
  /** The console route the question was asked from; `null` once the signal is gone or never said. */
  route: string | null
  question: string
  answer: string
  model: string | null
  estCostUsd: number | null
  /** The thumbs the person gave: `up`, `down` or `null`. */
  feedback: 'up' | 'down' | null
}

/** One thing a job made, as its output names it. */
export interface StaffAiJobOutputRow {
  label: string
  note: string | null
  resource: string | null
  hostSubdomain: string | null
}

/** One field a job's creator filled in, as staff read it. */
export interface StaffAiJobInput {
  key: string
  label: string
  value: string
}

/** A result kept beside the job rather than as a draft. */
export type StaffAiJobResult =
  | { kind: 'insight'; insights: string[]; gap: string | null }
  | { kind: 'crm-record'; summary: string; nextStep: string | null; standing: string | null }
  | { kind: 'crm-email'; subject: string; body: string }
  | { kind: 'crm-mapping'; matches: string[] }

export interface StaffAiJobRow {
  id: string
  /** The organization the job is filed under (AGL-3660). */
  orgId: string | null
  at: string | null
  by: StaffAiConversationPerson
  hostId: string | null
  kind: string
  status: string
  brief: string
  /**
   * What the person filled in beside the brief (AGL-3660) — the guided
   * start's form fields, a tone, a page to edit — as label and value.
   */
  inputs: StaffAiJobInput[]
  credits: number
  error: string | null
  outputs: StaffAiJobOutputRow[]
  /** `null` when the kind keeps nothing beside the job, or the result has expired. */
  result: StaffAiJobResult | null
}

export interface StaffAiConversationsResponse {
  kind: StaffAiConversationKind
  rows: StaffAiAssistRow[] | StaffAiJobRow[]
  /** The id to pass as `after` for the next page; `null` on the last. */
  next: string | null
}

type Data = Record<string, unknown>

const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null)
const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/** A stored time as ISO: a Firestore timestamp, a `Date`, milliseconds or an ISO string. */
export function staffAiConversationTime(value: unknown): string | null {
  if (value == null) return null
  if (typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString()
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString()
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString()
  return null
}

/** The person a uid is, from `orgs/{org}/members/{uid}` documents keyed by uid. */
export function staffAiConversationPerson(
  uid: unknown,
  members: ReadonlyMap<string, Data>,
): StaffAiConversationPerson {
  const id = typeof uid === 'string' && uid ? uid : null
  const member = id ? members.get(id) : undefined
  return {
    uid: id,
    email: textOrNull(member?.['email']),
    name: textOrNull(member?.['displayName']),
  }
}

/** One Assist exchange joined with its signal, which may already be gone or never have been written. */
export function composeStaffAiAssistRow(
  id: string,
  exchange: Data,
  signal: Data | null,
  members: ReadonlyMap<string, Data>,
): StaffAiAssistRow {
  const feedback = signal?.['feedback']
  return {
    id,
    orgId: textOrNull(exchange['orgId']),
    at: staffAiConversationTime(exchange['createdAt']),
    by: staffAiConversationPerson(exchange['uid'], members),
    hostId: textOrNull(exchange['hostId']),
    route: textOrNull(signal?.['route']),
    question: text(exchange['question']),
    answer: text(exchange['answer']),
    model: textOrNull(signal?.['model']),
    estCostUsd: finite(signal?.['estCostUsd']),
    feedback: feedback === 'up' || feedback === 'down' ? feedback : null,
  }
}

/** An insight's kept answer, as `aiInsights/{jobId}` stores it. */
export function staffAiInsightResult(record: Data | null): StaffAiJobResult | null {
  if (!record) return null
  const insights = Array.isArray(record['insights'])
    ? (record['insights'] as Data[]).map((insight) => text(insight?.['text'])).filter(Boolean)
    : []
  return { kind: 'insight', insights, gap: textOrNull(record['gap']) }
}

/** A CRM answer, as `aiCrmAnswers/{jobId}` stores it, by the proposal it holds. */
export function staffAiCrmResult(record: Data | null): StaffAiJobResult | null {
  const proposal = record?.['proposal'] as Data | undefined
  if (!proposal) return null
  switch (proposal['kind']) {
    case 'record': {
      const nextStep = proposal['nextStep'] as Data | null | undefined
      const title = textOrNull(nextStep?.['title'])
      const reason = textOrNull(nextStep?.['reason'])
      return {
        kind: 'crm-record',
        summary: text(proposal['summary']),
        nextStep: title ? (reason ? `${title} — ${reason}` : title) : null,
        standing: textOrNull(proposal['standing']),
      }
    }
    case 'email':
      return { kind: 'crm-email', subject: text(proposal['subject']), body: text(proposal['body']) }
    case 'mapping':
      return {
        kind: 'crm-mapping',
        matches: Array.isArray(proposal['matches'])
          ? (proposal['matches'] as Data[]).map((match) => `${text(match?.['header'])} → ${text(match?.['label'])}`)
          : [],
      }
    default:
      return null
  }
}

/** The collection a job kind keeps its result beside the job in, or `null` for a kind whose result is a draft. */
export function staffAiJobResultCollection(kind: unknown): 'aiInsights' | 'aiCrmAnswers' | null {
  if (kind === 'insight') return 'aiInsights'
  if (kind === 'crm') return 'aiCrmAnswers'
  return null
}

/** Fields read off one job's inputs, at most. */
export const STAFF_AI_JOB_INPUTS_MAX = 40
/** Characters of one field's value shown. */
const INPUT_VALUE_MAX = 2000

/** `businessName` → `Business name`. */
function inputLabel(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_.-]+/g, ' ')
    .trim()
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function inputValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.trim() ? value : null
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const parts = value.map(inputValue).filter((part): part is string => Boolean(part))
    return parts.length ? parts.join(', ') : null
  }
  return null
}

/**
 * What a job's creator filled in beside the brief (AGL-3660), as fields:
 * scalars and lists as written, one level of a nested object flattened to
 * `parent child`. A value is cut at {@link INPUT_VALUE_MAX} characters.
 */
export function staffAiJobInputs(inputs: unknown): StaffAiJobInput[] {
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return []
  const out: StaffAiJobInput[] = []
  const push = (key: string, raw: unknown) => {
    if (out.length >= STAFF_AI_JOB_INPUTS_MAX) return
    const value = inputValue(raw)
    if (value === null) return
    out.push({
      key,
      label: inputLabel(key),
      value: value.length > INPUT_VALUE_MAX ? `${value.slice(0, INPUT_VALUE_MAX)}…` : value,
    })
  }
  for (const [key, raw] of Object.entries(inputs as Data)) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [child, nested] of Object.entries(raw as Data)) push(`${key}.${child}`, nested)
    } else {
      push(key, raw)
    }
  }
  return out
}

/** One job, with the result kept beside it when its kind keeps one. */
export function composeStaffAiJobRow(
  id: string,
  job: Data,
  result: StaffAiJobResult | null,
  members: ReadonlyMap<string, Data>,
): StaffAiJobRow {
  const outputs = Array.isArray(job['outputs']) ? (job['outputs'] as Data[]) : []
  return {
    id,
    orgId: textOrNull(job['orgId']),
    at: staffAiConversationTime(job['createdAt']),
    by: staffAiConversationPerson(job['createdBy'], members),
    hostId: textOrNull(job['hostId']),
    kind: text(job['kind']) || 'unknown',
    status: text(job['status']) || 'unknown',
    brief: text(job['brief']),
    inputs: staffAiJobInputs(job['inputs']),
    credits: finite(job['creditsSpent']) ?? 0,
    error: textOrNull(job['error']),
    outputs: outputs.map((output) => ({
      label: text(output?.['label']) || text(output?.['resource']) || 'Output',
      note: textOrNull(output?.['note']),
      resource: textOrNull(output?.['resource']),
      hostSubdomain: textOrNull(output?.['hostSubdomain']),
    })),
    result,
  }
}
