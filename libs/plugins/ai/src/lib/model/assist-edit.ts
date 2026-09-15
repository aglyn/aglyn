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

import type { ScreenSeoTextField } from '@aglyn/aglyn/app-utils/screen-seo-fields'

/**
 * Assist level 3, the edit contract (AGL-2906): what the chat door proposes
 * for a besigner canvas, and what the panel applies once the author says so.
 *
 * Shared by the server, which validates a model's proposal into these
 * shapes, and the client, which applies them. Pure data and pure functions,
 * so the panel imports it without pulling the palette or the runtime.
 *
 * ## The boundary
 *
 * A proposal is OPERATIONS, never a document. The server writes nothing: it
 * answers with ops that name elements already on the canvas, or a validated
 * subtree to insert, and the client applies them through the canvas's own
 * guarded mutators, on confirm, as one undoable step. Every change lands as
 * an unsaved edit on the version the editor has open — a draft — and on a
 * version the live site serves, the editor's own new-version flow runs first.
 */

/** The seven operations a proposal may carry. */
export const ASSIST_EDIT_OP_KINDS = [
  'insertSubtree',
  'updateProps',
  'updateSx',
  'move',
  'remove',
  'setSeo',
  'rename',
] as const

export type AssistEditOpKind = (typeof ASSIST_EDIT_OP_KINDS)[number]

/** The id of the besigner view's edit action — the one edit a view offers. */
export const ASSIST_EDIT_ACTION_ID = 'edit.canvas'

/** The name of the structured-output tool a model proposes an edit through. */
export const ASSIST_EDIT_TOOL_NAME = 'propose_canvas_edit'

/** The besigner documents the edit rung opens on: those that keep versions. */
export type AssistEditDocumentKind = 'screen' | 'component' | 'layout'

export const ASSIST_EDIT_DOCUMENT_KINDS: readonly AssistEditDocumentKind[] = [
  'screen',
  'component',
  'layout',
]

const COLLECTION_KINDS: Readonly<Record<string, AssistEditDocumentKind>> = {
  screens: 'screen',
  components: 'component',
  layouts: 'layout',
}

const BESIGNER_DOCUMENT_ROUTE =
  /^\/[^/]+\/hosts\/[^/]+\/(screens|components|layouts)\/([A-Za-z0-9_-]{1,64})\/versions\/([A-Za-z0-9_-]{1,64})\/besigner\/?$/

/** The document a besigner route has open. */
export interface AssistEditDocument {
  kind: AssistEditDocumentKind
  documentId: string
  versionId: string
}

/**
 * The open document off a console path, or null off a route the edit rung
 * serves. Only the versioned editors qualify — a template or an email editor
 * has no version to make first, so the rung does not open there.
 */
export function assistEditDocumentOf(route: string): AssistEditDocument | null {
  const match = BESIGNER_DOCUMENT_ROUTE.exec(String(route ?? ''))
  if (!match) return null
  return {
    kind: COLLECTION_KINDS[match[1]],
    documentId: match[2],
    versionId: match[3],
  }
}

/* ------------------------------------------------------------------ *
 * What the client tells the server about the canvas
 * ------------------------------------------------------------------ */

/** Elements a request describes at most — the selection, its surroundings, its subtree. */
export const ASSIST_EDIT_CONTEXT_MAX_NODES = 60
/** Props described per element at most. */
export const ASSIST_EDIT_CONTEXT_MAX_PROPS = 16
/** Characters of a string prop the selected element carries into a request. */
export const ASSIST_EDIT_SELECTED_TEXT_CHARS = 400
/** Characters of a string prop every other element carries. */
export const ASSIST_EDIT_OUTLINE_TEXT_CHARS = 80

/**
 * One element of the canvas outline a request carries. Ids, component ids
 * and short primitive values only — never a stored document, never markup.
 */
