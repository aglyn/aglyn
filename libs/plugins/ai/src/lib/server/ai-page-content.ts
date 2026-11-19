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

import { createHash } from 'node:crypto'
import { NODE_MAP_MAX_BYTES } from '@aglyn/aglyn/app-utils/measure-node-map'
import { screenClaimsToBeAPage } from '@aglyn/aglyn/app-utils/screen-route'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import type {
  PageContentEdit,
  PageContentEditInput,
  PageContentEditResult,
  PageContentElement,
  PageContentKind,
  PageContentKindProp,
  PageContentNewElement,
  PageContentRead,
  PageContentReadInput,
  PageContentRefusal,
  PageContentService,
} from '@aglyn/aglyn/plugin-manager/plugin-page-content'
import {
  aiEditBase,
  aiEditDatasetScope,
  clearAiEditMirror,
  draftRef,
  writeAiEdit,
  type AiEditWriteBase,
} from '../jobs/ai-job-edit-step'
import {
  AI_EDIT_GONE_COPY,
  AI_EDIT_NO_NODES_COPY,
  AI_EDIT_STALE_COPY,
  AI_EDIT_TOO_LARGE_COPY,
  AI_EDIT_VERSION_GONE_COPY,
  aiDocumentElements,
  type AiDocumentElement,
} from '../model/ai-edit-job'
import {
  ASSIST_EDIT_ACTION_ID,
  summarizeAssistEditOps,
  type AssistEditCanvasContext,
  type AssistEditCanvasNode,
  type AssistEditProposal,
} from '../model/assist-edit'
import {
  AI_REPEAT_DATASET_PROP,
  AI_SX_ALLOWED_KEYS,
  aiPaletteEntryWithCapabilities,
  aiPropIsIconPick,
} from '../runtime/ai-node-tree'
import { AI_PALETTE } from '../runtime/ai-palette.generated'
import { readAiSiteDatasets } from '../runtime/site-inventory'
import {
  ASSIST_EDIT_MAX_INSERT_NODES,
  ASSIST_EDIT_MAX_OPS,
  ASSIST_EDIT_MOTION_SETTINGS,
  assistEditClosedWorld,
  assistEditLayerNameRefusal,
  validatePendingEdit,
  type AssistEditClosedWorldRefusal,
  type AssistEditViolation,
  type PendingEditOp,
} from './assist-edit'

/**
 * The platform's `core.page-content` contract, answered by the one server
 * page editor there is (AGL-4235): the Assist edit rung the AI edit job runs.
 *
 * A read shows a page as the next edit will find it — the waiting draft when
 * the Besigner would still offer it, otherwise the version the page points at
 * — with every element, complete. An edit is held to the editor's own closed
 * world and validators, as STRICTLY as a caller that is not a model needs:
 * where the rung repairs a model's answer (a setting dropped, text cut, a
 * value coerced), this refuses and names the problem. It lands through the
 * job's own write, always in the page's DRAFT: the live version, the version
 * document and the page document are never touched, and nothing a visitor
 * sees changes until the page is published.
 *
 * ## What `revision` is
 *
 * A digest of the base tree exactly as stored — the `nodes` field's bytes —
 * with which tree it is (the draft or the saved version) and the version's
 * id. It changes whenever that tree changes, and only then: a save that
 * stores the same tree leaves it, and a draft that stops being offered moves
 * the base to the saved version and so moves it too. Read off the content
 * rather than `updatedAt`, which a version written before stamps existed does
 * not carry, so the check an edit makes with `ifRevision` cannot pass on a
 * tree it has not seen.
 *
 * ## What is not editable here, shown as such
 *
 * Each element's `props` and `style` carry only what an edit can set: the
 * settings its kind declares in the palette (with the ones every element
 * takes — repeating, motion), and the style keys the validator admits.
 * Everything else the element stores — rich text (`html`), a class name, an
 * icon the owner picks, references only the editor writes, styles past the
 * key set, interactions, overrides — is under `readOnly`, so a caller can
 * read it and is not invited to send it back.
 */

type Firestore = FirebaseFirestore.Firestore

/** The id a write made with no person behind it is attributed to, beside its label. */
export const AI_PAGE_CONTENT_API_ACTOR = 'api'

