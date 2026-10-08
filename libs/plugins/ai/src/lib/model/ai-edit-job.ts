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

import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { ASSIST_EDIT_CONTEXT_MAX_NODES } from './assist-edit'

/**
 * An `edit` job (AGL-3616): a change to a page or a layout the site already
 * has, asked for in words, made without the Besigner open.
 *
 * It speaks the Assist edit rung's own protocol — the same tool, the same
 * closed world of element ids, the same validators, the same canvas mutators
 * — against the stored document instead of an open canvas, and the change is
 * saved where no visitor sees it:
 *
 *  - on a plan with version history, as a NEW version beside the one it
 *    started from, which becomes the page's current version only when the
 *    page is not published (no visitor reaches it); a published page's and a
 *    layout's current version never move;
 *  - on a plan without it, in place, and only on a version no visitor
 *    reaches — an unpublished page's, or a version that is not the current
 *    one. Anything else is refused, before anything is spent.
 *
 * Pure: the inputs, the sentences a person reads, and the outline the model
 * is shown. The runner is `jobs/ai-job-edit-step.ts`.
 */

/** The documents an edit job changes: those that keep versions and render on a site. */
export const AI_EDIT_TARGET_KINDS = ['screen', 'layout'] as const
export type AiEditTargetKind = (typeof AI_EDIT_TARGET_KINDS)[number]

export interface AiEditJobInputs {
  /** The page's or layout's document id, on the job's site. */
  target: string
  /** Which collection the id is in; both are looked in, a page's first, when absent. */
  targetKind: AiEditTargetKind | null
  /** The version to start from; the document's current version when absent. */
  versionId: string | null
}

const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,64}$/

export const AI_EDIT_TARGET_REQUIRED_COPY = 'Name the page or layout to change.'
export const AI_EDIT_TARGET_KIND_COPY = 'inputs.targetKind must be screen or layout'
export const AI_EDIT_VERSION_ID_COPY = 'inputs.versionId must name a version of the page or layout'

/** A job's inputs read, or the sentence that says what is wrong with them. */
export function parseAiEditJobInputs(
  inputs: Readonly<Record<string, unknown>> | null | undefined,
): AiEditJobInputs | string {
  const target = inputs?.['target']
  if (typeof target !== 'string' || !DOCUMENT_ID.test(target)) return AI_EDIT_TARGET_REQUIRED_COPY
  const kind = inputs?.['targetKind']
  if (kind != null && kind !== '' && !(AI_EDIT_TARGET_KINDS as readonly unknown[]).includes(kind)) {
    return AI_EDIT_TARGET_KIND_COPY
  }
  const versionId = inputs?.['versionId']
  if (versionId != null && versionId !== '' && (typeof versionId !== 'string' || !DOCUMENT_ID.test(versionId))) {
    return AI_EDIT_VERSION_ID_COPY
  }
  return {
    target,
    targetKind: kind ? (kind as AiEditTargetKind) : null,
    versionId: typeof versionId === 'string' && versionId ? versionId : null,
  }
}

// ── What a person reads ───────────────────────────────────────────────────

export const AI_EDIT_NO_SITE_COPY = 'Open the site the change is for before starting the job'
export const AI_EDIT_GONE_COPY = 'The page or layout to change is not on the site.'
export const AI_EDIT_VERSION_GONE_COPY = 'The version to start from is no longer on the page or layout.'
export const AI_EDIT_EMAIL_COPY = 'That is an email design, not a page — change it from Emails → Templates.'
export const AI_EDIT_NO_NODES_COPY = 'That version has nothing on it to change.'

/**
 * A change that would land on a version visitors see, on a plan without
 * version history: the versions route's own sentence, after what it means
 * here.
 */
export const AI_EDIT_NEEDS_VERSIONING_COPY =
  'Visitors see that version, so the change has to go into a new version beside it. Version history requires a Pro plan — see Billing to upgrade.'

/** The model answered and no change survived its checks, even after its re-ask. */
export const AI_EDIT_NOTHING_COPY =
  'No change could be made from that request. Say which part of the page to change, the way it reads on the page, and ask again.'

/** The stored document moved under the change between the read and the write. */
export const AI_EDIT_STALE_COPY =
  'The page changed while this edit was being written, so nothing was saved. Ask again.'

/** The canvas's own guards refused part of the change. */
export const AI_EDIT_REFUSED_COPY = 'The editor refused part of this change, so none of it was saved.'

/** What a version an edit job makes is called, from the change's one-line summary. */
export const AI_EDIT_VERSION_PREFIX = 'AI edit'

