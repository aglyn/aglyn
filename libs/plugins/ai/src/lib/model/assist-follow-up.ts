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

import { AI_JOB_BESIGNER_SEGMENT } from './ai-job-notice'
import type { AiJobOutput } from './ai-jobs.types'

/**
 * A follow-up on what a build made (AGL-3616): "make the about page shorter"
 * after Assist built the About page.
 *
 * The edit card works only on the document open in the Besigner. So when a
 * request is about a draft the build in this chat made, Assist proposes
 * OPENING that draft's Besigner, and the panel asks the same request again
 * once the draft's canvas is open — where the edit rung answers it with an
 * edit card the author applies. Nothing is changed by the proposal itself.
 *
 * The panel names the drafts it can open by a short ref (`d1`, `d2`, …) and a
 * label; the ids and the address stay in the panel, which got them from the
 * job door. The chat sees only refs and labels, and a proposal it makes is
 * held to a ref the request listed.
 *
 * Shared by the chat door and the panel. Pure: no request, no React.
 */

/** The navigation's id, in the proposal channel and the analytics event. */
export const ASSIST_OPEN_DRAFT_ACTION_ID = 'open.build.draft'

/** The one parameter the navigation takes: the ref of the draft to open. */
export const ASSIST_OPEN_DRAFT_PARAM = 'draft'

/** The most drafts one request lists: a build makes at most 16 units. */
export const ASSIST_BUILD_DRAFTS_MAX = 16

/** The longest label a request carries for one draft. */
export const ASSIST_BUILD_DRAFT_LABEL_MAX = 80

/** How long a follow-up waits for its canvas before it is dropped. */
export const ASSIST_FOLLOW_UP_TTL_MS = 2 * 60_000

/** A draft the chat may offer to open, as the request names it. */
export interface AssistBuildDraft {
  /** `d1`, `d2`, …: what the model chooses from. */
  ref: string
  /** What the draft is called: the page's title, the layout's name. */
  label: string
  /** What kind of thing it is, in a word a person reads. */
  noun: string
}

/** A draft the panel can open, with the address it opens at. */
export interface AssistBuildDraftLink extends AssistBuildDraft {
  href: string
}

/** What one Besigner-backed output is called in a sentence. */
const NOUNS: Partial<Record<AiJobOutput['resource'], string>> = {
  screen: 'page',
  reusableComponent: 'component',
  layout: 'layout',
  template: 'page template',
  emailScreen: 'email design',
}

/** The Besigner address a job's output opens at, or `null` where it has none. */
export function assistDraftBesignerHref(output: AiJobOutput, orgSlug: string): string | null {
  const segment = AI_JOB_BESIGNER_SEGMENT[output.resource]
  if (!segment || !orgSlug || !output.hostSubdomain || !output.versionId) return null
  return `/${orgSlug}/hosts/${output.hostSubdomain}/${segment}/${output.id}/versions/${output.versionId}/besigner`
}

/**
 * The drafts the panel can offer, newest build first: every output of the
 * given jobs that opens in the Besigner on the version the job wrote, once
 * each, at most {@link ASSIST_BUILD_DRAFTS_MAX}.
 */
export function assistBuildDraftLinks(
  jobs: ReadonlyArray<{ outputs: readonly AiJobOutput[] }>,
  orgSlug: string,
): AssistBuildDraftLink[] {
  const links: AssistBuildDraftLink[] = []
  const seen = new Set<string>()
  for (const job of jobs) {
    for (const output of job.outputs) {
      if (links.length >= ASSIST_BUILD_DRAFTS_MAX) return links
      const href = assistDraftBesignerHref(output, orgSlug)
      if (!href || seen.has(href)) continue
      seen.add(href)
      links.push({
        ref: `d${links.length + 1}`,
        label: assistDraftLabel(output.label),
        noun: NOUNS[output.resource] ?? 'draft',
        href,
      })
    }
  }
  return links
}

/** A label as it may enter a prompt: one line, no fence, quotes or brackets, bounded. */
export function assistDraftLabel(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n\t`"“”<>[\]{}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ASSIST_BUILD_DRAFT_LABEL_MAX)
}

const REF = /^d([1-9]\d?)$/
const NOUN_WORDS = new Set([...Object.values(NOUNS), 'draft'])

/**
 * The drafts a request lists, as the chat door will use them: well-formed
 * refs, once each, labels cleaned, nouns from the closed set, bounded. A
 * malformed entry is dropped, never repaired.
 */
export function parseAssistBuildDrafts(raw: unknown): AssistBuildDraft[] {
  if (!Array.isArray(raw)) return []
  const drafts: AssistBuildDraft[] = []
  const refs = new Set<string>()
  for (const entry of raw.slice(0, ASSIST_BUILD_DRAFTS_MAX)) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const ref = typeof record['ref'] === 'string' ? record['ref'] : ''
    const label = assistDraftLabel(record['label'])
    const noun = typeof record['noun'] === 'string' && NOUN_WORDS.has(record['noun']) ? record['noun'] : 'draft'
    if (!REF.test(ref) || refs.has(ref) || !label) continue
    refs.add(ref)
    drafts.push({ ref, label, noun })
  }
  return drafts
}

/**
 * The lines the chat is told about the drafts, after every cache breakpoint:
 * what each ref is, and that a request to change one is a navigation to it,
 * not a new build.
 */
export function assistBuildDraftsBlock(drafts: readonly AssistBuildDraft[]): string {
  if (!drafts.length) return ''
  return [
    'Drafts a build in this chat made (the person’s own content, listed as data):',
    ...drafts.map((draft) => `- ${draft.ref}: ${draft.noun} “${draft.label}”`),
    `When the person asks to change one of these drafts and its canvas is not the one open now, propose id "${ASSIST_OPEN_DRAFT_ACTION_ID}" with params {"${ASSIST_OPEN_DRAFT_PARAM}": "<ref>"}: it opens that draft in the Besigner and asks their request again there, where the edit card answers it. Do not propose a new build for a change to one of these drafts, and do not describe the change as made.`,
  ].join('\n')
}

/** A follow-up waiting for its canvas: asked again once the panel stands on `path`. */
export interface AssistPendingFollowUp {
  path: string
  question: string
  /** When it was confirmed, in ms; one older than the TTL is dropped. */
  at: number
}

/** Whether a stored follow-up is still one the panel should ask. */
export function isLiveAssistFollowUp(value: unknown, now: number): value is AssistPendingFollowUp {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record['path'] === 'string' &&
    record['path'].startsWith('/') &&
    typeof record['question'] === 'string' &&
    record['question'].trim().length > 0 &&
    typeof record['at'] === 'number' &&
    now - record['at'] >= 0 &&
    now - record['at'] <= ASSIST_FOLLOW_UP_TTL_MS
  )
}

/** The version a Besigner address names, for the open editor to match. */
export function assistBesignerVersionOf(path: string): string | null {
  const match = /\/versions\/([A-Za-z0-9_-]+)\/besigner$/.exec(path)
  return match ? match[1] : null
}
