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

import { _isObj, _isStrT } from '@aglyn/shared-util-tools'
import { arraySafe } from '@aglyn/shared-util-tools'
import cloneDeep from 'lodash-es/cloneDeep'
import isEqual from 'lodash-es/isEqual'
import {
  action,
  computed,
  type IObservableArray,
  makeAutoObservable,
  makeObservable,
  observable,
  type ObservableMap,
  runInAction,
  toJS,
} from 'mobx'
import { computedFn } from 'mobx-utils'
import type { Aglyn } from '../aglyn'
import type { NodeInteraction } from '../app-utils/node-interactions'
import { schemaAcceptsChildren } from '../app-utils/child-contract'
import { REUSABLE_INSTANCE_COMPONENT_ID } from '../app-utils/compose-reusable-components'
import { stripUndefinedDeep } from '../app-utils/strip-undefined'
import { createIdUrlSafe } from '../foundation'
import type { PluginId } from '../plugin-manager'
import {
  type ComponentId,
  type ComponentSchema,
  type NodeBreadcrumbPath,
  type NodeId,
  type NodeSchema,
  type NodeSchemaJSON,
  type NodeSchemaNested,
  type NodesMap,
  NodeType,
  type PresetSchema,
  type ProcessableNodes,
} from '../types/nodes'

export const NODE_ROOT_ID = '_@_'
export const NODE_ROOT_LABEL = 'Document'

export class AglynNode<P = JSX.AnyProps> implements NodeSchema<P> {
  // public store: CanvasManager
  public $id: NodeId
  public name?: string
  public type: NodeType | string
  public pluginId?: PluginId
  public componentId?: ComponentId
  public parentId?: NodeId
  public nodes?: NodeId[]
  public props: P
  public sx?: JSX.SxProps
  public className?: string
  /**
   * Per-instance style overrides (AGL-1306) — see `NodeSchema`. Assigned
   * by name like every other field: this constructor DROPS unknown
   * top-level keys, so forgetting a field here silently strips it from
   * every canvas round-trip.
   */
  public styleOverrides?: Record<string, JSX.SxProps>
  /**
   * Per-instance attribute overrides (AGL-1899) — see `NodeSchema`. Same
   * three-touch-point rule as `styleOverrides` above: declared here,
   * assigned in the constructor, emitted in `toJSON`. Miss one and the
   * field survives in memory but not across a save.
   */
  public attrOverrides?: Record<string, Record<string, unknown>>
  /**
   * Interactions authored on this element (AGL-1478) — see `NodeSchema`.
   * Third field under the same three-touch-point rule as the two above:
   * declared here, assigned in the constructor, emitted in `toJSON`.
   */
  public interactions?: NodeInteraction[]
  /**
   * Hidden by the author (AGL-1479) — see `NodeSchema`. Same three touch
   * points, and it needs all of them for a second reason as well: an
   * undeclared field assigned at runtime is not observable, so the hierarchy
   * row would not repaint when the eye was clicked.
   */
  public hidden?: boolean

  get parent(): NodeSchema<any> | undefined {
    if (!this.parentId) return
    return this.store.getNode(this.parentId)
  }
  get index(): number | null {
    return this.store.getNodeIndex(this)
  }
  get children(): NodeSchema<any>[] {
    const res: NodeSchema[] = []
    // `?? []`, not `||= []` — a computed getter must not assign to observable
    // state, and this only reads (AGL-763).
    for (const $id of this.nodes ?? []) {
      const node = this.store.getNode($id)
      if (node) res.push(node)
    }
    return res
  }
  get labelShort(): string {
    return this.store.getNodeLabelShort(this)
  }
  get breadcrumbPath(): NodeBreadcrumbPath {
    return this.store.getNodeBreadcrumbPath(this)
  }
  get componentSchema(): ComponentSchema | undefined {
    if (!this.componentId) return
    return this.store.aglyn.components.getSchema(this.componentId)
  }
  get hasNodes(): boolean {
    return Array.isArray(this.nodes) && this.nodes.length > 0
  }
  get resolvedProps(): P {
    const resolveProps = this.componentSchema?.resolveProps
    if (typeof resolveProps === 'function') {
      return (resolveProps(this) || {}) as P
    }
    return this.props
  }

  get asJSON(): NodeSchemaJSON<P> {
    return this.toJSON()
  }

  constructor(
    schema: NodeSchema<P>,
    public store: CanvasManager,
  ) {
    this.$id = schema.$id
    this.name = schema.name
    this.type = schema.type || NodeType.NODE
    this.parentId = schema.parentId
    this.pluginId = schema.pluginId
    this.componentId = schema.componentId
    this.className = schema.className
    this.nodes = Array.isArray(schema.nodes) ? [...schema.nodes] : []
    this.props = { ...schema.props } as P
    this.sx = Array.isArray(schema.sx) ? [...schema.sx] : { ...schema.sx }
    this.styleOverrides = schema.styleOverrides
      ? { ...schema.styleOverrides }
      : undefined
    this.attrOverrides = schema.attrOverrides
      ? { ...schema.attrOverrides }
      : undefined
    this.interactions = Array.isArray(schema.interactions)
      ? [...schema.interactions]
      : undefined
    this.hidden = schema.hidden || undefined

    makeAutoObservable(this, {
      store: false,
      toJSON: false,
    })
  }

  public delete() {
    this.store.deleteNode(this)
  }

  public toJSON = (): NodeSchemaJSON<P> => {
    const json: Record<string, unknown> = {
      $id: this.$id,
      type: this.type,
    }
    // Omit optional scalar fields when undefined — Firestore rejects undefined values
    if (this.name !== undefined) json['name'] = this.name
    if (this.parentId !== undefined) json['parentId'] = this.parentId
    if (this.pluginId !== undefined) json['pluginId'] = this.pluginId
    if (this.componentId !== undefined) json['componentId'] = this.componentId
    if (this.className !== undefined) json['className'] = this.className
    // Omit collection fields when empty to save Firestore storage
    const nodes = this.nodes ? [...this.nodes] : []
    if (nodes.length > 0) json['nodes'] = nodes
    // The scalar omissions above stopped at the top level, so an OWN key
    // holding `undefined` inside these bags still reached storage (AGL-1334).
    // An editor form writes the whole field set back, so a never-set or
    // cleared optional attribute is such a key — and the two write paths then
    // disagreed: a save msgpacked it to `null`, a publish handed `undefined`
    // straight to `updateDoc()`, which rejects it. Stripping HERE is what
    // makes save and publish agree: both serialize from this one method.
    const props = stripUndefinedDeep(toJS(this.props))
    if (props && Object.keys(props).length > 0) json['props'] = props
    const sx = stripUndefinedDeep(toJS(this.sx))
    const sxEmpty = Array.isArray(sx) ? sx.length === 0 : !sx || Object.keys(sx).length === 0
    if (!sxEmpty) json['sx'] = sx
    // Instance style overrides (AGL-1306): emitted like sx — absent when
    // empty — so the SAVED node map carries them into both storage forms
    // (the plain map and the msgpack bytes both serialize this output).
    const styleOverrides = stripUndefinedDeep(toJS(this.styleOverrides))
    if (styleOverrides && Object.keys(styleOverrides).length > 0) {
      json['styleOverrides'] = styleOverrides
    }
    // Instance attribute overrides (AGL-1899): same treatment, same reason.
    const attrOverrides = stripUndefinedDeep(toJS(this.attrOverrides))
    if (attrOverrides && Object.keys(attrOverrides).length > 0) {
      json['attrOverrides'] = attrOverrides
    }
    // Element interactions (AGL-1478): emitted like the bags above, absent
    // when empty. This is the field that makes them versioned with the
    // document at all — an interaction the canvas holds but this method
    // does not write is one that never reaches a save.
    const interactions = stripUndefinedDeep(toJS(this.interactions))
    if (Array.isArray(interactions) && interactions.length > 0) {
      json['interactions'] = interactions
    }
    // Author visibility (AGL-1479). Emitted only when TRUE: `false` and
    // absent mean the same thing, and a field on every node in the document
    // is bytes on every save and every page.
    if (this.hidden) json['hidden'] = true
    return json as NodeSchemaJSON<P>
  }
}