/** What a write's summary says, in the draft's history. */
const API_EDIT_SUMMARY = 'Edited through the API'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const refusal = (
  status: PageContentRefusal['status'],
  code: string,
  message: string,
  fields?: Record<string, string>,
): PageContentRefusal => ({ ok: false, status, code, message, ...(fields && Object.keys(fields).length ? { fields } : {}) })

// ── The revision ──────────────────────────────────────────────────────────

/** A stored value as text that does not depend on key order. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/**
 * The base tree's revision (see the module head): which tree, of which
 * version, and a digest of its `nodes` field as stored — the bytes a
 * current document stores, or a legacy map in a key-order-free form.
 */
export function aiPageContentRevision(from: 'draft' | 'saved', versionId: string, stored: unknown): string {
  const hash = createHash('sha256').update(`${from}:${versionId}:`)
  if (stored instanceof Uint8Array) hash.update(stored)
  else hash.update(canonicalJson(stored))
  return `${from === 'draft' ? 'd' : 's'}_${hash.digest('base64url').slice(0, 22)}`
}

// ── What an element shows ────────────────────────────────────────────────

/** The kind an element is stored as; the document root's wrapper when it names none. */
const kindOf = (node: Record<string, unknown>): string =>
  typeof node['componentId'] === 'string' && node['componentId'] ? node['componentId'] : 'div'

/**
 * The settings an edit can set on an element of this kind, by name: the
 * palette's declarations with the ones every element takes, less an icon the
 * site owner picks, then the motion settings and the repeat's dataset. Empty
 * for a kind the palette does not list, whose settings the validator cannot
 * check.
 */
export function aiPageContentKindProps(kind: string): Record<string, PageContentKindProp> {
  const entry = aiPaletteEntryWithCapabilities(kind)
  if (!entry) return {}
  const props: Record<string, PageContentKindProp> = {}
  for (const [name, schema] of Object.entries(entry.propsSchema.properties)) {
    if (aiPropIsIconPick(entry, name)) continue
    const role = entry.propRoles[name]
    const maxLength = role === 'text' ? (entry.textLimits[name] ?? schema.maxLength) : schema.maxLength
    props[name] = {
      ...(role ? { role } : {}),
      type: schema.type ?? 'string',
      ...(schema.enum?.length ? { values: [...schema.enum] } : {}),
      ...(maxLength !== undefined ? { maxLength } : {}),
    }
  }
  for (const [name, allowed] of Object.entries(ASSIST_EDIT_MOTION_SETTINGS)) {
    props[name] =
      allowed === 'switch'
        ? { role: 'motion', type: 'boolean' }
        : typeof allowed === 'number'
          ? { role: 'motion', type: 'integer' }
          : { role: 'motion', type: 'string', values: [...allowed] }
  }
  props[AI_REPEAT_DATASET_PROP] = { role: 'dataset', type: 'string' }
  return props
}

/** What the palette knows of one kind of element. */
export function aiPageContentKind(kind: string, options: { root?: boolean } = {}): PageContentKind {
  const entry = AI_PALETTE[kind]
  return {
    label: options.root ? 'Page' : (entry?.displayName ?? kind),
    acceptsChildren: options.root === true || entry?.acceptsChildren === true,
    props: options.root ? {} : aiPageContentKindProps(kind),
  }
}

/** Node fields an edit here never writes, which an element shows read-only. */
const READ_ONLY_NODE_FIELDS = ['className', 'styleOverrides', 'attrOverrides', 'presetRef'] as const

