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
  AI_OVERLAY_COPY_TASK,
  AI_OVERLAY_CURRENT_MAX_CHARS,
  aiOverlayCopyText,
  aiOverlayKind,
  aiOverlayLimits,
  aiOverlayTriggerRanges,
  checkAiOverlayCopy,
  type AiOverlayCopyProposal,
  type AiOverlayKind,
  type AiOverlayTrigger,
} from '../model/ai-overlay-copy'
import type { AiJob, AiJobOutput } from '../model/ai-jobs.types'
import { AI_ROUTING_TABLE } from '../providers/routing'
import {
  AI_ACCEPTABLE_USE_BLOCK,
  runAiRequest,
  type AiSystemBlock,
} from '../runtime/ai-runtime'
import { AI_OVERLAY_TOOL_NAME, aiOverlayTool, parseAiOverlayCopy } from '../tools/ai-overlay-tool'
import type { AiJobStepOutcome } from './ai-job-text-step'

/**
 * Overlay copy (AGL-3603): the `text` step asked, by `inputs.task: 'overlay'`,
 * for an announcement bar's or a popup's copy as fields rather than prose.
 *
 * A text job rather than a kind of its own because it IS a text job — a brief
 * in, a short piece of copy out, one request at the `job.text` route's model
 * and ceiling — so it runs inline in the create door, is metered as any text
 * job is and needs no plan. Only the answer's shape differs: one strict tool
 * call, held by `checkAiOverlayCopy` to the limits and the triggers the
 * request named.
 *
 * ## Nothing is written
 *
 * The answer is a proposal on the job's output. The overlay is the marketing
 * plugin's; its editor fills its fields from the proposal unsaved, or its list
 * writes a new overlay switched off, and in both a person decides what goes
 * live. No link, schedule, page targeting or on-switch is ever proposed.
 *
 * ## What reaches the model
 *
 * The brief, what the overlay is (a bar or a popup), the triggers the site
 * offers, and — when a person asked from an overlay that has copy — that copy
 * as the editor holds it. Nothing about the site's visitors or its figures.
 */

/** The job's failure when the answer could not be used. */
export const AI_OVERLAY_NO_COPY_COPY =
  'The AI did not write copy that fits this overlay. Try the brief in different words.'

/** The job's failure when the inputs name no overlay kind. */
export const AI_OVERLAY_NO_KIND_COPY = 'Say whether the copy is for an announcement bar or a popup.'

/** The rules, static and byte-identical for every workspace, so they cache. */
export const AI_OVERLAY_RULES = [
  'You write copy for the announcement bars and popups on a small business’s website. A bar is one short line across the top of every page; a popup is a headline, a short body and an optional button, shown once as the visitor reads.',
  `Call ${AI_OVERLAY_TOOL_NAME} once.`,
  '- Lead with what the visitor gets: the offer, the news or the reason to act. One idea per overlay.',
  '- Keep inside every length the tool states. Shorter is better: a bar is read in a glance.',
  '- A button label is a few words that start with a verb.',
  '- For a popup, choose when it opens only from the triggers the request lists, and a value inside the range it gives: a short delay for an announcement, a scroll depth for something a reader earns, exit intent for a last offer. Answer `none` to leave it as it is.',
  '- Write plain text: no HTML, no markdown, no links, no emoji, no fences.',
  '- Never invent a fact, a price, a discount, a deadline, a name or a guarantee the brief or the current copy did not give you; where one is missing, leave a clearly marked placeholder in square brackets.',
  '- Write in the language of the brief.',
].join('\n')

export const AI_OVERLAY_SYSTEM: AiSystemBlock[] = [
  { text: `${AI_OVERLAY_RULES}\n\n${AI_ACCEPTABLE_USE_BLOCK}`, cacheBreakpoint: true },
]

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const TRIGGER_WORDS: Record<AiOverlayTrigger, (range: { min: number; max: number } | null) => string> = {
  delay: (range) => `delay (seconds after the page loads${range ? `, ${range.min} to ${range.max}` : ''})`,
  scroll: (range) => `scroll (percent of the page scrolled${range ? `, ${range.min} to ${range.max}` : ''})`,
  exit: () => 'exit (as the visitor moves to leave)',
}