/**
 * One recorded state, plus the {@link CanvasManager._epoch} it was taken at.
 *
 * The epoch is what makes a whole-document snapshot safe to restore in a
 * co-editing session (AGL-1958). Restoring the map wholesale reverts every
 * node in it — including nodes a *colleague* changed after the snapshot was
 * taken, whose new values the snapshot has never seen. Stamping each entry
 * lets {@link CanvasManager.restoreSnapshot} tell "this remote change is
 * already in the snapshot" from "this remote change happened later and the
 * snapshot would undo it", which is exactly the distinction a plain
 * `Map<K, T>` cannot express.
 */
interface HistorySnapshot<K extends string, T> {
  nodes: Map<K, T>
  epoch: number
}

class HistoryManager<K extends string, T> {
  public present = observable.map<K, T>({})
  public past = observable.array<HistorySnapshot<K, T>>([], { deep: false })
  public future = observable.array<HistorySnapshot<K, T>>([], { deep: false })

  constructor() {
    makeObservable(this, {
      canUndo: computed,
      canRedo: computed,
      undo: action,
      redo: action,
      clearPast: action,
      clearFuture: action,
      clearHistory: action,
      saveHistory: action,
    })
  }

  public get [Symbol.toStringTag]() {
    return 'HistoryManager'
  }

  public toString(): string {
    return '[object HistoryManager]'
  }

  public toJSON(): {
    past: IObservableArray<HistorySnapshot<K, T>>
    present: ObservableMap<K, T>
    future: IObservableArray<HistorySnapshot<K, T>>
  } {
    return {
      past: toJS(this.past),
      present: toJS(this.present),
      future: toJS(this.future),
    }
  }

  public get canUndo() {
    return this.past.length >= 1
  }

  public get canRedo() {
    return this.future.length >= 1
  }

  public undo(epoch: number): HistorySnapshot<K, T> {
    if (!this.canUndo) throw new Error('No history to undo')
    this.future.push({ nodes: toJS(this.present), epoch })
    return this.past.pop()!
  }

  public redo(epoch: number): HistorySnapshot<K, T> {
    if (!this.canRedo) throw new Error('No history to redo')
    this.past.push({ nodes: toJS(this.present), epoch })
    return this.future.pop()!
  }

  public clearPast(): this {
    this.past.clear()
    return this
  }

  public clearFuture(): this {
    this.future.clear()
    return this
  }

  public clearHistory(): this {
    this.clearPast()
    this.clearFuture()
    return this
  }

  public saveHistory(epoch: number): this {
    this.clearFuture()
    this.past.push({ nodes: toJS(this.present), epoch })
    return this
  }
}

export class CanvasManager {
  /**
   * How long a coalesced burst stays open. Comfortably above typing cadence
   * and slider tick rate, well below the pause that means "a new adjustment".
   */
  public static readonly COALESCE_WINDOW_MS = 500

  private _initial: NodesMap | undefined = undefined
  /**
   * Whether {@link _initial} is a state the STORE has confirmed, or merely
   * one the client believes. See {@link updateInitialNodes}.
   */
  private _initialConfirmed = true
  private _history: HistoryManager<NodeId, NodeSchema<any>>
  /** The open {@link transact} burst, if any. See that method. */
  private _coalescing: { key: string; at: number } | undefined = undefined
  /**
   * Monotonic counter, bumped once per node a REMOTE session changes. See
   * {@link markRemoteNode} and {@link restoreSnapshot} (AGL-1958).
   */
  private _epoch = 0
  /** Node id → the {@link _epoch} at which a remote session last touched it. */
  private _foreignAt = new Map<NodeId, number>()

  constructor(public aglyn: Aglyn) {
    makeObservable<
      CanvasManager,
      '_initial' | '_initialConfirmed' | '_epoch'
    >(this, {
      _initial: observable.ref,
      _initialConfirmed: observable,
      // Observable so {@link hasRemoteEdits} is a computed a React observer
      // re-renders on: the draft prompt has to stop offering Restore the
      // moment a peer's first change lands, not on the next unrelated
      // render (AGL-2486).
      _epoch: observable,
      nodes: computed,
      isInitialSame: computed,
      didSetInitial: computed,
      hasRemoteEdits: computed,
      markRemoteNode: action,
      undo: action,
      redo: action,
      saveHistory: action,
      // An action so the snapshot and the mutation land in ONE mobx
      // transaction — otherwise `saveHistory` alone notifies observers, and
      // the canvas renders a frame between the two (AGL-1204).
      transact: action,
      clearHistory: action,
      clearNodes: action,
      reset: action,
      updateInitialNodes: action,
      confirmInitialNodes: action,
      setNode: action,
      setNodes: action,
      applyNodes: action,
      deleteNode: action,
      reparentNode: action,
      reorderNode: action,
      updateNodeFields: action,
      updateNodeProps: action,
    })

    this._history = new HistoryManager()
  }

  public get nodes() {
    return this._history.present
  }

  public get canRedo() {
    return this._history.canRedo
  }
  public get canUndo() {
    return this._history.canUndo
  }
  /**
   * True when the canvas matches the last state the store is known to hold —
   * i.e. there is nothing to save.
   *
   * An UNCONFIRMED baseline (see {@link updateInitialNodes}) always reads as
   * different. The editor is loaded, but nothing in it is known to be
   * persisted, and "clean" here disables Save: claiming a state is saved on
   * the strength of a snapshot the server never acknowledged is how unsaved
   * work becomes unsavable work (AGL-1262).
   */
  public get isInitialSame() {
    if (!this._initial) return true
    if (!this._initialConfirmed) return false
    return isEqual(this._initial, this.serializeNodes())
  }
  public get didSetInitial() {
    return Boolean(this._initial)
  }
  /** Whether the recorded baseline is one the store confirmed. */
  public get isInitialConfirmed() {
    return this._initialConfirmed
  }
  public get rootNode() {
    return this.nodes.get(NODE_ROOT_ID)
  }
  public get nestedNodes(): NodeSchemaNested<any> {
    const root = this.rootNode
    if (!root) throw new Error('Missing root node')
    return this.makeNested(root)
  }