/** One stored element as a read answers it: what an edit can set, and the rest read-only. */
function elementView(element: AiDocumentElement, settable: ReadonlySet<string>): PageContentElement {
  const { node } = element
  const kind = kindOf(node)
  const props: Record<string, unknown> = {}
  const readOnlyProps: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(isRecord(node['props']) ? node['props'] : {})) {
    if (value === undefined) continue
    if (settable.has(name)) props[name] = value
    else readOnlyProps[name] = value
  }
  const style: Record<string, unknown> = {}
  const readOnlyStyle: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(isRecord(node['sx']) ? node['sx'] : {})) {
    if (AI_SX_ALLOWED_KEYS.has(key)) style[key] = value
    else readOnlyStyle[key] = value
  }
  const readOnly: NonNullable<PageContentElement['readOnly']> = {}
  if (Object.keys(readOnlyProps).length) readOnly.props = readOnlyProps
  if (Object.keys(readOnlyStyle).length) readOnly.style = readOnlyStyle
  if (Array.isArray(node['interactions']) && node['interactions'].length) readOnly.interactions = node['interactions'].length
  const fields = READ_ONLY_NODE_FIELDS.filter((field) => node[field] !== undefined && node[field] !== null)
  if (fields.length) readOnly.fields = fields
  return {
    id: element.id,
    kind,
    ...(typeof node['pluginId'] === 'string' && node['pluginId'] ? { pluginId: node['pluginId'] } : {}),
    ...(typeof node['name'] === 'string' && node['name'] ? { name: node['name'] } : {}),
    parentId: element.parentId,
    children: [...element.children],
    props,
    ...(Object.keys(style).length ? { style } : {}),
    ...(node['hidden'] === true ? { hidden: true } : {}),
    ...(Object.keys(readOnly).length ? { readOnly } : {}),
  }
}

/**
 * A page's elements as a read answers them, every one, depth first in the
 * order the page reads, with what each kind takes. With `elementId`, that
 * element and everything inside it; null when it is not on the page.
 */
export function aiPageContentElements(
  nodes: Readonly<Record<string, unknown>>,
  elementId?: string,
): { total: number; elements: PageContentElement[]; kinds: Record<string, PageContentKind> } | null {
  const order = aiDocumentElements(nodes)
  if (!order) return null
  let chosen = order
  if (elementId !== undefined) {
    const start = order.findIndex((element) => element.id === elementId)
    if (start < 0) return null
    // Depth first, so a branch is the run of elements from its root until
    // the walk leaves it.
    const inside = new Set([elementId])
    chosen = [order[start]]
    for (const element of order.slice(start + 1)) {
      if (element.parentId === null || !inside.has(element.parentId)) break
      inside.add(element.id)
      chosen.push(element)
    }
  }
  const kinds: Record<string, PageContentKind> = {}
  const settable = new Map<string, ReadonlySet<string>>()
  const elements = chosen.map((element) => {
    const kind = kindOf(element.node)
    const root = element.id === CANVAS_ROOT_ELEMENT_ID
    if (!kinds[kind]) kinds[kind] = aiPageContentKind(kind, { root })
    if (!settable.has(kind)) settable.set(kind, new Set(Object.keys(kinds[kind].props)))
    return elementView(element, settable.get(kind) as ReadonlySet<string>)
  })
  return { total: order.length, elements, kinds }
}

// ── Reading the page ──────────────────────────────────────────────────────

const NO_PAGE = (): PageContentRefusal => refusal(404, 'page_not_found', 'No such page')
const EMPTY_PAGE = (): PageContentRefusal =>
  refusal(404, 'page_empty', 'That page has no saved content to read or edit yet. Open it in the editor first.')

/** The page a read or an edit names, with the version it points at. */
interface PageInHand {
  pageRef: FirebaseFirestore.DocumentReference
  versionId: string
  version: FirebaseFirestore.DocumentSnapshot
  draft: FirebaseFirestore.DocumentSnapshot
}

/**
 * An ordinary page of the site — not deleted, not an email design, a
 * template, an error page or a folder (`screenClaimsToBeAPage`, the rule
 * every page list holds to), and a layout is not in this collection at all —
 * with its current version and that version's draft.
 */
async function readPage(
  firestore: Firestore,
  input: { orgId: string; hostId: string; pageId: string },
): Promise<PageInHand | PageContentRefusal> {
  const hostRef = firestore.collection('hosts').doc(input.hostId)
  const pageRef = hostRef.collection('screens').doc(input.pageId)
  const [host, page] = await Promise.all([hostRef.get(), pageRef.get()])
  // A site of another workspace holds no page of this one. The door that
  // calls has admitted the site already, so this only guards the pairing.
  if (!host.exists || host.get('orgId') !== input.orgId) return NO_PAGE()
  if (!page.exists || !screenClaimsToBeAPage(page.data() as never)) return NO_PAGE()
  const versionId = typeof page.get('versionId') === 'string' ? (page.get('versionId') as string) : ''
  if (!versionId) return EMPTY_PAGE()
  const versions = pageRef.collection('versions')
  const [version, draft] = await Promise.all([versions.doc(versionId).get(), draftRef(versions, versionId).get()])
  if (!version.exists) return EMPTY_PAGE()
  return { pageRef, versionId, version, draft }
}

