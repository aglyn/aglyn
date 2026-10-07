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

/**
 * A build proposed from the Assist chat (AGL-3616): one request that names
 * several things to make on a site — pages, a header and footer, a form, a
 * booking service — turned into ONE `build` job. The chat proposes; the panel
 * starts the job, whose plan step plans it against the site's real inventory
 * and stops with one plan card and one price; nothing is built until the
 * person confirms that card.
 *
 * Shared by the chat door that resolves it and the panel that starts it.
 * Pure: no request, no React.
 */

/** The strict tool the chat model proposes a build through. */
export const ASSIST_BUILD_TOOL_NAME = 'propose_build'

/** The proposal's fixed id, as `assistant_proposal_shown` records it. */
export const ASSIST_BUILD_ACTION_ID = 'build'

/** The longest one-line summary the panel shows above the plan card. */
export const ASSIST_BUILD_SUMMARY_MAX_CHARS = 200

export interface AssistBuildProposal {
  id: typeof ASSIST_BUILD_ACTION_ID
  /** The site the request was asked on; the job is created for it. */
  hostId: string
  /** What to build, in the person's words plus what the console page implies. */
  brief: string
  /** Whether the request asked for the new pages to go live; the plan card still asks. */
  publish: boolean
  /** One line saying what will be planned. */
  summary: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Shape-checks a build proposal before it can start a job. */
export function isAssistBuildProposal(value: unknown): value is AssistBuildProposal {
  if (!isRecord(value) || value['id'] !== ASSIST_BUILD_ACTION_ID) return false
  return (
    typeof value['hostId'] === 'string' &&
    /^[A-Za-z0-9_-]{1,100}$/.test(value['hostId']) &&
    typeof value['brief'] === 'string' &&
    value['brief'].trim().length > 0 &&
    typeof value['publish'] === 'boolean' &&
    typeof value['summary'] === 'string'
  )
}

/**
 * The body of `POST /api/ai/jobs` a proposal starts: a `build` on its site,
 * asking to publish only when the request did. The door climbs its own
 * ladder and takes its own reservation, as every job does.
 */
export function assistBuildJobRequest(
  orgId: string,
  proposal: AssistBuildProposal,
): { orgId: string; hostId: string; kind: 'build'; brief: string; inputs: Record<string, boolean> } {
  return {
    orgId,
    hostId: proposal.hostId,
    kind: 'build',
    brief: proposal.brief,
    inputs: proposal.publish ? { publish: true } : {},
  }
}