  public hasNode = computedFn(($id: NodeId): boolean => {
    return this.nodes.has($id)
  })
  public getNode = computedFn(($id: NodeId): NodeSchema<any> | undefined => {
    if (!$id) return
    return this.nodes.get($id)
  })
  public nodesAreEqual = computedFn(
    (left: NodesMap, right?: NodesMap): boolean => {
      const _right = right ? right : this.nodes
      return isEqual(toJS(left), toJS(_right))
    },
  )
  public getNodeParent = computedFn(
    (node: NodeSchema<any>): NodeSchema<any> | undefined => {
      if (!node) throw new Error('Invalid node')
      if (!node.parentId) return
      return this.getNode(node.parentId)
    },
  )
  public getNodeIndex = computedFn((node: NodeSchema<any>): number => {
    if (!node || !node.$id) throw new Error('Invalid node')
    const parent = this.getNodeParent(node)
    if (!parent) throw new Error('Invalid parent node')
    return parent.nodes?.indexOf(node.$id) ?? -1
  })
  public isRootNodeId = computedFn(
    (id: NodeId): id is string & typeof NODE_ROOT_ID => {
      return id === NODE_ROOT_ID
    },
  )
  public isRootNode = computedFn((node: NodeSchema<any>): boolean => {
    return node?.$id === NODE_ROOT_ID
  })
  public getNodeBreadcrumbPath = computedFn(
    (nodeOrId: NodeId | NodeSchema<any>): NodeBreadcrumbPath => {
      const hierarchy = [NODE_ROOT_ID]

      let currentId: string | undefined =
        typeof nodeOrId !== 'string' ? nodeOrId?.$id : nodeOrId
      while (currentId && !this.isRootNodeId(currentId)) {
        hierarchy.splice(1, 0, currentId)
        currentId = this.getNode(currentId)?.parentId
      }

      return hierarchy as NodeBreadcrumbPath
    },
  )
  public getNodeLabelShort = computedFn((node: NodeSchema<any>): any => {
    if (!node) throw new Error('Invalid node')
    if (this.isRootNode(node)) return NODE_ROOT_LABEL
    // A reusable-component instance stands for one specific definition, and
    // its component label is the same generic word for every one of them —
    // a page built from promoted sections reads as a column of identical
    // "Reusable Component" rows in the hierarchy and identical badges on the
    // canvas. The definition's name rides on the instance for exactly this
    // (`props.name`, AGL-1193), so prefer it. An explicit per-node `name`
    // still wins, since that is someone deliberately renaming this instance.
    const instanceName =
      node.componentId === REUSABLE_INSTANCE_COMPONENT_ID
        ? (node.props as { name?: unknown } | undefined)?.name
        : undefined
    const componentLabel =
      node.componentId && this.aglyn.components.getLabel(node.componentId)
    return (
      node?.name ||
      (_isStrT(instanceName) ? instanceName : undefined) ||
      componentLabel ||
      node?.$id
    )
  })

  /**
   * Whether a node can host inserted child nodes. The document root and
   * layout containers (Stack, Section, Container — anything with a real
   * children slot) can; a leaf whose component is self-closing or renders
   * its `children` as inline text (a screen link, button, icon, image) has
   * no slot to receive them and can't. Components with no registered schema
   * default to accepting children.
   *
   * `flags.dropping: DISABLED` is the third way to say "no canvas child
   * slot" (AGL-1388), for components that are neither self-closing nor text
   * leaves but still have nowhere to put a dropped node:
   *
   * - Markdown renders the parsed `content` prop and nothing else, so a
   *   dropped element lands somewhere the markdown source cannot say.
   * - A Reusable Component instance is opaque: compose REPLACES its child
   *   list with the grafted definition subtree, so a canvas-dropped child is
   *   destroyed before the page is rendered.
   * - A Layout Slot's children come from screen composition.
   *
   * The flag was declared on all three, and until now nothing read it —
   * which is exactly how three /press screenshots came to be parented under
   * a Markdown node, shipped in the page payload, and never drawn. A
   * container that accepts children in the hierarchy and discards them at
   * render is silent data loss: the author sees the nodes in the tree and
   * the published page does not have them.
   *
   * The rule itself lives in {@link schemaAcceptsChildren} (AGL-1389) so the
   * registry audit that enforces it cannot be checking a *copy* of it — a
   * second implementation would drift, and would then certify the editor's
   * behaviour against a rule the editor no longer follows.
   */
  public nodeAcceptsChildren = computedFn((node: NodeSchema<any>): boolean => {
    if (!node) return false
    if (this.isRootNode(node)) return true
    return schemaAcceptsChildren(
      this.aglyn?.components?.getSchema(node.componentId),
    )
  })

  /**
   * Resolve where a newly inserted node should attach, given the node the
   * user had selected (the Insert menu passes the current selection). A
   * container target — including the document-root fallback for a missing,
   * stale, or non-node target (AGL-537) — receives the node as an appended
   * child. A leaf target has no child slot, so the node lands as the leaf's
   * next sibling in its own container instead, mirroring how a
   * drag-and-drop side-drop resolves rather than nesting the node where it
   * can never render.
   */
  public resolveInsertTarget(target?: NodeSchema<any>): {
    parent: NodeSchema<any>
    index: number
  } {
    const root = this.getNode(NODE_ROOT_ID)!
    const requested =
      (typeof target?.$id === 'string' && this.getNode(target.$id)) || root
    if (this.nodeAcceptsChildren(requested)) {
      return { parent: requested, index: NaN }
    }
    const parent = this.getNodeParent(requested) ?? root
    const at = parent.nodes?.indexOf(requested.$id) ?? -1
    return { parent, index: at < 0 ? NaN : at + 1 }
  }

  public makeNested = computedFn((node: NodeSchema<any>) => {
    // Serialize to a plain schema object: a toJS copy would carry the node's
    // own toJSON arrow (bound to the live instance), which JSON.stringify
    // would then prefer over the nested structure built here.
    const newNode = (
      node instanceof AglynNode ? node.toJSON() : { ...toJS(node) }
    ) as unknown as NodeSchemaNested<any>

    const childNodes: NodeSchemaNested<any>[] = []
    for (const childId of (toJS(node.nodes) || []) as unknown as NodeId[]) {
      const child = this.getNode(childId)
      if (child) {
        const nested = this.makeNested(child)
        childNodes.push(nested)
      }
    }
    newNode.nodes = childNodes

    return newNode
  })

  private serializeNodes(): NodesMap {
    const nodes: NodesMap = {}
    this.nodes.forEach((node, id) => {
      nodes[id] = node.toJSON()
    })
    return nodes
  }

  public toJSON() {
    return { nodes: this.serializeNodes() }
  }