export async function readAiPageContent(input: PageContentReadInput): Promise<PageContentRead | PageContentRefusal> {
  const firestore = input.firestore as Firestore
  const page = await readPage(firestore, input)
  if ('ok' in page) return page
  const base = aiEditBase(page.draft, page.version)
  if (!base) return EMPTY_PAGE()
  const content = aiPageContentElements(base.nodes, input.elementId)
  if (!content) {
    return input.elementId !== undefined && aiDocumentElements(base.nodes)
      ? refusal(404, 'element_not_found', 'No such element on this page', { elementId: 'is not an element of this page' })
      : EMPTY_PAGE()
  }
  return {
    ok: true,
    pageId: input.pageId,
    versionId: page.versionId,
    base: base.from,
    revision: aiPageContentRevision(base.from, page.versionId, base.stored),
    rootId: CANVAS_ROOT_ELEMENT_ID,
    total: content.total,
    elements: content.elements,
    kinds: content.kinds,
  }
}

// ── Edits, held to the editor's rules ─────────────────────────────────────

/** Props an edit here never names: markup, styles and handlers, which no field of an element offers. */
const UNSETTABLE_PROP = /^(html|sx|style|className|dangerouslySetInnerHTML|on[A-Z].*)$/

/** The words a refused element is named with. */
const ELEMENT_REFUSALS: Readonly<Record<AssistEditClosedWorldRefusal, string>> = {
  unknown: 'is not an element of this page',
  root: 'is the page’s root, which cannot be changed, moved or removed',
  removed: 'is inside an element an earlier edit removes',
}

const UNSETTABLE_WORDS = 'cannot be set through the API; send text in `children` to replace rich text'

/** The whole page as the editor's closed world: every element, its kind, its place and its settings. */
function wholeContext(order: readonly AiDocumentElement[]): AssistEditCanvasContext {
  const nodes: AssistEditCanvasNode[] = order.map(({ id, parentId, index, childCount, node }) => ({
    id,
    componentId: typeof node['componentId'] === 'string' ? node['componentId'] : '',
    parentId,
    index,
    childCount,
    ...(isRecord(node['props']) ? { props: node['props'] as AssistEditCanvasNode['props'] } : {}),
  }))
  return { selectedId: null, total: nodes.length, nodes, whole: true }
}

/** Where each element of one insert sits in the request, by the local id it is validated under. */
type InsertPaths = Map<string, { path: string; kind: string }>

interface ParsedApiEdits {
  pending: PendingEditOp[]
  /** The edit each pending op came from. */
  edits: number[]
  /** Each insert's element paths, by the edit's index. */
  inserts: Map<number, InsertPaths>
  fields: Record<string, string>
}

/** The local id an inserted element is validated under: its path among the request's nested elements. */
const localId = (steps: readonly number[]) => ['el', ...steps].join('-')

/**
 * The API's edits as the editor's pending ops, through the one closed world
 * (`assistEditClosedWorld`), with every problem the request itself carries
 * named by edit and member.
 */
