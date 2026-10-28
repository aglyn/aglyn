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
  AI_JOB_ACTIVE_STATUSES,
  AI_JOB_PHASE_LABELS,
  aiJobKindNoun,
  aiJobPhase,
} from '../model/ai-job-activity'
import { AI_SITE_BUILD_HREF } from '../model/ai-job-notice'
import { AI_JOB_AUTO_CONFIRM_INPUT } from '../model/ai-site-job'
import type {
  AiJobKind,
  AiJobReviewReason,
  AiJobStatus,
  AiJobStepStatus,
} from '../model/ai-jobs.types'
import { sanitiseId } from './assist-view-context'

/**
 * What the Assist chat is told about the workspace it is asked in
 * (AGL-4075): the plan the workspace is on, by the name its badges use, and
 * the AI jobs still open in it, so "where is my build" and "is my plan
 * ready" are answered from the jobs rather than guessed.
 *
 * Per workspace and per moment, so the block rides after every cache
 * breakpoint, as the brand does.
 *
 * What a job contributes is deliberately small. Its kind, its site (this one,
 * another, or none), when it last moved, where it stands, and what it waits
 * for. The opening of its brief, the one piece of text a person wrote, is
 * kept only for the asker's own jobs: a teammate's brief is theirs, and the
 * asker is told only that a teammate's job of that kind is open.
 */

/** The most open jobs one turn is told about: one bounded read, newest first. */
export const ASSIST_OPEN_JOBS_LIMIT = 6

/** How much of the asker's own brief names a job in the block. */
const OWN_BRIEF_CHARS = 60

/** The fields the read asks Firestore for; nothing else of a job is read. */
export const ASSIST_OPEN_JOB_FIELDS: readonly string[] = [
  'kind',
  'status',
  'hostId',
  'createdBy',
  'updatedAt',
  'steps',
  'review.reason',
  'input.message',
  `inputs.${AI_JOB_AUTO_CONFIRM_INPUT}`,
  'brief',
]

/** One open job, as the block reads it. */
export interface AssistOpenJob {
  id: string
  kind: AiJobKind
  status: AiJobStatus
  hostId: string | null
  /** Whether the person asking started it. */
  own: boolean
  updatedAtMs: number | null
  reviewReason: AiJobReviewReason | null
  /** A `needs_input` job that waits for an answer only a person can give. */
  asksInput: boolean
  /** A guided start, whose plan the machine confirms itself. */
  autoConfirm: boolean
  steps: Array<{ name: string; status: AiJobStepStatus }>
  /** The opening of the brief, on the asker's own job only; `null` on every other. */
  brief: string | null
}

/** An instant as milliseconds, from a Firestore timestamp, a Date, an ISO string or a number. */
function millisOf(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (value instanceof Date) return value.getTime()
  const toMillis = (value as { toMillis?: () => number }).toMillis
  if (typeof toMillis === 'function') return toMillis.call(value)
  return null
}