  public redo(): this {
    return this.restoreSnapshot(this._history.redo(this._epoch))
  }
  public undo(): this {
    return this.restoreSnapshot(this._history.undo(this._epoch))
  }
  public saveHistory(): this {
    this._history.saveHistory(this._epoch)
    return this
  }
  /**
   * Records that a REMOTE session changed `nodeId`, so a later local undo
   * does not roll that change back (AGL-1958).
   *
   * Call this from the co-editing apply path for every node a peer creates,
   * changes or deletes — including the delete, whose absence is as much a
   * remote state as a value is.
   *
   * ## Why this is needed at all
   *
   * Applying a remote change deliberately does NOT record local history
   * (AGL-677 rule 1), which keeps a colleague's edit out of your undo
   * stack. That is necessary and it is not sufficient. Every entry already
   * in the stack is a snapshot of the WHOLE document taken before one of
   * your edits, and a colleague's later edit is by definition not in it. So
   * an undo that replays such a snapshot wholesale reverts their node too,
   * and — because the reverted map is then diffed against the co-editing
   * shadow like any other local edit — publishes that revert back to them
   * under YOUR session id. Their work is destroyed on their screen, with no
   * signal and nothing that restores it.
   *
   * Measured before this fix: a peer's edit came back reverted, and a node
   * the peer had CREATED was deleted outright.
   *
   * ## An apply that changed nothing is not a peer edit (AGL-2486)
   *
   * `previousJson` is the node's serialization from BEFORE the apply. When
   * the apply left it byte-for-byte identical, this records nothing: no
   * mark, no epoch bump. That is not an optimisation, it is the difference
   * between a peer edit and an ECHO, and getting it wrong broke undo
   * outright.
   *
   * The mirror is per node and every session in the room republishes what it
   * holds, so a value you wrote can come back to you from ANOTHER SESSION —
   * your own second tab most of all, which is ordinary once same-account
   * sessions count as co-editors. The room already drops your own tab's
   * echoes by session id, but not another session's echo of your value.
   *
   * Marking that echo is fatal because the mark is what {@link
   * restoreSnapshot} reads. It lands with a FRESH epoch, therefore newer
   * than every snapshot already on your stack, so the overlay puts the live
   * value back over each one of them. Undo then consumed its entry and
   * changed nothing at all — measured on the running editor, one account,
   * two tabs on one screen: `past: 0, future: 1, canUndo: false`, the node
   * still holding the edit that had just been undone.
   *
   * Note what this deliberately does NOT do: it does not ask whose session
   * or whose account the change came from. A genuinely different value from
   * your other tab is a real concurrent edit with its own undo stack and is
   * protected like any other. "Foreign" keeps its one meaning — a session
   * other than this tab moved this node — and the defect was counting a
   * non-change as a change.
   */
  public markRemoteNode(nodeId: NodeId, previousJson?: string): this {
    if (!nodeId) return this
    if (previousJson !== undefined) {
      const live = this.nodes.get(nodeId)
      const nowJson = live ? JSON.stringify(live.toJSON()) : undefined
      if (nowJson === previousJson) return this
    }
    this._foreignAt.set(nodeId, ++this._epoch)
    return this
  }
  /**
   * A node's serialization as it stands right now, for handing back to
   * {@link markRemoteNode} after an apply — the "before" half of the echo
   * test. `undefined` when the node is not in the map.
   */
  public serializeNode(nodeId: NodeId): string | undefined {
    const node = this.nodes.get(nodeId)
    return node ? JSON.stringify(node.toJSON()) : undefined
  }
  /**
   * Restores a history snapshot, keeping every node a remote session has
   * touched SINCE that snapshot was taken (AGL-1958).
   *
   * The epoch comparison is the whole mechanism, and it is what keeps undo
   * honest rather than merely safe:
   *
   * * `foreignAt > snapshot.epoch` — the peer's change landed *after* this
   *   snapshot, so the snapshot predates it and would roll it back. Keep
   *   what is live now: the current value, or the node's absence when the
   *   peer deleted it.
   * * `foreignAt <= snapshot.epoch` — the snapshot was taken after the
   *   peer's change and therefore already contains it. Restore it normally,
   *   or undo would stop rewinding your own edits to co-edited nodes.
   *
   * A node both you and a peer changed resolves to the peer's value, which
   * is the same last-writer-wins rule the per-node mirror applies
   * everywhere else (AGL-677) rather than a new one invented here.
   *
   * A peer that adds a child republishes the parent's child list, so the
   * parent is marked too and its list survives with the child.
   *
   * ## Both directions, and why redo is not the special case it looks like
   *
   * This serves {@link redo} as well as {@link undo}, and the stamp is what
   * makes that work rather than a second rule (AGL-2486). A `future` entry
   * replays a state from before the undo, so the intuition is that it must
   * predate any later peer change and roll it back. It does not:
   * `HistoryManager.undo` captures the present and stamps it with the epoch
   * AT THE TIME OF THE UNDO, so a peer change that lands between the undo
   * and the redo is strictly newer than `snapshot.epoch` and is kept here —
   * including a node the peer CREATED in that gap, which the `future` entry
   * has no key for at all and a bare replace would broadcast as a delete.
   */
  private restoreSnapshot(
    snapshot: HistorySnapshot<NodeId, NodeSchema<any>>,
  ): this {
    const json: Record<NodeId, NodeSchema<any>> = Object.fromEntries(
      snapshot.nodes.entries(),
    )
    this.setNodes(this.withForeignNodes(json, snapshot.epoch) as NodesMap)
    return this
  }
  /**
   * Overlays the nodes a remote session has touched since `sinceEpoch` onto a
   * map about to REPLACE the canvas — the current value, or the node's
   * absence when the peer deleted it (AGL-1958).
   *
   * Shared by {@link restoreSnapshot} and {@link applyNodes} because it is
   * one rule, not two: any wholesale replace composed without knowledge of a
   * peer's change would otherwise roll that change back and — through the
   * co-editing diff — publish the rollback to its author.
   *
   * Mutates and returns `json`; callers pass a map they own.
   */
  private withForeignNodes(
    json: Record<NodeId, NodeSchema<any>>,
    sinceEpoch: number,
  ): Record<NodeId, NodeSchema<any>> {
    for (const [nodeId, at] of this._foreignAt) {
      if (at <= sinceEpoch) continue
      const live = this.nodes.get(nodeId)
      if (live) json[nodeId] = live
      else delete json[nodeId]
    }
    return json
  }
  /**
   * Whether any REMOTE session has changed this canvas since it loaded
   * (AGL-2486).
   *
   * The draft prompt reads it to decide whether offering a private
   * per-browser snapshot back is still honest: once a colleague's live work
   * is on the canvas, applying an older whole-document snapshot is not
   * "restore my unsaved changes" but "roll the shared canvas back".
   *
   * `_epoch` only ever moves in {@link markRemoteNode}, so a non-zero epoch
   * IS "a peer has touched this canvas", and {@link reset} returns it to zero
   * with the rest of the session.
   */
  public get hasRemoteEdits(): boolean {
    return this._epoch > 0
  }
  /**
   * Runs `mutate` as one undoable step (AGL-1204).
   *
   * Every mutator on this class records history for itself, but a panel that
   * writes `node.sx` directly does not go through any of them — the Styles and
   * custom-CSS forms assign to the node, so an undo after a style change
   * restored the last *recorded* snapshot instead, silently discarding
   * everything done since. This is the seam those panels were missing.
   *
   * **`coalesceKey` is what makes it usable for a live-applying control.**
   * Those forms fire on every change — one per character typed, one per drag
   * tick of a slider — so recording unconditionally would replace "undo does
   * not step back far enough" with "undo steps back one character", which is
   * no better. Consecutive calls sharing a key inside {@link
   * COALESCE_WINDOW_MS} record **once**, at the start of the burst, so the
   * snapshot is the state *before* the adjustment began. Omit the key for a
   * discrete commit (a toggle, an Apply button) that deserves its own step.
   *
   * The window is evaluated on call rather than by a timer: a burst ends
   * because the next edit arrives late, not because something fired in the
   * background. That keeps the canvas free of pending timers it would have to
   * cancel on {@link reset}, and keeps this testable without fake clocks.
   *
   * The key should identify *what* is being adjusted, not just the node —
   * moving from Gap to Padding is a second adjustment even if it happens
   * within the window.
   */
  public transact<T>(mutate: () => T, coalesceKey?: string): T {
    const now = Date.now()
    const burst = this._coalescing
    const continues =
      coalesceKey !== undefined &&
      burst?.key === coalesceKey &&
      now - burst.at < CanvasManager.COALESCE_WINDOW_MS
    if (!continues) this.saveHistory()
    this._coalescing =
      coalesceKey === undefined ? undefined : { key: coalesceKey, at: now }
    return mutate()
  }
  /**
   * Drops BOTH history stacks and any open {@link transact} burst.
   *
   * Both, deliberately (AGL-2486). This used to clear `past` alone, which
   * left a caller that had just "cleared history" holding a live redo stack
   * — `canRedo` still true, still offering a snapshot of the state before
   * the clear. `reset` was the only caller and compensated for it a line
   * later, which is exactly how the next caller inherits the trap.
   *
   * A stale redo is worse than a stale undo in a co-editing session: redo
   * replays a WHOLE-DOCUMENT snapshot, and the restored map is diffed
   * against the co-editing shadow and published, so every node the snapshot
   * does not have goes out as a delete under this session's id.
   */
  public clearHistory() {
    this._history.clearHistory()
    this._coalescing = undefined
  }
  public createNodeId(): NodeId {
    return createIdUrlSafe()
  }
  public createNode(
    schema: PartialKeys<NodeSchema<any>, '$id'>,
  ): NodeSchema<any> {
    return new AglynNode<any>(
      {
        ...schema,
        $id: schema?.$id || this.createNodeId(),
      } as NodeSchema<any>,
      this,
    )
  }
  public clearNodes() {
    this.nodes.clear()
    return this
  }
  /**
   * Returns the canvas to its pristine state (no nodes, no history, no
   * recorded initial snapshot). The canvas is an app-level singleton shared
   * by every editing session — call this when a session ends so the next
   * document doesn't inherit stale content.
   */
  public reset() {
    this.clearNodes()
    this.clearHistory()
    this._initial = undefined
    this._initialConfirmed = true
    // A new document gets a new epoch line. Stale marks would otherwise
    // preserve node ids that mean something else here (AGL-1958).
    this._foreignAt.clear()
    this._epoch = 0
    return this
  }
  /**
   * Record the state the canvas should be considered saved against.
   *
   * `confirmed` is what makes this honest. Pass `false` when the map came
   * from a source the STORE has not acknowledged — a Firestore snapshot
   * carrying this client's own pending write is the case that motivated it
   * (AGL-1262): the document is loaded and must be shown, but nothing in it
   * is known to have reached the server, so it must not be adopted as
   * "already saved". An unconfirmed baseline keeps {@link isInitialSame}
   * false — the editor stays savable — until a real save records a
   * confirmed one.
   */
  public updateInitialNodes(nodes?: NodesMap, options?: { confirmed?: boolean }) {
    this._initial = nodes ? (toJS(nodes) as NodesMap) : this.serializeNodes()
    this._initialConfirmed = options?.confirmed ?? true
    return this
  }
  /**
   * Promote an UNCONFIRMED baseline to a confirmed one, once the store has
   * acknowledged the write that made it unconfirmed (AGL-2486).
   *
   * Without this there is no way back. `_initialConfirmed` moves to true in
   * only two other places — {@link reset} and {@link updateInitialNodes} —
   * and the editor records its baseline exactly once, on the first snapshot
   * that carries nodes. A document whose first snapshot happens to carry
   * this client's own queued write therefore reads dirty for the rest of the
   * session over content nobody has edited.
   *
   * Conditional on the canvas still MATCHING the baseline, which is what
   * keeps AGL-1262 intact. The acknowledgement is for the write that was in
   * flight, and says nothing about work the author has done since; adopting
   * a canvas that has moved on would call that work saved and take away the
   * only control that could still write it.
   *
   * @returns whether the baseline is confirmed as a result.
   */
  public confirmInitialNodes(): boolean {
    if (!this._initial) return false
    if (this._initialConfirmed) return true
    if (!isEqual(this._initial, this.serializeNodes())) return false
    this._initialConfirmed = true
    return true
  }
  /**
   * Registers a node in the map AND lists it on `parent`, in one action
   * (AGL-1366).
   *
   * `parent` is required, and that is the whole point: this was the last way
   * left to put an entry in `this.nodes` with no parent linkage at all. The
   * besigner saves a flat map and renders a tree — `serializeNodes` dumps
   * every entry in the map while the renderer walks child lists down from
   * `NODE_ROOT_ID` — so a node the map holds and no parent lists is not a
   * rendering glitch that a reload clears. It is saved on every save,
   * shipped in every payload, counted against the 1 MiB ceiling, and never
   * drawn. That is the mechanism behind the 61 unreachable nodes `/product`
   * served, 26 of them carrying the only copy of two Hero sections' text
   * (AGL-1363).
   *
   * An *optional* parent would not have closed it, because the caller who
   * omits it is precisely the caller who creates the orphan. So the linkage
   * is not a second step a caller may forget — it happens here, and the
   * parent is resolved through `getNode($id)` and throws on a miss: the same
   * guard `addNodeFromNested` has carried since AGL-537 and `reparentNode`
   * took on in AGL-1363, rather than a second mechanism. A stale instance a
   * panel closure kept across a co-editor's merge, or a parent a peer has
   * since deleted, therefore fails loud instead of stranding the node.
   *
   * Linking is idempotent: re-setting a node its parent already lists
   * replaces the map entry and leaves the child list untouched, so this
   * stays usable as an update.
   *
   * The root is refused outright — it has no parent to be listed on, and
   * seeding it belongs to `setNodes`, which alone keeps its canonical id.
   */
  public setNode(
    node: NodeSchema<any>,
    parent: NodeSchema<any> | NodeId,
    index = NaN,
    create = false,
  ): NodeSchema<any> {
    if (!node) throw new Error('Invalid node')
    if (!create && !node.$id) throw new Error('Invalid node id')
    if (this.isRootNode(node)) throw new Error('Cannot set root node')

    // Resolve through the LIVE map BEFORE anything is inserted, so a refused
    // call leaves the canvas exactly as it found it.
    const parentId = typeof parent === 'string' ? parent : parent?.$id
    const target = parentId != null ? this.getNode(parentId) : undefined
    if (!target) throw new Error('Invalid parent node')

    return runInAction(() => {
      const _node = create ? this.createNode(node) : node
      // Both directions of the link are set here; a `parentId` disagreeing
      // with the list that holds the id is the same orphan by another route.
      _node.parentId = target.$id
      this.nodes.set(_node.$id!, _node)
      // Read-back, not `(target.nodes ||= []).push()` — see reparentNode
      // (AGL-763): the `||=` value is the detached plain array on an
      // observable.
      if (!target.nodes) target.nodes = []
      if (!target.nodes.includes(_node.$id!)) {
        if (isNaN(index)) target.nodes.push(_node.$id!)
        else target.nodes.splice(index, 0, _node.$id!)
      }
      return this.nodes.get(_node.$id!)!
    })
  }
  public setNodes(schemas: NodesMap, merge = false): this {
    if (!schemas) throw new Error('Invalid schemas')
    // Replacing the map ends any open {@link transact} burst (AGL-1204).
    // This is the seam a co-editor's incoming change arrives through, and
    // the one an undo restores through: in both cases the state the open
    // burst snapshotted is no longer the state the next edit is adjusting,
    // so the next edit must record its own step rather than fold into it.
    this._coalescing = undefined
    const cloned = toJS(schemas)
    const nodes: Record<NodeId, NodeSchema<any>> = {}
    for (const nodeId in cloned) {
      const node = cloned[nodeId]
      if (!node) continue
      // Persisted maps key nodes by id. Early seeds omitted $id (which used
      // to mint a random one), and the root must always keep the canonical
      // id — the map key is authoritative.
      const $id =
        nodeId === NODE_ROOT_ID ? NODE_ROOT_ID : (node.$id ?? nodeId)
      nodes[nodeId] = this.createNode({ ...node, $id })
    }
    if (merge) {
      this.nodes.merge(nodes)
    } else {
      this.nodes.replace(nodes)
    }
    return this
  }
  /**
   * Replaces the whole node map with a map the USER supplied — the raw-JSON
   * editor, and the local draft the crash net offers back (AGL-2486).
   *
   * Snapshots first, so the replacement is undoable — unlike `setNodes`,
   * which also serves the history-restore and initial-load paths.
   *
   * **Every node a remote session has touched survives it**, on exactly the
   * reasoning AGL-1958 established for undo. A wholesale replace is the same
   * shape of write as a snapshot restore: the map being applied was composed
   * without any knowledge of the peer's later changes, and the result is
   * diffed against the co-editing shadow and published, so a node the map
   * happens to lack is broadcast as a DELETE under this session's id.
   * Measured on the running editor before this changed (AGL-2486): a peer
   * created a node, the other session pressed Restore, and the node vanished
   * from the peer's own canvas with an RTDB tombstone to show for it.
   *
   * Every mark counts, not only those newer than some epoch: unlike a
   * snapshot, an applied map carries no epoch of its own, and a draft was by
   * definition composed before this page joined the room.
   */
  public applyNodes(value: ProcessableNodes): this {
    this.saveHistory()
    const parsed = this.processNodesToDenormalized(value)
    return this.setNodes(
      this.withForeignNodes({ ...parsed }, 0) as typeof parsed,
    )
  }
  public deleteNode(node: NodeSchema<any>): this {
    const validateNode = (node: NodeSchema<any>) => {
      if (!node || !node?.$id || !node?.parentId)
        throw new Error('Invalid node')
      if (this.isRootNode(node)) throw new Error('Cannot delete root node')
    }

    validateNode(node)
    this.saveHistory()

    const del = (node: NodeSchema<any>) => {
      validateNode(node)
      const parent = this.getNode(node.parentId!)
      if (!parent) throw new Error('Invalid parent node')
      const index = parent.nodes?.indexOf(node.$id) ?? -1
      const nodes = toJS(node.nodes || [])

      for (const childId of [...nodes]) {
        const child = this.getNode(childId)
        if (child) del(child)
      }

      if (index > -1) parent.nodes?.splice(index, 1)
      this.nodes.delete(node.$id)
    }
    del(node)
    return this
  }
  /**
   * Moves a node under `newParent`, resolving BOTH ends through the live
   * node map first (AGL-1363).
   *
   * The resolution is the guard, and it is the same one `addNodeFromNested`
   * has carried since AGL-537. This method splices the node out of its
   * *live* old parent and then attaches it to the object it was handed — so
   * a `newParent` that is merely SHAPED like a node (a stale instance a
   * panel closure kept across a co-editor's merge, a node a peer has since
   * deleted, historically a click event) took the node out of the tree and
   * pushed its id onto a detached array. Nothing put it back.
   *
   * That is not a recoverable glitch: `serializeNodes` dumps the whole map
   * while the renderer walks the tree from `NODE_ROOT_ID`, so a node in the
   * map that no live parent lists is saved on every save, shipped in every
   * payload, counted against the 1 MiB ceiling — and never drawn. It is why
   * `/product` served 61 unreachable nodes, 26 of them carrying the only
   * copy of two Hero sections' text. Fail loud instead.
   *
   * `index` is the node's position in the resulting sibling list — i.e. it is
   * read AFTER the node has been spliced out of wherever it was. A caller
   * holding a drop marker ("put it before the sibling currently at 3") is
   * describing the list BEFORE the removal and has to convert; the dnd
   * manager does exactly that for same-parent drops.
   */
  public reparentNode(
    node: NodeSchema<any>,
    newParent: NodeSchema<any>,
    index = NaN,
  ): typeof node {
    if (!node) throw new Error('Invalid node')
    if (this.isRootNode(node)) throw new Error('Cannot move root node')
    if (!newParent) throw new Error('Invalid parent node')

    // Every refusal below runs before `saveHistory`: a move that never
    // happened must not leave an undo step behind it.
    const target = node.$id != null ? this.getNode(node.$id) : undefined
    if (!target) throw new Error('Invalid node')
    const parent =
      newParent.$id != null ? this.getNode(newParent.$id) : undefined
    if (!parent) throw new Error('Invalid parent node')

    const oldParent = this.getNodeParent(target)
    const oldIndex = oldParent?.nodes?.indexOf(target.$id) ?? -1
    const sameParent = oldParent?.$id === parent.$id

    if (!sameParent) {
      // A node into its own subtree detaches that subtree from the document
      // and hands the renderer a cycle. `breadcrumbPath` is the ancestor
      // chain, so the target appearing in the new parent's is the whole test
      // — and it covers `parent === target` on its own.
      if (this.getNodeBreadcrumbPath(parent)?.some((id) => id === target.$id)) {
        throw new Error('Cannot move an element inside itself')
      }

      /**
       * The gate that was missing (AGL-1405). `nodeAcceptsChildren` guarded
       * every path that CREATES a node — the Insert menu and paste through
       * `resolveInsertTarget`, drag-and-drop through the dnd manager — but
       * not the one that MOVES one. So a `markdown` block (or any component
       * whose content is an attribute: a Reusable Component instance, a
       * Layout Slot, a List Item Text) could still be handed a child, which
       * it then renders nowhere. That is not a cosmetic mistake: the node is
       * saved on every save and shipped in every payload while the page it
       * belongs to shows nothing, so the work reads as never done rather
       * than broken. Three /press screenshots are still sitting in exactly
       * that hole, and the point of the click-path this guard protects is
       * that it must not be able to dig another one.
       *
       * A same-parent reorder is deliberately NOT gated: the nodes already
       * trapped by AGL-1388 have to stay shufflable, and `reorderNode`
       * routes Shift up / Shift down straight through here.
       */
      // Deliberately label-free: `getNodeLabelShort` reaches into the
      // component registry, and a refusal path that can itself throw is no
      // refusal at all. Callers that want "Markdown can't hold elements"
      // name the node themselves — `moveNodeOut`/`moveNodeIn` do.
      if (!this.nodeAcceptsChildren(parent)) {
        throw new Error('That element cannot hold other elements')
      }
    }

    // Assign then read back, never `(x.nodes ||= []).push()` (AGL-763). A
    // live node is a `makeAutoObservable` proxy: assigning a fresh `[]` stores
    // an observable copy, but the `||=` expression evaluates to the plain
    // array that was assigned — so pushing onto it writes to a detached array
    // and the child silently orphans. `AglynNode`'s constructor seeds `nodes`
    // so this never actually fires today, but relying on that invariant from
    // here is how the same defect returned as AGL-759.
    if (!parent.nodes) parent.nodes = []

    // Resolve the landing slot against the list as it will be AFTER the
    // removal, and clamp it. `splice(-1, 0, id)` inserts before the LAST
    // element, so an unclamped negative index moved a first child DOWN —
    // `reorderNode(node, node.index - 1)` on index 0 did precisely that, and
    // only the menu's `disabled` prop hid it.
    const settled = parent.nodes.length - (sameParent && oldIndex > -1 ? 1 : 0)
    const at = isNaN(index) ? settled : Math.min(Math.max(index, 0), settled)

    // A move that resolves to the slot the node already occupies is not a
    // move. It used to cost an undo step anyway — which is how a hierarchy
    // drag came to "record an undo entry without moving anything" (AGL-1405),
    // and worse, made the next Undo discard the author's PREVIOUS edit.
    if (sameParent && at === oldIndex) return target

    this.saveHistory()
    if (oldIndex > -1) oldParent?.nodes?.splice(oldIndex, 1)
    if (!sameParent) target.parentId = parent.$id
    parent.nodes.splice(at, 0, target.$id)
    return target
  }
  public reorderNode(node: NodeSchema<any>, index = NaN): typeof node {
    if (!node) throw new Error('Invalid node')
    // Resolve the node first, so the parent is read off the LIVE node's
    // `parentId` rather than a stale copy's (AGL-1363).
    const target = node.$id != null ? this.getNode(node.$id) : undefined
    if (!target) throw new Error('Invalid node')
    const parent = this.getNodeParent(target)
    if (!parent) throw new Error('Invalid parent node')
    return this.reparentNode(target, parent, index)
  }
  public duplicateNode(node: NodeSchema<any>): NodeSchema<any> {
    if (!node) throw new Error('Invalid node')
    if (this.isRootNode(node)) throw new Error('Cannot duplicate root node')
    const parent = this.getNodeParent(node)
    if (!parent) throw new Error('Invalid parent node')

    const duplicateNodeAndChildren = (
      node: NodeSchema<any>,
      parentId: NodeId,
      index = NaN,
    ): NodeSchema<any> => {
      if (!node) throw new Error('Invalid node')

      const json = toJS(node)
      // `setNode` registers the copy AND lists it on its parent, so no copy
      // can be left in the map unreferenced — the linkage is no longer a
      // separate step this recursion could get wrong (AGL-1366).
      const newNode = this.setNode(
        this.createNode({
          ...json,
          $id: this.createNodeId(),
          parentId,
          nodes: [],
        }),
        parentId,
        index,
      )
      if (!json) return newNode

      for (const childId of arraySafe(json.nodes)) {
        const child = childId && this.getNode(childId)
        if (child) duplicateNodeAndChildren(child, newNode.$id!)
      }

      return newNode
    }

    this.saveHistory()
    const nodeIndex = this.getNodeIndex(node)
    const index =
      nodeIndex === -1 ? parent.nodes?.length ?? 0 : nodeIndex + 1
    // One action, so observers never see the copy listed on its parent
    // before its own subtree has been built under it.
    return runInAction(() =>
      duplicateNodeAndChildren(node, node.parentId!, index),
    )
  }
  public createDuplicateNode(
    node: NodeSchemaNested<any>,
  ): NodeSchemaNested<any> {
    const $id = this.createNodeId()
    const cloned = toJS(node)
    const nodes = Array.isArray(cloned?.nodes) ? [...cloned.nodes] : []
    const res: NodeSchemaNested<any> = { ...cloned, $id, nodes: [] }
    for (const child of nodes) {
      const childDuplicate = this.createDuplicateNode({
        ...child,
        parentId: $id,
      })
      res.nodes!.push(childDuplicate)
    }
    return res
  }
  /**
   * Insert a *detached* nested subtree as a child of `parent`, minting a
   * fresh id for every node in it (AGL-1202).
   *
   * The subtree is plain JSON with no ties to this canvas, so the source can
   * be anything — an element preset, the besigner clipboard, or a subtree
   * copied out of a different document altogether. Callers are responsible
   * for checking that the root's component is registered and that the
   * lineal relationship with `parent` is allowed; this method only does the
   * structural work.
   */
  public addNodeFromNested(
    nested: NodeSchemaNested<any>,
    parent: NodeSchema<any>,
    index = NaN,
  ): NodeSchema<any> {
    if (!nested) throw new Error('Invalid node')
    // Attach to the live node in this canvas. A caller-supplied object
    // that is not in the node map (a stale reference — or historically the
    // console INSERT menu's click event) would otherwise get the child id
    // pushed onto ITS `nodes` array while the child lands in the map as a
    // detached node: absent from the hierarchy, the canvas, and saves
    // (AGL-537). Fail loud instead of corrupting the tree.
    const target = parent?.$id != null ? this.getNode(parent.$id) : undefined
    if (!target) throw new Error('Invalid parent node')
    this.saveHistory()
    const duplicate = this.createDuplicateNode(nested)
    duplicate.parentId = target.$id
    const parsed = this.processNodesToDenormalized(duplicate)

    // Register the subtree and append the child id in one action so
    // observers never see the intermediate detached state.
    runInAction(() => {
      this.setNodes(parsed, true)
      // Read-back, not `(target.nodes ||= []).push()` — see reparentNode
      // (AGL-763): the `||=` value is the detached plain array on an observable.
      if (!target.nodes) target.nodes = []
      if (isNaN(index)) target.nodes.push(duplicate.$id)
      else target.nodes.splice(index, 0, duplicate.$id)
    })

    return this.getNode(duplicate.$id)!
  }