function parseApiEdits(edits: readonly PageContentEdit[], context: AssistEditCanvasContext): ParsedApiEdits {
  const world = assistEditClosedWorld(context)
  const parsed: ParsedApiEdits = { pending: [], edits: [], inserts: new Map(), fields: {} }
  const { fields } = parsed
  const element = (at: string, nodeId: unknown): AssistEditCanvasNode | null => {
    const found = world.element(nodeId)
    if (typeof found !== 'string') return found
    fields[at] = ELEMENT_REFUSALS[found]
    return null
  }
  const parent = (at: string, parentId: unknown): AssistEditCanvasNode | null => {
    const found = world.parent(parentId)
    if (!found) fields[at] = typeof parentId === 'string' && world.byId.has(parentId) ? ELEMENT_REFUSALS.removed : ELEMENT_REFUSALS.unknown
    return found
  }
  const unsettable = (at: string, props: Record<string, unknown>): boolean => {
    let found = false
    for (const name of Object.keys(props)) {
      if (!UNSETTABLE_PROP.test(name)) continue
      fields[`${at}.${name}`] = UNSETTABLE_WORDS
      found = true
    }
    return found
  }
  const push = (index: number, op: PendingEditOp) => {
    parsed.pending.push(op)
    parsed.edits.push(index)
  }

  edits.forEach((edit, index) => {
    const at = `edits[${index}]`
    switch (edit.op) {
      case 'updateProps': {
        const node = element(`${at}.elementId`, edit.elementId)
        const props = isRecord(edit.props) ? edit.props : {}
        if (!Object.keys(props).length) fields[`${at}.props`] = 'sets no property'
        if (unsettable(`${at}.props`, props) || !node || !Object.keys(props).length) return
        push(index, { op: 'updateProps', nodeId: node.id, componentId: node.componentId, props })
        return
      }
      case 'updateStyle': {
        const node = element(`${at}.elementId`, edit.elementId)
        const style = isRecord(edit.style) ? edit.style : {}
        if (!Object.keys(style).length) fields[`${at}.style`] = 'sets no style'
        if (!node || !Object.keys(style).length) return
        push(index, { op: 'updateSx', nodeId: node.id, componentId: node.componentId, sx: style })
        return
      }
      case 'rename': {
        const node = element(`${at}.elementId`, edit.elementId)
        const named = typeof edit.name === 'string' ? assistEditLayerNameRefusal(edit.name) : 'is not text'
        if (named) fields[`${at}.name`] = named
        if (!node || named) return
        push(index, { op: 'rename', nodeId: node.id, componentId: node.componentId, name: edit.name })
        return
      }
      case 'remove': {
        const node = element(`${at}.elementId`, edit.elementId)
        if (!node) return
        world.remove(node.id)
        push(index, { op: 'remove', nodeId: node.id, componentId: node.componentId })
        return
      }
      case 'move': {
        const node = element(`${at}.elementId`, edit.elementId)
        const into = parent(`${at}.parentId`, edit.parentId)
        if (!node || !into) return
        if (world.movesInsideItself(node.id, into.id)) {
          fields[`${at}.parentId`] = 'is inside the element being moved'
          return
        }
        world.move(node.id, into.id)
        push(index, {
          op: 'move',
          nodeId: node.id,
          componentId: node.componentId,
          parentId: into.id,
          parentComponentId: into.componentId,
          index: edit.index,
        })
        return
      }
      case 'insert': {
        const into = parent(`${at}.parentId`, edit.parentId)
        const paths: InsertPaths = new Map()
        const nodes: Record<string, Record<string, unknown>> = {}
        let refused = false
        const visit = (raw: PageContentNewElement, steps: number[], path: string) => {
          const id = localId(steps)
          paths.set(id, { path, kind: raw.kind })
          const props = isRecord(raw.props) ? raw.props : {}
          if (unsettable(`${path}.props`, props)) refused = true
          if (raw.name !== undefined) {
            const named = assistEditLayerNameRefusal(raw.name)
            if (named) {
              fields[`${path}.name`] = named
              refused = true
            }
          }
          const children = Array.isArray(raw.children) ? raw.children : []
          nodes[id] = {
            $id: id,
            componentId: raw.kind,
            nodes: children.map((_, child) => localId([...steps, child])),
            props,
            ...(raw.style !== undefined ? { sx: raw.style } : {}),
            ...(raw.name !== undefined ? { name: raw.name } : {}),
          }
          children.forEach((child, position) => visit(child, [...steps, position], `${path}.children[${position}]`))
        }
        visit(edit.element, [], `${at}.element`)
        if (paths.size > ASSIST_EDIT_MAX_INSERT_NODES) {
          fields[`${at}.element`] = `adds ${paths.size} elements; one insert adds at most ${ASSIST_EDIT_MAX_INSERT_NODES}`
          return
        }
        if (!into || refused) return
        parsed.inserts.set(index, paths)
        push(index, {
          op: 'insertSubtree',
          parentId: into.id,
          parentComponentId: into.componentId,
          index: typeof edit.index === 'number' ? edit.index : null,
          tree: { rootId: localId([]), nodes },
        })
        return
      }
      default:
        fields[`${at}.op`] = 'is not an edit this API makes: updateProps, updateStyle, rename, insert, move or remove'
    }
  })
  return parsed
}