export interface AssistEditCanvasNode {
  id: string
  componentId: string
  /** Null for the document root. */
  parentId: string | null
  /** Position among the parent's children. */
  index: number
  childCount: number
  /** The layer name, when the author gave it one. */
  name?: string
  /** Primitive props, strings shortened. */
  props?: Record<string, string | number | boolean>
  /** The element's own styles — carried for the selected element only. */
  sx?: Record<string, unknown>
}

export interface AssistEditCanvasContext {
  /** The element the author has selected, or null. */
  selectedId: string | null
  nodes: AssistEditCanvasNode[]
}

/* ------------------------------------------------------------------ *
 * What the server proposes
 * ------------------------------------------------------------------ */

/** An element of a validated subtree, in the flat shape the canvas stores. */
export interface AssistEditNode {
  $id: string
  componentId: string
  pluginId?: string
  parentId: string | null
  nodes: string[]
  props: Record<string, unknown>
  sx?: Record<string, unknown>
  hidden?: boolean
}

/**
 * Every op that acts on an element names the component the server validated
 * it as, so the client can refuse an element that has changed since.
 */
interface AssistEditNodeOpBase {
  nodeId: string
  componentId: string
}

export interface AssistEditInsertOp {
  op: 'insertSubtree'
  parentId: string
  /** The component the parent was validated as. */
  parentComponentId: string
  /** Position among the parent's children; null appends. */
  index: number | null
  rootId: string
  nodes: Record<string, AssistEditNode>
}

export interface AssistEditUpdatePropsOp extends AssistEditNodeOpBase {
  op: 'updateProps'
  /** Merged over the props the element has; nothing else it carries changes. */
  props: Record<string, unknown>
}

export interface AssistEditUpdateSxOp extends AssistEditNodeOpBase {
  op: 'updateSx'
  /** Merged over the element's own styles, one key at a time. */
  sx: Record<string, unknown>
}

export interface AssistEditMoveOp extends AssistEditNodeOpBase {
  op: 'move'
  parentId: string
  /** The component the new parent was validated as. */
  parentComponentId: string
  index: number | null
}

export interface AssistEditRemoveOp extends AssistEditNodeOpBase {
  op: 'remove'
}

export interface AssistEditRenameOp extends AssistEditNodeOpBase {
  op: 'rename'
  name: string
}

export interface AssistEditSetSeoOp {
  op: 'setSeo'
  fields: Partial<Record<ScreenSeoTextField, string>>
}

export type AssistEditOp =
  | AssistEditInsertOp
  | AssistEditUpdatePropsOp
  | AssistEditUpdateSxOp
  | AssistEditMoveOp
  | AssistEditRemoveOp
  | AssistEditRenameOp
  | AssistEditSetSeoOp

/** Where a proposal applies, as the server read it off the request. */
export interface AssistEditTarget extends AssistEditDocument {
  hostId: string
}

/** The counts the card shows before the author decides. */
export interface AssistEditDiff {
  /** Elements added, every element of every inserted subtree counted. */
  added: number
  /** Elements removed — each with whatever it contains. */
  removed: number
  propsChanged: number
  stylesChanged: number
  moved: number
  renamed: number
  /** Search fields filled in. */
  seoFields: number
}

/** The most reasons a proposal carries for the changes validation left out. */
export const ASSIST_EDIT_MAX_DROPPED_REASONS = 10

export interface AssistEditProposal {
  id: typeof ASSIST_EDIT_ACTION_ID
  /** One line, in the model's words, of what the edit does. */
  summary: string
  ops: AssistEditOp[]
  diff: AssistEditDiff
  /** Why each change the model wrote and validation refused was left out. */
  dropped: string[]
  target: AssistEditTarget
}