  public addNodeFromPreset(
    preset: PresetSchema<any>,
    parent: NodeSchema<any>,
    index = NaN,
  ): NodeSchema<any> {
    if (!preset) throw new Error('Invalid preset')
    return this.addNodeFromNested(toJS(preset).data, parent, index)
  }
  /**
   * REPLACES a node's props — callers spread the current ones to merge.
   *
   * An editor form submits every field it renders, so keys the author left
   * empty arrive as `undefined`. Those are dropped here rather than stored as
   * own keys (AGL-1334): for a props bag that is REPLACED wholesale, absent IS
   * cleared, and an `undefined` member is a value no storage layer accepts.
   * `AglynNode.toJSON` strips again at the write boundary — this one keeps the
   * live tree honest for everything that reads it before a save.
   */
  /**
   * Writes top-level node FIELDS, with an undo step (AGL-1480).
   *
   * The sibling of {@link updateNodeProps}, and it exists for the same two
   * reasons that one documents. An edit with no `saveHistory` is an edit the
   * author cannot take back — and every panel that assigned to a node
   * directly was quietly in that state. And it re-resolves by `$id`: callers
   * hold node objects across time (the focus store keeps the selection that
   * way), while every wholesale replace of the map — `undo`, `redo`,
   * `applyNodes`, a draft restore — builds fresh instances. Assigning to the
   * caller's copy then mutates an orphan: no error, no dirty state, and the
   * author's edit is simply gone.
   *
   * Only the keys the patch names are touched, and `undefined` clears one —
   * which is how a cleared style or a shown element is stored, since `toJSON`
   * omits what is undefined.
   */
  public updateNodeFields(
    node: NodeSchema<any>,
    patch: Partial<NodeSchema<any>>,
  ): void {
    if (!node) throw new Error('Invalid node')
    this.saveHistory()
    const target = this.getNode(node.$id) ?? node
    Object.assign(target, patch)
  }