/** The longest label a version takes, as the versions route cuts one. */
export const AI_EDIT_VERSION_NAME_MAX_CHARS = 200

export function aiEditVersionName(summary: string): string {
  const said = String(summary ?? '').replace(/\s+/g, ' ').trim()
  return (said ? `${AI_EDIT_VERSION_PREFIX}: ${said}` : AI_EDIT_VERSION_PREFIX).slice(0, AI_EDIT_VERSION_NAME_MAX_CHARS)
}

/** Where the change landed, which decides what the output's note says. */
export type AiEditPlacement =
  /** A new version, now the unpublished page's current one. */
  | 'new-current'
  /** A new version beside the one it started from, which is unchanged. */
  | 'new-beside'
  /** The version it started from, changed in place: one no visitor reaches. */
  | 'in-place'

const NOUNS: Readonly<Record<AiEditTargetKind, string>> = { screen: 'page', layout: 'layout' }

/** The output's note: where the change is, that nothing visitors see moved, and what was left out. */
export function aiEditOutputNote(input: {
  kind: AiEditTargetKind
  placement: AiEditPlacement
  leftOut: readonly string[]
}): string {
  const noun = NOUNS[input.kind]
  const where =
    input.placement === 'new-current'
      ? `Saved as a new version, now this ${noun}’s current one. The ${noun} is not published, so no visitor sees it until you publish it.`
      : input.placement === 'new-beside'
        ? `Saved as a new version beside the one it started from. Nothing visitors see has changed: open it to review it, and publish it when it is ready.`
        : `Saved on the version it started from, which no visitor sees: open it to review it.`
  const leftOut = input.leftOut.length ? ` Left out: ${input.leftOut.join('; ')}.` : ''
  return `${where}${leftOut}`.slice(0, 1_000)
}

/** What the output says of search fields a published page keeps on the page itself. */
export const AI_EDIT_SEO_LEFT_OUT =
  'the search title and description, which a published page uses as soon as they are saved — change them in Page properties'

/** What the output says of a part a job cannot save on its own. */
export const AI_EDIT_COMPONENT_LEFT_OUT = 'saving part of the page as a reusable component, which is done in the editor'

// ── The outline the model is shown ────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The stored document as the outline the edit rung's protocol reads
 * (`parseAssistEditContext` holds it to its limits): the document root, then
 * every element level by level — each after its parent, so every ancestor
 * chain the check walks is whole — until the rung's cap.
 *
 * In the editor, an outline is the neighborhood of what the author selected.
 * A job has no selection, so it is the TOP of the document, read breadth
 * first: every section, and as deep inside each as the cap reaches. Each
 * element keeps its real child count and the document its real size, so the
 * prompt can say how much the outline leaves out. `null` without a root.
 */
export function aiEditJobOutline(nodes: Readonly<Record<string, unknown>>): {
  selectedId: null
  total: number
  nodes: Array<Record<string, unknown>>
} | null {
  const root = nodes[CANVAS_ROOT_ELEMENT_ID]
  if (!isRecord(root)) return null
  const childrenOf = (node: Record<string, unknown>): string[] =>
    Array.isArray(node['nodes']) ? node['nodes'].filter((id): id is string => typeof id === 'string' && isRecord(nodes[id])) : []
  const order: Array<{ id: string; parentId: string | null; index: number }> = [
    { id: CANVAS_ROOT_ELEMENT_ID, parentId: null, index: 0 },
  ]
  const seen = new Set<string>([CANVAS_ROOT_ELEMENT_ID])
  // Every element reachable through child lists, for the document's size.
  let total = 1
  for (let at = 0; at < order.length; at += 1) {
    const { id } = order[at]
    childrenOf(nodes[id] as Record<string, unknown>).forEach((child, index) => {
      if (seen.has(child)) return
      seen.add(child)
      total += 1
      order.push({ id: child, parentId: id, index })
    })
  }
  return {
    selectedId: null,
    total,
    nodes: order.slice(0, ASSIST_EDIT_CONTEXT_MAX_NODES).map(({ id, parentId, index }) => {
      const node = nodes[id] as Record<string, unknown>
      return {
        id,
        componentId: node['componentId'],
        parentId,
        index,
        childCount: childrenOf(node).length,
        ...(typeof node['name'] === 'string' && node['name'] ? { name: node['name'] } : {}),
        ...(isRecord(node['props']) ? { props: node['props'] } : {}),
      }
    }),
  }
}