/** The user turn: the brief, the overlay, its triggers and its copy as it stands. */
export function aiOverlayCopyPrompt(input: {
  brief: string
  kind: AiOverlayKind
  triggers: ReadonlyMap<AiOverlayTrigger, { min: number; max: number } | null>
  current: string
}): string {
  const lines = [`Brief: ${input.brief}`, `Write the copy for ${input.kind === 'bar' ? 'an announcement bar' : 'a popup'}.`]
  if (input.kind === 'popup') {
    lines.push(
      input.triggers.size
        ? `Triggers the site offers: ${[...input.triggers].map(([id, range]) => TRIGGER_WORDS[id](range)).join('; ')}.`
        : 'Leave when it opens as it is: answer `none`.',
    )
  }
  if (input.current) lines.push('', 'The copy as it stands:', input.current)
  return lines.join('\n')
}

/** A checked proposal as the job's output: shown as text, carried as fields. */
export function aiOverlayCopyOutput(
  job: Pick<AiJob, 'hostId' | 'inputs'>,
  proposal: AiOverlayCopyProposal,
): AiJobOutput {
  return {
    resource: 'text',
    id: 'draft',
    hostId: job.hostId ?? null,
    hostSubdomain: str(job.inputs?.['hostSubdomain']) || null,
    label: proposal.kind === 'bar' ? 'Announcement bar copy' : 'Popup copy',
    text: aiOverlayCopyText(proposal),
    proposal: { task: AI_OVERLAY_COPY_TASK, ...proposal },
    note: 'Put this into the overlay editor to use it; nothing has been changed on the site.',
  }
}

/** The overlay task of the text step: one strict tool call, checked, never written. */
export async function runAiOverlayCopy(input: {
  job: Pick<AiJob, '$id' | 'brief' | 'hostId' | 'inputs'>
  model: string
  maxTokens: number
  signal?: AbortSignal
}): Promise<AiJobStepOutcome> {
  const { job, model } = input
  const kind = aiOverlayKind(job.inputs)
  if (!kind) {
    return {
      outputs: [],
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      estCostUsd: 0,
      model,
      stopReason: null,
      failure: AI_OVERLAY_NO_KIND_COPY,
    }
  }
  const limits = aiOverlayLimits(job.inputs)
  const triggers = aiOverlayTriggerRanges(job.inputs)
  const result = await runAiRequest({
    model,
    system: AI_OVERLAY_SYSTEM,
    messages: [
      {
        role: 'user',
        content: aiOverlayCopyPrompt({
          brief: job.brief,
          kind,
          triggers,
          current: str(job.inputs?.['current']).slice(0, AI_OVERLAY_CURRENT_MAX_CHARS),
        }),
      },
    ],
    tools: [aiOverlayTool(kind, limits, [...triggers.keys()])],
    maxTokens: input.maxTokens,
    ...(AI_ROUTING_TABLE['job.text'].thinking ? { thinking: AI_ROUTING_TABLE['job.text'].thinking } : {}),
    ...(AI_ROUTING_TABLE['job.text'].effort ? { effort: AI_ROUTING_TABLE['job.text'].effort } : {}),
    stream: false,
    ...(input.signal ? { signal: input.signal } : {}),
  })
  const spent = {
    usage: result.usage,
    estCostUsd: result.estCostUsd,
    model,
    stopReason: result.stopReason,
  }
  if (result.kind === 'refusal') return { outputs: [], ...spent, refused: true }
  const checked = checkAiOverlayCopy(
    parseAiOverlayCopy(result.toolUse.find((use) => use.name === AI_OVERLAY_TOOL_NAME)?.input),
    kind,
    limits,
    triggers,
  )
  if (!checked) return { outputs: [], ...spent, failure: AI_OVERLAY_NO_COPY_COPY }
  if (checked.findings.length) {
    console.info('ai overlay copy held to its limits', { jobId: job.$id, findings: checked.findings })
  }
  return { outputs: [aiOverlayCopyOutput(job, checked.proposal)], ...spent }
}