  public updateNodeProps(
    node: NodeSchema<any>,
    props: NodeSchema<any>['props'],
  ): void {
    if (!node) throw new Error('Invalid node')
    this.saveHistory()
    // Write to the node the MAP holds, not the reference the caller kept
    // (AGL-2486). Callers hold node objects across time — the besigner's
    // focus store keeps the selection that way — and every wholesale replace
    // of the map (`undo`, `redo`, `applyNodes`, a draft restore) builds fresh
    // instances. Assigning to the caller's copy then mutates an orphan: no
    // error, no dirty state, and the author's edit is simply gone. Re-resolve
    // by `$id` so the write always reaches the canvas.
    //
    // The fallback keeps a node that is genuinely not in the map — deleted,
    // or never inserted — behaving as before rather than being resurrected.
    const target = this.getNode(node.$id) ?? node
    target.props = stripUndefinedDeep({ ...props })
  }

  public static nestDenormalizedNodes(
    nodes: NodesMap,
    rootId: NodeId = NODE_ROOT_ID,
  ): NodeSchemaNested<any> {
    const rootNode = nodes[rootId]
    if (!rootNode) throw new Error('Invalid root node')
    const response = { ...(rootNode as unknown as NodeSchemaNested<any>) }
    const children: NodeSchemaNested<any>[] = []
    // `?? []`, not `||= []` — a read-only walk should not mutate its input
    // (AGL-763).
    for (const id of rootNode.nodes ?? []) {
      const child = { ...nodes[id] }
      const nestedChild = this.nestDenormalizedNodes(nodes, child.$id)
      children.push(nestedChild)
    }
    response.nodes = children
    return response
  }

