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
 * A change to a page the site already has, asked in the Assist chat
 * (AGL-4116). No plan and no new page: the panel starts one `edit` job on
 * that page, which saves the change into the page's draft — on every plan,
 * the draft the Besigner offers with Open draft — and the card links the
 * page in the Besigner, where the person checks it and publishes it. Only
 * when they ask for a new version, and the plan keeps version history, is
 * the change saved as a new unpublished version instead.
 *
 * Asked through a build, a change to the home page came back as a second
 * page at `/` the plan generated from scratch, and every follow-up made
 * another plan. This is the short way, for the request that only changes
 * what is there.
 *
 * Shared by the chat door that resolves it and the panel that starts it.
 * Pure: no request, no React.
 */

import type { AiJobOutput, AiJobSummary } from './ai-jobs.types'

/** The strict tool the chat model asks for a change to a page through. */
export const ASSIST_PAGE_CHANGE_TOOL_NAME = 'change_page'

/** The proposal's fixed id, as `assistant_proposal_shown` records it. */
export const ASSIST_PAGE_CHANGE_ACTION_ID = 'page-change'

/** The longest one-line summary the card shows. */
export const ASSIST_PAGE_CHANGE_SUMMARY_MAX_CHARS = 200

const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,100}$/

export interface AssistPageChangeProposal {
  id: typeof ASSIST_PAGE_CHANGE_ACTION_ID
  /** The site the request was asked on; the job is created for it. */
  hostId: string
  /** The page to change: one the site has, by its id. */
  pageId: string
  /** The page's name, as the site's list of pages gives it. */
  pageName: string
  /** What to change on it, in the person's words. */
  brief: string
  /** One line saying what will change. */
  summary: string
  /** They asked for a new version of the page; otherwise the change goes into its draft. */
  newVersion?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Shape-checks a page change before it can start a job. */
export function isAssistPageChangeProposal(value: unknown): value is AssistPageChangeProposal {
  if (!isRecord(value) || value['id'] !== ASSIST_PAGE_CHANGE_ACTION_ID) return false
  return (
    typeof value['hostId'] === 'string' &&
    DOCUMENT_ID.test(value['hostId']) &&
    typeof value['pageId'] === 'string' &&
    DOCUMENT_ID.test(value['pageId']) &&
    typeof value['pageName'] === 'string' &&
    typeof value['brief'] === 'string' &&
    value['brief'].trim().length > 0 &&
    typeof value['summary'] === 'string' &&
    (value['newVersion'] === undefined || typeof value['newVersion'] === 'boolean')
  )
}

/**
 * The body of `POST /api/ai/jobs` a page change starts: an `edit` of the
 * page. `versionId` is the version an earlier change in the same
 * conversation wrote to, so a follow-up changes that version's draft rather
 * than starting again from the published page.
 */
export function assistPageChangeJobRequest(
  orgId: string,
  proposal: AssistPageChangeProposal,
  versionId: string | null,
): {
  orgId: string
  hostId: string
  kind: 'edit'
  brief: string
  inputs: { target: string; targetKind: 'screen'; versionId?: string; newVersion?: true }
} {
  return {
    orgId,
    hostId: proposal.hostId,
    kind: 'edit',
    brief: proposal.brief,
    inputs: {
      target: proposal.pageId,
      targetKind: 'screen',
      ...(versionId ? { versionId } : {}),
      ...(proposal.newVersion ? { newVersion: true as const } : {}),
    },
  }
}

/** The version a finished change wrote to the page, or `null` before there is one. */
export function assistPageChangeOutput(job: Pick<AiJobSummary, 'status' | 'outputs'> | null): AiJobOutput | null {
  if (!job || job.status !== 'done') return null
  return job.outputs.find((output) => output.resource === 'screen' && Boolean(output.versionId)) ?? null
}

/**
 * The version a new change to `pageId` continues (AGL-4116): the one the
 * conversation's latest finished change to that page wrote to — its draft
 * holds that change — or `null` to start from the page as it is.
 */
export function assistPageChangeDraftVersion(
  changes: ReadonlyArray<{ pageChange?: AssistPageChangeProposal | null; pageChangeJob?: AiJobSummary | null }>,
  pageId: string,
): string | null {
  for (let index = changes.length - 1; index >= 0; index -= 1) {
    const change = changes[index]
    if (change.pageChange?.pageId !== pageId) continue
    const output = assistPageChangeOutput(change.pageChangeJob ?? null)
    if (output?.versionId) return output.versionId
  }
  return null
}
