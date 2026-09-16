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
  screenSeoStageKey,
  type ScreenSeoTextField,
} from '@aglyn/aglyn/app-utils/screen-seo-fields'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import {
  stageEditorSessionFields,
  type EditorSession,
} from '@aglyn/aglyn/plugin-manager/editor-sessions'
import {
  ASSIST_EDIT_CONTEXT_MAX_NODES,
  ASSIST_EDIT_CONTEXT_MAX_PROPS,
  ASSIST_EDIT_OUTLINE_TEXT_CHARS,
  ASSIST_EDIT_SELECTED_TEXT_CHARS,
  assistEditOpCounts,
  type AssistEditCanvasContext,
  type AssistEditCanvasNode,
  type AssistEditInsertOp,
  type AssistEditOp,
  type AssistEditProposal,
} from '../model/assist-edit'

/**
 * The edit rung's client half (AGL-2906): what the panel tells the server
 * about the open canvas, and how a confirmed proposal lands on it.
 *
 * Applying goes through the canvas's own guarded mutators — the same ones
 * the besigner's panels and the marketing appliers use — inside ONE
 * `batch`, so the whole proposal is one undo step and a guard that refuses
 * part-way leaves nothing behind. Every change is an unsaved edit on the
 * version the editor has open; saving it stays the author's act, with the
 * editor's own control. A version the live site serves is never edited:
 * the check refuses it, and the card offers the editor's own new-version
 * flow instead.
 */

/** A node as the canvas holds it — the fields this module reads. */
export interface AssistEditCanvasNodeLike {
  $id?: string
  componentId?: string
  parentId?: string | null
  nodes?: string[]
  name?: string
  props?: unknown
  sx?: unknown
}

/**
 * The slice of the besigner canvas the edit rung reads and drives. Every
 * member is one `CanvasManager` already has, so the panel hands over the
 * canvas itself and a spec hands over a real one.
 */
export interface AssistEditCanvas {
  getNode(id: string): AssistEditCanvasNodeLike | undefined
  batch<T>(mutate: () => T): T
  updateNodeProps(node: any, props: any): void
  updateNodeFields(node: any, patch: any): void
  reparentNode(node: any, parent: any, index?: number): unknown
  deleteNode(node: any): unknown
  addNodeFromNested(nested: any, parent: any, index?: number): unknown
  nodeAcceptsChildren(node: any): boolean
}

const UNDESCRIBED_PROP = /^(html|sx|style|className|dangerouslySetInnerHTML|on[A-Z].*)$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * An observable's own keys as a plain object. A canvas node's `props` and
 * `sx` are observable proxies, and a spread of one is how a merge silently
 * copies nothing.
 */
function plain(value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!value || typeof value !== 'object') return out
  for (const key in value as Record<string, unknown>) {
    out[key] = (value as Record<string, unknown>)[key]
  }
  return out
}

function describeProps(
  raw: unknown,
  textChars: number,
): Record<string, string | number | boolean> | undefined {
  const props: Record<string, string | number | boolean> = {}
  let kept = 0
  for (const [name, value] of Object.entries(plain(raw))) {
    if (kept >= ASSIST_EDIT_CONTEXT_MAX_PROPS) break
    if (UNDESCRIBED_PROP.test(name)) continue
    if (typeof value === 'string') {
      if (!value.trim()) continue
      props[name] = value.slice(0, textChars)
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      props[name] = value
    } else if (typeof value === 'boolean') {
      props[name] = value
    } else {
      continue
    }
    kept += 1
  }
  return kept ? props : undefined
}

function describeSx(raw: unknown): Record<string, unknown> | undefined {
  const sx: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(plain(raw))) {
    if (typeof value === 'string' || typeof value === 'number') sx[key] = value
    else if (isRecord(value)) sx[key] = plain(value)
  }
  return Object.keys(sx).length ? sx : undefined
}

/**
 * The canvas outline a question carries on the edit rung, nearest first
 * until the cap: the document root, the selection's ancestors, the page's
 * top-level sections, the selection's siblings, then its subtree — or, with
 * nothing selected, one level inside each section. An element is only ever
 * described after its parent, so every ancestor chain the server checks is
 * whole. The server holds this to its own limits before it quotes a byte of
 * it; null when the canvas has no document root loaded.
 */