/** The validator's line, in the words a field is named with. */
function reasonOf(text: string): string {
  return text
    .replace(/; (dropped|truncated|recomputed)$/, '')
    .replace(/^was over (\d+) characters$/, 'is longer than $1 characters')
    .replace(/^is not a prop of /, 'is not a property of ')
    .replace(/; normalized to "([^"]*)"$/, '; write "$1"')
    .trim()
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * One violation, named by the edit and the member it is in. A repair line
 * names the element the validator was given — the kind, for a patch; the
 * local id, for an inserted element — and the setting, which is read back
 * off it.
 */
function placeViolation(
  violation: AssistEditViolation,
  edit: PageContentEdit,
  at: string,
  paths: InsertPaths | undefined,
  kindOfElement: (elementId: string) => string,
): [member: string, reason: string] {
  const { message } = violation
  if (edit.op === 'updateProps') {
    const subject = `${escapeRegExp(kindOfElement(edit.elementId))}\\.`
    const names = Object.keys(edit.props ?? {}).sort((a, b) => b.length - a.length)
    for (const name of names) {
      const repaired = new RegExp(`^${subject}${escapeRegExp(name)}:? (.*)$`).exec(message)
      if (repaired) return [`${at}.props.${name}`, reasonOf(repaired[1])]
      if (message.startsWith(`${name} `)) return [`${at}.props.${name}`, reasonOf(message.slice(name.length + 1))]
    }
    return [`${at}.props`, reasonOf(message)]
  }
  if (edit.op === 'updateStyle') {
    const repaired = /: sx\.([A-Za-z]+)((?:\.[A-Za-z]+)?) (.*)$/.exec(message)
    if (repaired) return [`${at}.style.${repaired[1]}${repaired[2]}`, reasonOf(repaired[3])]
    return [`${at}.style`, reasonOf(message)]
  }
  if (edit.op === 'move') return [`${at}.parentId`, reasonOf(message)]
  if (edit.op === 'insert' && paths) {
    const ids = [...paths.keys()].sort((a, b) => b.length - a.length)
    const named = (text: string) =>
      ids
        .reduce((out, id) => out.replace(new RegExp(`\\b${escapeRegExp(id)}\\b(?!-)`, 'g'), paths.get(id)?.path ?? id), text)
        .replace(/\bchain-\d+\b/g, 'the element it is added into')
        .replace(new RegExp(escapeRegExp(CANVAS_ROOT_ELEMENT_ID), 'g'), 'the page’s root')
    for (const id of ids) {
      const path = paths.get(id)?.path as string
      const prop = new RegExp(`^${escapeRegExp(id)}\\.([A-Za-z_][A-Za-z0-9_]*)(?:\\.[A-Za-z0-9_]+)?:? (.*)$`).exec(message)
      if (prop) return [`${path}.${prop[1] === 'hidden' ? 'hidden' : `props.${prop[1]}`}`, reasonOf(named(prop[2]))]
      const style = new RegExp(`^${escapeRegExp(id)}: sx\\.([A-Za-z]+)((?:\\.[A-Za-z]+)?) (.*)$`).exec(message)
      if (style) return [`${path}.style.${style[1]}${style[2]}`, reasonOf(named(style[3]))]
      if (new RegExp(`\\(${escapeRegExp(id)}\\)|^${escapeRegExp(id)}\\b(?!-)`).test(message)) return [path, reasonOf(named(message))]
    }
    // An element the page's palette does not offer, as the palette or the
    // sanitizer under it words it.
    const component = /^Component "([^"]+)" (?:is not in the palette|cannot be published)/.exec(message)
    if (component) {
      const found = [...paths.values()].find((entry) => entry.kind === component[1])
      if (found) return [`${found.path}.kind`, 'is not a kind of element a page takes']
    }
    return [`${at}.element`, reasonOf(named(message))]
  }
  return [at, reasonOf(message)]
}