/** A brief's opening on one line, with nothing that could close the quotes it sits in. */
function briefOpening(brief: unknown): string | null {
  const flat = String(brief ?? '')
    .replace(/["“”`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  if (!flat) return null
  return flat.length > OWN_BRIEF_CHARS ? `${flat.slice(0, OWN_BRIEF_CHARS).trimEnd()}…` : flat
}

/** One stored job as the block reads it; the brief survives only on the asker's own. */
export function assistOpenJobFrom(id: string, data: Record<string, unknown>, uid: string): AssistOpenJob {
  const review = data['review'] as { reason?: unknown } | null | undefined
  const input = data['input'] as { message?: unknown } | null | undefined
  const inputs = data['inputs'] as Record<string, unknown> | null | undefined
  const own = Boolean(uid) && data['createdBy'] === uid
  const steps = Array.isArray(data['steps']) ? (data['steps'] as Array<Record<string, unknown>>) : []
  return {
    id,
    kind: String(data['kind'] ?? '') as AiJobKind,
    status: String(data['status'] ?? '') as AiJobStatus,
    hostId: typeof data['hostId'] === 'string' && data['hostId'] ? data['hostId'] : null,
    own,
    updatedAtMs: millisOf(data['updatedAt']),
    reviewReason: typeof review?.reason === 'string' ? (review.reason as AiJobReviewReason) : null,
    asksInput: Boolean(input?.message),
    autoConfirm: inputs?.[AI_JOB_AUTO_CONFIRM_INPUT] === true,
    steps: steps.map((step) => ({
      name: String(step?.['name'] ?? ''),
      status: String(step?.['status'] ?? 'pending') as AiJobStepStatus,
    })),
    brief: own ? briefOpening(data['brief']) : null,
  }
}

/**
 * The workspace's open jobs, newest first: ONE read, on the (status,
 * createdAt) index the console's AI jobs indicator already uses, bounded to
 * {@link ASSIST_OPEN_JOBS_LIMIT} and to {@link ASSIST_OPEN_JOB_FIELDS}.
 * Throws when Firestore does; the caller leaves the jobs out of the turn.
 */
export async function readAssistOpenJobs(
  firestore: FirebaseFirestore.Firestore,
  input: { orgId: string; uid: string },
): Promise<AssistOpenJob[]> {
  const snapshot = await firestore
    .collection('orgs')
    .doc(input.orgId)
    .collection('aiJobs')
    .where('status', 'in', [...AI_JOB_ACTIVE_STATUSES])
    .orderBy('createdAt', 'desc')
    .limit(ASSIST_OPEN_JOBS_LIMIT)
    .select(...ASSIST_OPEN_JOB_FIELDS)
    .get()
  return snapshot.docs.map((doc) => assistOpenJobFrom(doc.id, (doc.data() ?? {}) as Record<string, unknown>, input.uid))
}

/** When a job last moved, in the words a person would use. */
function movedAgo(updatedAtMs: number | null, now: number): string {
  if (updatedAtMs === null) return ''
  const minutes = Math.max(0, Math.floor((now - updatedAtMs) / 60_000))
  if (minutes < 5) return 'updated just now'
  if (minutes < 60) return `updated ${minutes} minutes ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `updated ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  return `updated ${Math.floor(hours / 24)} days ago`
}

/** Where one open job stands and what it waits for, in one short sentence. */
function standing(job: AssistOpenJob): string {
  const phase = aiJobPhase({
    status: job.status,
    review: job.reviewReason ? { reason: job.reviewReason } : null,
    steps: job.steps,
    autoConfirm: job.autoConfirm,
    updatedAt: job.updatedAtMs === null ? undefined : new Date(job.updatedAtMs).toISOString(),
  })
  const label = AI_JOB_PHASE_LABELS[phase]
  const who = job.own ? 'the user' : 'the teammate who started it'
  if (phase === 'plan-ready') {
    return `${label}: nothing is built until ${who} chooses Confirm plan on it.`
  }
  if (phase === 'queued') return `${label}: it starts in a moment.`
  if (phase === 'planning') return `${label}: working out what to build.`
  if (phase === 'building') return `${label}.`
  if (job.status === 'needs_input') {
    return job.asksInput
      ? `${label}: it needs one detail from ${who} before it can build.`
      : 'Paused for AI credits or a cap. Nothing is lost: Resume carries it on once there are credits, or it carries on by itself.'
  }
  switch (job.reviewReason) {
    case 'doctrine':
      return `${label}: it could not build this cleanly, so it stopped. Try again is on the job.`
    case 'limit':
      return `${label}: the site is at an allowance its plan sets. Try again runs it once there is room.`
    case 'wave':
      return 'Ready for review: the imported pages wait to be reviewed before the next wave starts.'
    case 'ownership':
      return `${label}: the site's ownership must be verified again before the next wave.`
    default:
      return `${label}: open it in AI jobs to see why.`
  }
}

/** Where the person is: the workspace slug and the site segment of the console path, when it has them. */
export interface AssistJobsHere {
  /** The console path's first segment, when it is a workspace's. */
  orgSlug: string
  /** The site segment of a `/[orgSlug]/hosts/[host]/…` path; empty off a site. */
  hostSegment: string
  /** The site (host) document id the page named. */
  hostId: string
}

/** One job's line. A job on the site the user has open links its own page there. */
function jobLine(job: AssistOpenJob, here: AssistJobsHere, now: number): string {
  const noun = aiJobKindNoun(job.kind)
  const what = noun === 'AI job' ? 'AI job' : `${noun} job`
  const owner = job.own ? `The user's ${what}` : `A teammate's ${what}`
  const brief = job.brief ? ` "${job.brief}"` : ''
  const onThisSite = Boolean(job.hostId && here.hostId && job.hostId === here.hostId)
  const where = job.hostId ? (onThisSite ? ' on this site' : ' on another site') : ''
  const ago = movedAgo(job.updatedAtMs, now)
  const id = sanitiseId(job.id)
  const page =
    onThisSite && here.orgSlug && here.hostSegment && id
      ? ` Its page: /${here.orgSlug}/hosts/${here.hostSegment}${AI_SITE_BUILD_HREF}/${id}`
      : ''
  return `- ${owner}${brief}${where}${ago ? `, ${ago}` : ''}: ${standing(job)}${page}`
}

/**
 * The workspace block: the plan's name for every workspace, Free included,
 * and, when the jobs were read, the open ones or a line saying there are
 * none. `jobs` is `null` when they were not read (a workspace without AI
 * jobs, or a read that failed), and the block then says nothing about jobs.
 */
export function assistWorkspaceBlock(input: {
  plan: string
  jobs: readonly AssistOpenJob[] | null
  here: AssistJobsHere
  now?: number
}): string {
  const now = input.now ?? Date.now()
  const lines: string[] = []
  if (input.plan) lines.push(`This workspace is on the ${input.plan} plan.`)
  if (input.jobs) {
    if (!input.jobs.length) {
      lines.push('No AI jobs are open in this workspace. Finished ones are on each site’s AI jobs page.')
    } else {
      const more = input.jobs.length >= ASSIST_OPEN_JOBS_LIMIT ? ` (the newest ${ASSIST_OPEN_JOBS_LIMIT})` : ''
      lines.push(
        `Open AI jobs in this workspace${more}, newest first. The user sees them under AI jobs at the top of this Assist panel:`,
      )
      for (const job of input.jobs) lines.push(jobLine(job, input.here, now))
    }
  }
  return lines.join('\n')
}

/** Where the person is, from the sanitised console path and the site the page named. */
export function assistJobsHere(route: string, hostId: string, orgless: ReadonlySet<string>): AssistJobsHere {
  const parts = route.split('/').filter(Boolean)
  const first = parts[0] ?? ''
  const orgSlug = first && !orgless.has(first) ? sanitiseId(first) : ''
  const hostSegment = parts[1] === 'hosts' ? sanitiseId(parts[2] ?? '') : ''
  return { orgSlug, hostSegment, hostId: sanitiseId(hostId) }
}

/**
 * Questions about the workspace's own plan, which the docs cannot answer:
 * they describe every plan, and only the workspace block says which one this
 * is.
 */
const PLAN_STATE_PATTERNS: readonly RegExp[] = [
  /\bwhat\s+plan\b/i,
  /\bwhich\s+plan\s+(?:am|are|is)\b/i,
  /\b(?:my|our|current)\s+(?:plan|subscription)\b/i,
  /\bplan\s+(?:am\s+i|are\s+we)\s+on\b/i,
]

/**
 * Questions about the workspace's own AI jobs, which the docs cannot answer
 * either: where a build is, whether it is done, what it waits for.
 */
const JOB_STATE_PATTERNS: readonly RegExp[] = [
  /\bai\s+jobs?\b/i,
  /\b(?:my|our)\s+(?:ai\s+)?(?:builds?|jobs?)\b/i,
  /\b(?:built|ready|done|finished)\s+yet\b/i,
  /\b(?:is|are)\s+(?:it|they)\s+(?:built|ready|done|finished)\b/i,
  /\bconfirm\s+(?:the|my|our)\s+plan\b/i,
  /\bplan\s+(?:is\s+)?ready\b/i,
]

/**
 * Whether a question asks about the workspace's own state (AGL-4075) — its
 * plan, or its AI jobs where the workspace has them — which only this turn's
 * workspace block answers. Such a question is never answered with a docs
 * quote: "what plan am I on" quoted the pricing page, and "is my about page
 * built yet" quoted the AI jobs guide, while the turn knew the answer.
 */
export function assistAsksAboutItsWorkspace(question: string, input: { jobs: boolean }): boolean {
  const text = String(question ?? '')
  if (PLAN_STATE_PATTERNS.some((pattern) => pattern.test(text))) return true
  return input.jobs && JOB_STATE_PATTERNS.some((pattern) => pattern.test(text))
}