export function describeAssistEditCanvas(
  canvas: Pick<AssistEditCanvas, 'getNode'>,
  selectedId: string | null,
): AssistEditCanvasContext | null {
  const root = canvas.getNode(CANVAS_ROOT_ELEMENT_ID)
  if (!root) return null
  const order: string[] = []
  const seen = new Set<string>()
  const add = (id: string | undefined | null): void => {
    if (!id || seen.has(id) || order.length >= ASSIST_EDIT_CONTEXT_MAX_NODES) return
    if (!canvas.getNode(id)) return
    seen.add(id)
    order.push(id)
  }

  add(CANVAS_ROOT_ELEMENT_ID)
  const selected =
    selectedId && selectedId !== CANVAS_ROOT_ELEMENT_ID ? canvas.getNode(selectedId) : undefined
  if (selected?.$id) {
    const chain: string[] = []
    const walked = new Set<string>()
    let current: AssistEditCanvasNodeLike | undefined = selected
    while (current?.$id && current.$id !== CANVAS_ROOT_ELEMENT_ID && !walked.has(current.$id)) {
      walked.add(current.$id)
      chain.unshift(current.$id)
      current = current.parentId ? canvas.getNode(current.parentId) : undefined
    }
    // A chain that does not reach the root is not a chain the server can check.
    if (current?.$id === CANVAS_ROOT_ELEMENT_ID) chain.forEach(add)
  }
  for (const id of root.nodes ?? []) add(id)
  if (selected?.$id && seen.has(selected.$id)) {
    const parent = selected.parentId ? canvas.getNode(selected.parentId) : undefined
    for (const id of parent?.nodes ?? []) add(id)
    const queue = [...(selected.nodes ?? [])]
    while (queue.length && order.length < ASSIST_EDIT_CONTEXT_MAX_NODES) {
      const id = queue.shift() as string
      add(id)
      queue.push(...(canvas.getNode(id)?.nodes ?? []))
    }
  } else {
    for (const section of root.nodes ?? []) {
      for (const id of canvas.getNode(section)?.nodes ?? []) add(id)
    }
  }

  const nodes: AssistEditCanvasNode[] = order.map((id) => {
    const node = canvas.getNode(id) as AssistEditCanvasNodeLike
    const isRoot = id === CANVAS_ROOT_ELEMENT_ID
    const parentId = isRoot ? null : (node.parentId ?? null)
    const parent = parentId ? canvas.getNode(parentId) : undefined
    const isSelected = id === selected?.$id
    const props = describeProps(
      node.props,
      isSelected ? ASSIST_EDIT_SELECTED_TEXT_CHARS : ASSIST_EDIT_OUTLINE_TEXT_CHARS,
    )
    const sx = isSelected ? describeSx(node.sx) : undefined
    return {
      id,
      componentId: String(node.componentId ?? ''),
      parentId,
      index: Math.max(0, parent?.nodes?.indexOf(id) ?? 0),
      childCount: node.nodes?.length ?? 0,
      ...(node.name ? { name: String(node.name) } : {}),
      ...(props ? { props } : {}),
      ...(sx ? { sx } : {}),
    }
  })
  return {
    selectedId: selected?.$id && seen.has(selected.$id) ? selected.$id : null,
    nodes,
  }
}

/** Why a proposal cannot land on the open editor as it stands. */
export type AssistEditRefusal =
  /** No editor is open. */
  | 'no-editor'
  /** The editor open is not the document the proposal was made for. */
  | 'other-document'
  /** The open version is the one the live site serves. */
  | 'live-version'
  /** An element the proposal names has gone or changed since. */
  | 'stale'
  /** The canvas's own guards refused part of the change. */
  | 'refused'

export type AssistEditCheck =
  | { ok: true }
  | { ok: false; reason: AssistEditRefusal; message: string }

export type AssistEditApplyResult =
  | {
      ok: true
      /** Applied ops, counted by kind for the activity row. */
      opCounts: Record<string, number>
      /** Editor fields staged, as the editor keys them. */
      staged: string[]
    }
  | { ok: false; reason: AssistEditRefusal; message: string }

const STALE: AssistEditCheck = {
  ok: false,
  reason: 'stale',
  message: 'The canvas has changed since this was proposed, so nothing was applied. Ask again.',
}

/**
 * Whether the proposal can land on the open editor as it stands — checked in
 * full before anything is touched, so a refusal never leaves half an edit.
 */
export function checkAssistEdit(
  canvas: Pick<AssistEditCanvas, 'getNode' | 'nodeAcceptsChildren'>,
  proposal: AssistEditProposal,
  session: EditorSession | undefined,
): AssistEditCheck {
  if (!session) {
    return {
      ok: false,
      reason: 'no-editor',
      message: 'Open the editor this change was proposed for to apply it.',
    }
  }
  if (
    session.documentKind !== proposal.target.kind ||
    session.documentId !== proposal.target.documentId
  ) {
    return {
      ok: false,
      reason: 'other-document',
      message: 'This change was proposed for a different document than the one open.',
    }
  }
  if (session.isLiveVersion()) {
    return {
      ok: false,
      reason: 'live-version',
      message:
        'This is the version your live site shows. Make a new version first, then apply the change there.',
    }
  }
  for (const op of proposal.ops) {
    switch (op.op) {
      case 'setSeo': {
        for (const field of Object.keys(op.fields) as ScreenSeoTextField[]) {
          if (typeof session.fields?.[screenSeoStageKey(field)] !== 'function') {
            return {
              ok: false,
              reason: 'other-document',
              message: 'This editor has no search fields to fill in.',
            }
          }
        }
        break
      }
      case 'insertSubtree': {
        const parent = canvas.getNode(op.parentId)
        if (!parent || parent.componentId !== op.parentComponentId) return STALE
        if (!canvas.nodeAcceptsChildren(parent)) return STALE
        break
      }
      case 'move': {
        const node = canvas.getNode(op.nodeId)
        const parent = canvas.getNode(op.parentId)
        if (!node || node.componentId !== op.componentId) return STALE
        if (!parent || parent.componentId !== op.parentComponentId) return STALE
        break
      }
      default: {
        const node = canvas.getNode(op.nodeId)
        if (!node || node.componentId !== op.componentId) return STALE
      }
    }
  }
  return { ok: true }
}