/** What a built change is, or why the edits were refused. */
type BuiltEdit = { proposal: AssistEditProposal } | { refused: PageContentRefusal }

/**
 * The edits validated against one tree and built into the editor's proposal,
 * or refused with every problem named. Pure: the write calls it with the tree
 * its transaction read, so what is checked is what is written.
 */
export function buildAiPageContentEdit(input: {
  base: Pick<AiEditWriteBase, 'from' | 'nodes' | 'stored'>
  pageId: string
  hostId: string
  versionId: string
  edits: readonly PageContentEdit[]
  ifRevision?: string
  screenIds: Iterable<string>
  mediaScopes: Iterable<string>
  datasets?: ReturnType<typeof aiEditDatasetScope>
}): BuiltEdit {
  if (input.ifRevision !== undefined) {
    const current = aiPageContentRevision(input.base.from, input.versionId, input.base.stored)
    if (current !== input.ifRevision) {
      return {
        refused: refusal(409, 'stale', 'The page changed since that revision was read, so nothing was saved. Read it again.', {
          ifRevision: `is not the page’s current revision, ${current}`,
        }),
      }
    }
  }
  if (!input.edits.length || input.edits.length > ASSIST_EDIT_MAX_OPS) {
    return {
      refused: refusal(422, 'edit_refused', 'The edits could not be saved, so none were.', {
        edits: `holds ${input.edits.length}; send 1 to ${ASSIST_EDIT_MAX_OPS} edits`,
      }),
    }
  }
  const order = aiDocumentElements(input.base.nodes)
  if (!order) return { refused: EMPTY_PAGE() }
  const context = wholeContext(order)
  // The kind each element was validated as, which a patch's repair lines name.
  const kinds = new Map(context.nodes.map((node) => [node.id, node.componentId]))
  const parsed = parseApiEdits(input.edits, context)
  const validated = validatePendingEdit({
    surface: 'screen',
    context,
    pending: parsed.pending,
    strict: true,
    references: { screenIds: input.screenIds, mediaScopes: input.mediaScopes },
    ...(input.datasets ? { datasets: input.datasets } : {}),
  })
  const fields = { ...parsed.fields }
  for (const violation of validated.violations) {
    const index = parsed.edits[violation.position]
    const [member, reason] = placeViolation(violation, input.edits[index], `edits[${index}]`, parsed.inserts.get(index), (id) =>
      kinds.get(id) ?? '',
    )
    fields[member] = fields[member] ? `${fields[member]}; ${reason}` : reason
  }
  if (Object.keys(fields).length || validated.ops.length !== input.edits.length) {
    return { refused: refusal(422, 'edit_refused', 'The edits could not be saved, so none were. `fields` names each problem.', fields) }
  }
  return {
    proposal: {
      id: ASSIST_EDIT_ACTION_ID,
      summary: API_EDIT_SUMMARY,
      ops: validated.ops,
      diff: summarizeAssistEditOps(validated.ops),
      dropped: [],
      target: { kind: 'screen', documentId: input.pageId, versionId: input.versionId, hostId: input.hostId },
    },
  }
}

// ── Writing them ──────────────────────────────────────────────────────────

export interface AiPageContentDeps {
  writeEdit?: typeof writeAiEdit
  readDatasets?: typeof readAiSiteDatasets
  clearMirror?: typeof clearAiEditMirror
  now?: () => Date
}

/** The site's pages a link may name: every ordinary page, as a page list holds them. */
async function sitePageIds(firestore: Firestore, hostId: string): Promise<string[]> {
  const pages = await firestore.collection('hosts').doc(hostId).collection('screens').select('deletedAt', 'kind').get()
  return pages.docs.filter((page) => screenClaimsToBeAPage(page.data() as never)).map((page) => page.id)
}

/** A write's own failures, as the statuses an API answers. */
function writeRefusal(error: string, tooLarge?: { bytes: number }): PageContentRefusal {
  if (tooLarge) {
    return refusal(413, 'page_too_large', `${AI_EDIT_TOO_LARGE_COPY} It would be ${tooLarge.bytes} bytes; a page holds at most ${NODE_MAP_MAX_BYTES}.`)
  }
  if (error === AI_EDIT_GONE_COPY) return NO_PAGE()
  if (error === AI_EDIT_NO_NODES_COPY) return EMPTY_PAGE()
  if (error === AI_EDIT_STALE_COPY || error === AI_EDIT_VERSION_GONE_COPY) {
    return refusal(409, 'stale', 'The page changed while the edits were being saved, so nothing was saved. Read it again.')
  }
  return refusal(422, 'edit_refused', 'The editor refused part of these edits, so none were saved.')
}