  public denormalizeNodes(
    nodes: NodeSchemaNested<any>[],
    parentId: NodeId,
    accumulator: NodesMap = {},
  ): NodesMap {
    return CanvasManager.denormalizeNodes(nodes, parentId, accumulator)
  }
  public static denormalizeNodes(
    nodes: NodeSchemaNested<any>[],
    parentId: NodeId,
    accumulator: NodesMap = {},
  ): NodesMap {
    for (const childNode of Array.isArray(nodes) ? nodes : []) {
      const child =
        _isStrT(childNode) && accumulator[childNode]
          ? accumulator[childNode]
          : childNode
      if (!_isObj(child)) continue

      const node = cloneDeep(child) as unknown as NodeSchema<any>

      // TODO: Remove after migration to nodes property
      if (node['elements']) {
        node.nodes = node['elements']
        delete node['elements']
      }
      // TODO: Remove after migration to pluginId property
      if (node['bundleId']) {
        node.pluginId = node['bundleId']
        delete node['bundleId']
      }

      const nodes = (node as unknown as NodeSchemaNested<any>)?.nodes
      const nodesArray = [...(Array.isArray(nodes) ? nodes : [])].filter(
        Boolean,
      )
      accumulator[node.$id] = {
        ...node,
        parentId,
        nodes: [...nodesArray]
          .map((i) => {
            if (_isStrT(i)) return i
            if (_isObj(i)) return i.$id
            return null
          })
          .filter(Boolean),
      }
      this.denormalizeNodes(nodesArray, node.$id, accumulator)
    }

    return accumulator
  }

