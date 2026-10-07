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
import {
  ASSIST_BUILD_ACTION_ID,
  ASSIST_BUILD_SUMMARY_MAX_CHARS,
  ASSIST_BUILD_TOOL_NAME,
  type AssistBuildProposal,
} from '../model/assist-build'
import type { AiTool } from '../providers/contract'
import { aiBuildIntents, aiBuildOps } from '../jobs/ai-build-capabilities'
import { aiBuildFreeTaste } from '../jobs/ai-job-build-step'
import { AI_JOB_BRIEF_MAX_CHARS } from '../jobs/ai-job-text-step'
import { aiJobStepRunnerFor } from '../jobs/ai-jobs'

/**
 * The chat's build rung (AGL-3616): on a site, a request that names things
 * to make — "a few new pages, a booking form and a contact form, then an
 * about page" — is proposed as ONE build through a strict tool. The tool
 * carries the request, not a plan: planning is the build job's own plan
 * step, against the site's real inventory, with its re-ask and its limits.
 * The panel starts that job and shows its plan card with one price; nothing
 * is built until the person confirms it, and what is built is a draft unless
 * they asked to publish and tick the card's box.
 */

const STRING = { type: 'string' } as const

/** The strict tool the model proposes a build through. */
export function assistBuildTool(): AiTool {
  return {
    name: ASSIST_BUILD_TOOL_NAME,
    description:
      'Propose building what the user asked for on this site: pages, a header ' +
      'and footer, forms and the other things listed. The user sees a plan with ' +
      'its price and confirms it before anything is made. Call at most once per ' +
      'message, with the whole request.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: STRING,
        brief: STRING,
        publish: { type: 'boolean' },
      },
      required: ['summary', 'brief', 'publish'],
      additionalProperties: false,
    },
    strict: true,
  }
}

/**
 * The build protocol — the same for every site, so it sits inside the cached
 * prefix. What a build can make on THIS site is per site and rides
 * `assistBuildIntentsBlock`, after every breakpoint.
 */
export function assistBuildBlock(): string {
  return [
    'Building on this site:',
    `- When the user asks you to make or set up things on their site — pages, a header and footer, forms, or anything listed in the "A build here can make" block — write one or two sentences saying what you will plan, then call the ${ASSIST_BUILD_TOOL_NAME} tool once with the whole request. Write no JSON in your message.`,
    '- brief: everything they asked for, in their words, with each page, form and other part named and what each is for. Include what the conversation already settled. Do not invent parts they did not ask for beyond what their request plainly needs (a page that shows a form needs that form).',
    '- publish: true only when they asked for the new pages to go live or be published; otherwise false. New work is an unpublished draft by default.',
    '- summary: one short sentence, such as "Plan three pages, a contact form and a booking service".',
    '- Nothing is built when you call the tool: the user is shown a plan with its price and confirms it. Never say anything is made, and never quote a price.',
    '- Only offer what the "A build here can make" block lists. If they ask for something it does not list, say plainly it cannot be built here from the chat and build the rest.',
    '- A question, or a change to the canvas the user has open, is not a build: answer it, or use the canvas edit tool where it is offered.',
  ].join('\n')
}

/** What a build can make on this site, in each owner's own words. Per site: volatile. */
export function assistBuildIntentsBlock(intents: readonly string[]): string {
  return ['A build here can make:', ...intents.map((intent) => `- ${intent}`)].join('\n')
}

/**
 * The tool call held to what a build job accepts, or `null` when it is
 * unusable. The site is the request's own, never the model's; the brief is
 * clamped to the job door's limit, with a line naming the console page it
 * was asked from so the plan step can read "this page" against it.
 */
export function resolveAssistBuild(
  input: Record<string, unknown> | null,
  scope: { hostId: string; screen: string | null },
): AssistBuildProposal | null {
  if (!input) return null
  const asked = typeof input['brief'] === 'string' ? input['brief'].trim() : ''
  if (!asked) return null
  const where = scope.screen ? `\nAsked from the console page: ${scope.screen}` : ''
  const brief = `${asked.slice(0, AI_JOB_BRIEF_MAX_CHARS - where.length)}${where}`.trim()
  const summary =
    typeof input['summary'] === 'string' && input['summary'].trim()
      ? input['summary'].trim().slice(0, ASSIST_BUILD_SUMMARY_MAX_CHARS)
      : 'Plan what you asked for'
  return {
    id: ASSIST_BUILD_ACTION_ID,
    hostId: scope.hostId,
    brief,
    publish: input['publish'] === true,
    summary,
  }
}

export interface AssistBuildIntentsDeps {
  ops?: typeof aiBuildOps
  hasBuildRunner?: () => boolean
}

/**
 * What a build may make on this site, or `null` where none can be built: a
 * deployment that has not loaded the build kind, or a site where no
 * operation passes its owner's gates. The same operations the build's plan
 * step offers, so the chat never offers what the plan cannot make.
 */
export async function assistBuildIntents(
  firestore: FirebaseFirestore.Firestore,
  input: { orgId: string; hostId: string; org: Record<string, unknown> },
  deps: AssistBuildIntentsDeps = {},
): Promise<string[] | null> {
  const hasBuildRunner = deps.hasBuildRunner ?? (() => aiJobStepRunnerFor('build') !== null)
  if (!hasBuildRunner()) return null
  const host = ((await firestore.collection('hosts').doc(input.hostId).get()).data() ?? null) as Record<
    string,
    unknown
  > | null
  if (!host) return null
  const org = input.org as Partial<AglynOrgBilling>
  const ops = await (deps.ops ?? aiBuildOps)({
    orgId: input.orgId,
    hostId: input.hostId,
    org,
    host,
    freeTaste: aiBuildFreeTaste(org),
  })
  const intents = aiBuildIntents(ops)
  return intents.length ? intents : null
}