export function createAiPageContentEditor(deps: AiPageContentDeps = {}) {
  const writeEdit = deps.writeEdit ?? writeAiEdit
  const readDatasets = deps.readDatasets ?? readAiSiteDatasets
  const clearMirror = deps.clearMirror ?? clearAiEditMirror
  return async function editAiPageContent(input: PageContentEditInput): Promise<PageContentEditResult | PageContentRefusal> {
    const firestore = input.firestore as Firestore
    if (!Array.isArray(input.edits) || !input.edits.length || input.edits.length > ASSIST_EDIT_MAX_OPS) {
      return refusal(422, 'edit_refused', 'The edits could not be saved, so none were.', {
        edits: `send 1 to ${ASSIST_EDIT_MAX_OPS} edits`,
      })
    }
    const page = await readPage(firestore, input)
    if ('ok' in page) return page
    const [screenIds, datasets] = await Promise.all([
      sitePageIds(firestore, input.hostId),
      readDatasets(input.orgId, input.hostId),
    ])
    const scope = aiEditDatasetScope(datasets, { kind: 'screen', id: input.pageId })
    const write = await writeEdit<PageContentRefusal>(firestore, {
      hostId: input.hostId,
      kind: 'screen',
      id: input.pageId,
      sourceVersionId: page.versionId,
      jobVersionId: input.editId,
      // Always the version's draft: never a new version, never the search
      // fields, so nothing a visitor sees and nothing on the page moves.
      versioning: false,
      newVersion: false,
      writeSeo: false,
      versionName: API_EDIT_SUMMARY,
      uid: input.actor.uid ?? AI_PAGE_CONTENT_API_ACTOR,
      updatedByLabel: input.actor.label,
      maxNodeBytes: NODE_MAP_MAX_BYTES,
      aiJobId: input.editId,
      now: (deps.now ?? (() => new Date()))(),
      proposal: (base) => {
        // The version the page points at moved since the read: the draft the
        // edits were asked of is no longer the page's.
        if (base.pointerVersionId !== page.versionId) {
          return { refused: refusal(409, 'stale', 'The page changed since it was read, so nothing was saved. Read it again.') }
        }
        const built = buildAiPageContentEdit({
          base,
          pageId: input.pageId,
          hostId: input.hostId,
          versionId: page.versionId,
          edits: input.edits,
          ...(input.ifRevision !== undefined ? { ifRevision: input.ifRevision } : {}),
          screenIds,
          mediaScopes: input.mediaScopes,
          datasets: scope,
        })
        return 'proposal' in built ? built.proposal : built
      },
    })
    if (write.ok === false) return write.refused ?? writeRefusal(write.error, write.tooLarge)
    if (write.placement === 'draft') {
      await clearMirror({ orgId: input.orgId, hostId: input.hostId, kind: 'screen', id: input.pageId, versionId: write.versionId }).catch(
        (error: unknown) => console.warn('[page content] the co-edit mirror could not be cleared', { pageId: input.pageId, error }),
      )
    }
    // A write asked again finds what it wrote and writes nothing; its
    // revision is the draft's as it stands.
    const revision = write.written
      ? aiPageContentRevision('draft', write.versionId, write.written.stored)
      : await readAiPageContent({ firestore, orgId: input.orgId, hostId: input.hostId, pageId: input.pageId }).then((read) =>
          read.ok ? read.revision : '',
        )
    return {
      ok: true,
      pageId: input.pageId,
      versionId: write.versionId,
      revision,
      applied: input.edits.length,
      created: (write.written?.inserted ?? []).map(({ op, ids }) => ({ index: op, id: ids[0], ids })),
    }
  }
}

/** The contract's implementation, as the plugin registers it. */
export const aiPageContentService: PageContentService = {
  read: readAiPageContent,
  editDraft: createAiPageContentEditor(),
}