/** The counts for a list of ops. */
export function summarizeAssistEditOps(ops: readonly AssistEditOp[]): AssistEditDiff {
  const diff: AssistEditDiff = {
    added: 0,
    removed: 0,
    propsChanged: 0,
    stylesChanged: 0,
    moved: 0,
    renamed: 0,
    seoFields: 0,
  }
  for (const op of ops) {
    switch (op.op) {
      case 'insertSubtree':
        diff.added += Object.keys(op.nodes).length
        break
      case 'remove':
        diff.removed += 1
        break
      case 'updateProps':
        diff.propsChanged += 1
        break
      case 'updateSx':
        diff.stylesChanged += 1
        break
      case 'move':
        diff.moved += 1
        break
      case 'rename':
        diff.renamed += 1
        break
      case 'setSeo':
        diff.seoFields += Object.keys(op.fields).length
        break
    }
  }
  return diff
}

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`

/** The diff as the lines a person reads, zero counts omitted. */
export function describeAssistEditDiff(diff: AssistEditDiff): string[] {
  const lines: string[] = []
  if (diff.added) lines.push(`${plural(diff.added, 'element', 'elements')} added`)
  if (diff.removed) lines.push(`${plural(diff.removed, 'element', 'elements')} removed`)
  if (diff.propsChanged) {
    lines.push(`${plural(diff.propsChanged, 'element’s settings', 'elements’ settings')} changed`)
  }
  if (diff.stylesChanged) {
    lines.push(`${plural(diff.stylesChanged, 'element', 'elements')} restyled`)
  }
  if (diff.moved) lines.push(`${plural(diff.moved, 'element', 'elements')} moved`)
  if (diff.renamed) lines.push(`${plural(diff.renamed, 'layer', 'layers')} renamed`)
  if (diff.seoFields) {
    lines.push(`${plural(diff.seoFields, 'search field', 'search fields')} filled in`)
  }
  return lines
}

/** The word each op kind is counted under in the activity row. */
const OP_COUNT_WORDS: Readonly<Record<AssistEditOpKind, string>> = {
  updateProps: 'set',
  updateSx: 'restyle',
  insertSubtree: 'insert',
  move: 'move',
  remove: 'remove',
  rename: 'rename',
  setSeo: 'seo',
}

/** The applied ops counted by kind, as the activity row names them (`{ set: 3, insert: 1 }`). */
export function assistEditOpCounts(ops: readonly AssistEditOp[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const op of ops) {
    const word = OP_COUNT_WORDS[op.op]
    if (word) counts[word] = (counts[word] ?? 0) + 1
  }
  return counts
}

/** The words `assistEditOpCounts` counts under, for a door that reads them back. */
export const ASSIST_EDIT_OP_COUNT_WORDS: readonly string[] = Object.values(OP_COUNT_WORDS)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Whether a `done` event's `edit` field is a proposal this client can apply.
 * The server built it, so this is a shape check rather than a validation: it
 * keeps a malformed or foreign payload from reaching the canvas mutators.
 */
export function isAssistEditProposal(value: unknown): value is AssistEditProposal {
  if (!isRecord(value) || value['id'] !== ASSIST_EDIT_ACTION_ID) return false
  const target = value['target']
  if (!isRecord(target)) return false
  if (!ASSIST_EDIT_DOCUMENT_KINDS.includes(target['kind'] as AssistEditDocumentKind)) return false
  if (typeof target['documentId'] !== 'string' || !target['documentId']) return false
  const ops = value['ops']
  if (!Array.isArray(ops) || !ops.length) return false
  return ops.every(
    (op) => isRecord(op) && ASSIST_EDIT_OP_KINDS.includes(op['op'] as AssistEditOpKind),
  )
}

/* ------------------------------------------------------------------ *
 * What the client reports once the author applied a proposal
 * ------------------------------------------------------------------ */

/** The body of `POST /api/assist/edit-applied`. */
export interface AssistEditAppliedReport {
  orgId: string
  hostId: string
  /** The exchange whose answer carried the proposal. */
  exchangeId: string
  documentKind: AssistEditDocumentKind
  documentId: string
  /** The version the edits landed on — a new one when the open one was live. */
  versionId: string
  opCounts: Record<string, number>
}
