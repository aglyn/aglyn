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

import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import type {
  AiJob,
  AiJobOutput,
  AiJobPlan,
  AiJobReview,
} from '../model/ai-jobs.types'
import type { AiStepKind } from '../providers/catalog'
import { aiModelForStep } from '../providers/routing'
import { runAiRequest, type AiSystemBlock } from '../runtime/ai-runtime'
import type { AssistTokenUsage } from '../usage/assist-usage'

/**
 * The `text` step (AGL-2904): a brief in, a short piece of copy out.
 *
 * The one step kind this issue ships for real, so the state machine — the
 * lease, the reservation, the record, the beat — is exercised end to end by
 * something that spends tokens, rather than by a stub that could pass with
 * the meter unplugged. Every other kind refuses until its own issue lands.
 *
 * The balanced tier with adaptive thinking: a brief is open-ended in a way the copy
 * assistant's element mode is not, and the cost is one call per job. The
 * static system block is cached; the brief rides in the user turn, so no
 * per-org byte sits inside the cached prefix (AGL-2352, enforced by the
 * runtime before the request leaves).
 */

/** The model the text step runs on: the routing table's answer for `job.text`. */
export function aiJobTextModel(): string {
  return aiModelForStep('job.text')
}

/** Enough for a few paragraphs; a brief asking for more gets a draft to extend. */
export const AI_JOB_TEXT_MAX_TOKENS = 1024

/** How much of a brief is sent. Past this a brief is a document, not a brief. */
export const AI_JOB_BRIEF_MAX_CHARS = 4_000

/**
 * What a step hands back to the machine. The machine meters `usage` at
 * `model`'s rates, records the step and appends the outputs; a step never
 * touches the job document or the meter itself.
 */
export interface AiJobStepOutcome {
  outputs: AiJobOutput[]
  /**
   * The step made progress and has more of the same work to do (AGL-2910):
   * a site audit works through its pages a batch at a time. The machine
   * records this pass — its spend and its outputs — and hands the SAME step
   * back to run again, so every pass is one reservation and one provider
   * exchange, and the job document says how far it got.
   */
  continue?: boolean
  usage: AssistTokenUsage
  estCostUsd: number
  model: string
  stopReason: string | null
  /** The model declined the brief (`stop_reason: 'refusal'`). Tokens were spent. */
  refused?: boolean
  /**
   * The model answered and nothing usable came of it — no structured answer
   * even after the step's own re-ask, say (AGL-2938). Tokens were spent, so
   * the machine meters the step before it fails the job with this sentence,
   * which is customer-safe and the only thing a customer reads.
   */
  failure?: string
  /** The plan the plan step proposed, which the machine keeps on the job (AGL-2935). */
  plan?: AiJobPlan
  /**
   * The step stopped for a person (AGL-2935). The machine records what it
   * spent and parks the job `needs_review`: a `plan` review completes the
   * step, so confirming runs the next one; a `doctrine` review hands the
   * step back, so trying again runs the same one.
   */
  review?: AiJobReview
}

export interface AiJobStepContext {
  job: AiJob
  stepIndex: number
  now: Date
  /** Aborts the provider call when the runner's budget ends. */
  signal?: AbortSignal
  /**
   * The Admin SDK handle the machine runs on, for a step that reads what it
   * builds from — a site's theme, say — or writes a draft. A step never
   * writes the job document, the meter or the lease through it.
   */
  firestore: FirebaseFirestore.Firestore
  /** The org document the machine read for the step's reservation. */
  org?: Partial<AglynOrgBilling> | null
  /**
   * The model a step of this kind runs on for THIS job (AGL-2942): the
   * creator's pick where the plan and the allotment allowlists allow it,
   * the routing table otherwise. Absent, a runner asks the table itself.
   */
  modelFor?: (kind: AiStepKind) => string | undefined
}

export type AiJobStepRunner = (
  context: AiJobStepContext,
) => Promise<AiJobStepOutcome>

/**
 * The static block, byte-identical on every request so it caches. The
 * customer's brief and the org's inputs never enter it.
 */
export const AI_JOB_TEXT_SYSTEM: AiSystemBlock[] = [
  {
    text:
      'You write short, publishable copy for a website builder. You are ' +
      'given a brief from the person who owns the site. Answer with the ' +
      'copy only: no preamble, no headings unless the brief asks for them, ' +
      'no closing remarks, no markdown fences. Keep to the length the brief ' +
      'implies; when it implies none, write under 150 words. Write in the ' +
      'language of the brief. Never invent facts, prices, names or claims ' +
      'the brief did not give you; where a detail is missing, leave a ' +
      'clearly marked placeholder in square brackets.',
    cacheBreakpoint: true,
  },
]

/** The brief as the user turn, with the kind-specific inputs stated plainly. */
export function aiJobTextPrompt(job: Pick<AiJob, 'brief' | 'inputs'>): string {
  const brief = job.brief.slice(0, AI_JOB_BRIEF_MAX_CHARS)
  const tone = typeof job.inputs?.['tone'] === 'string' ? job.inputs['tone'] : ''
  const audience =
    typeof job.inputs?.['audience'] === 'string' ? job.inputs['audience'] : ''
  const lines = [`Brief: ${brief}`]
  if (tone) lines.push(`Tone: ${tone}`)
  if (audience) lines.push(`Audience: ${audience}`)
  return lines.join('\n')
}

export const runAiJobTextStep: AiJobStepRunner = async ({ job, signal, modelFor }) => {
  const model = modelFor?.('job.text') ?? aiJobTextModel()
  const result = await runAiRequest({
    model,
    system: AI_JOB_TEXT_SYSTEM,
    messages: [{ role: 'user', content: aiJobTextPrompt(job) }],
    maxTokens: AI_JOB_TEXT_MAX_TOKENS,
    thinking: 'adaptive',
    stream: false,
    ...(signal ? { signal } : {}),
  })
  if (result.kind === 'refusal') {
    return {
      outputs: [],
      usage: result.usage,
      estCostUsd: result.estCostUsd,
      model,
      stopReason: result.stopReason,
      refused: true,
    }
  }
  const text = result.text.trim()
  return {
    outputs: text
      ? [
          {
            resource: 'text',
            // A text output has no document of its own; the id names the
            // step within the job so a later step can address it.
            id: 'draft',
            hostId: job.hostId ?? null,
            label: 'Draft copy',
            text,
          },
        ]
      : [],
    usage: result.usage,
    estCostUsd: result.estCostUsd,
    model,
    stopReason: result.stopReason,
  }
}