  public processNodesToDenormalized(value: ProcessableNodes): NodesMap {
    return CanvasManager.processNodesToDenormalized(value)
  }
  public static processNodesToDenormalized(value: ProcessableNodes): NodesMap {
    let response: NodesMap = {}
    const isArray = Array.isArray(value)

    if (isArray && value.length === 1) {
      const item = value[0]
      if (item?.$id === NODE_ROOT_ID) {
        response = this.denormalizeNodes(
          [{ ...item, parentId: null }],
          NODE_ROOT_ID,
          response,
        )
      } else if (item?.parentId === NODE_ROOT_ID || (item && item.parentId)) {
        response = this.denormalizeNodes(
          [{ $id: NODE_ROOT_ID, componentId: 'div', nodes: [item] }],
          NODE_ROOT_ID,
          response,
        )
      } else if (item?.parentId) {
        response = this.denormalizeNodes(
          [{ $id: item?.parentId, componentId: 'div', nodes: [item] }],
          item?.parentId,
          response,
        )
      } else {
        response = this.denormalizeNodes(
          [{ $id: NODE_ROOT_ID, componentId: 'div', nodes: [] }],
          NODE_ROOT_ID,
          response,
        )
      }
    } else if (isArray) {
      response = this.denormalizeNodes(
        [{ $id: NODE_ROOT_ID, componentId: 'div', nodes: [...value] }],
        NODE_ROOT_ID,
        response,
      )
    } else if (
      _isObj(value) &&
      Array.isArray(value?.nodes) &&
      typeof value.nodes[0] !== 'string'
    ) {
      const _value = { ...(value as NodeSchemaNested<any>) }
      response = this.denormalizeNodes(
        [_value],
        _value?.parentId || NODE_ROOT_ID,
        response,
      )
    } else {
      response = value as unknown as NodesMap
    }

    return response
  }
}

export default CanvasManager