/**
 * Styles merged one key at a time. A responsive patch over a plain value
 * keeps that value as the base breakpoint, so "more padding on wide screens"
 * does not quietly remove the padding everywhere else.
 */
function mergeSx(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    const existing = out[key]
    if (isRecord(value) && isRecord(existing)) {
      out[key] = { ...plain(existing), ...value }
    } else if (isRecord(value) && (typeof existing === 'string' || typeof existing === 'number')) {
      out[key] = { xs: existing, ...value }
    } else {
      out[key] = value
    }
  }
  return out
}

/** A validated flat subtree as the nested shape `addNodeFromNested` takes. */
function nestSubtree(op: AssistEditInsertOp): Record<string, unknown> {
  const visited = new Set<string>()
  const build = (id: string): Record<string, unknown> => {
    visited.add(id)
    const node = op.nodes[id]
    return {
      componentId: node.componentId,
      ...(node.pluginId ? { pluginId: node.pluginId } : {}),
      props: { ...node.props },
      ...(node.sx ? { sx: { ...node.sx } } : {}),
      ...(node.hidden ? { hidden: true } : {}),
      nodes: node.nodes
        .filter((child) => op.nodes[child] && !visited.has(child))
        .map((child) => build(child)),
    }
  }
  return build(op.rootId)
}

function live(canvas: AssistEditCanvas, id: string): AssistEditCanvasNodeLike {
  const node = canvas.getNode(id)
  if (!node) throw new Error(`element ${id} is no longer on the canvas`)
  return node
}

function applyOne(canvas: AssistEditCanvas, op: AssistEditOp): void {
  switch (op.op) {
    case 'updateProps': {
      const node = live(canvas, op.nodeId)
      // Spread the props the element has: `updateNodeProps` REPLACES the bag,
      // and a patch of one setting would otherwise strip every other one.
      const next: Record<string, unknown> = { ...plain(node.props), ...op.props }
      // Rich text renders `html` over `children`; proposed text replaces it.
      if ('children' in op.props) delete next['html']
      canvas.updateNodeProps(node, next)
      return
    }
    case 'updateSx': {
      const node = live(canvas, op.nodeId)
      canvas.updateNodeFields(node, { sx: mergeSx(plain(node.sx), op.sx) })
      return
    }
    case 'move':
      canvas.reparentNode(live(canvas, op.nodeId), live(canvas, op.parentId), op.index ?? NaN)
      return
    case 'remove':
      canvas.deleteNode(live(canvas, op.nodeId))
      return
    case 'rename':
      canvas.updateNodeFields(live(canvas, op.nodeId), { name: op.name })
      return
    case 'insertSubtree':
      canvas.addNodeFromNested(nestSubtree(op), live(canvas, op.parentId), op.index ?? NaN)
      return
    case 'setSeo':
      return
  }
}

/**
 * Lands a confirmed proposal on the open editor: the canvas ops as ONE batch
 * — one undo step, all or nothing — then any search fields staged into the
 * editor's own form. Nothing is saved.
 */
export function applyAssistEdit(
  canvas: AssistEditCanvas,
  proposal: AssistEditProposal,
  session: EditorSession | undefined,
): AssistEditApplyResult {
  const check = checkAssistEdit(canvas, proposal, session)
  if (check.ok === false) return check
  const open = session as EditorSession
  const canvasOps = proposal.ops.filter((op) => op.op !== 'setSeo')
  if (canvasOps.length) {
    try {
      canvas.batch(() => {
        for (const op of canvasOps) applyOne(canvas, op)
      })
    } catch (error) {
      console.error('assist edit refused by the canvas', error)
      return {
        ok: false,
        reason: 'refused',
        message: 'The editor refused part of this change, so none of it was applied.',
      }
    }
  }
  const staged: string[] = []
  for (const op of proposal.ops) {
    if (op.op !== 'setSeo') continue
    const values: Record<string, string> = {}
    for (const [field, value] of Object.entries(op.fields)) {
      values[screenSeoStageKey(field as ScreenSeoTextField)] = String(value)
    }
    staged.push(...stageEditorSessionFields(open, values).staged)
  }
  return { ok: true, opCounts: assistEditOpCounts(proposal.ops), staged }
}
