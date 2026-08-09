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

import type {
  AglynNodeSchema,
  NodeId,
  ReusableComponentIcon,
  ReusableComponentProp,
} from '../foundation'
import { mergeNodeSx } from './merge-node-sx'
import { resolveNamedTokens } from './resolve-named-tokens'

/**
 * Persisted component id of a reusable-component instance node. Persisted in
 * screen documents — never rename (cf. `layoutSlot`, legacy `muiXxx` ids).
 */
export const REUSABLE_INSTANCE_COMPONENT_ID = 'reusableInstance'

/**
 * Prop key on an instance node holding its per-instance prop values, keyed
 * by declared prop name (AGL-1247).
 *
 * Nested under one key rather than spread across the instance's own props
 * so a prop named `refId` or `name` cannot shadow the reference itself, and
 * so the string-prop walkers (`resolveNodesBindings`, the sanitizers) skip
 * the whole object — values reach a page only through the graft below.
 */
export const REUSABLE_INSTANCE_PROP_VALUES_KEY = 'propValues'

/**
 * `styleOverrides` key addressing the component ROOT (AGL-1306). Persisted
 * in screen documents — never rename. Component-internal node ids key the
 * per-leaf overrides beside it (AGL-1332); the definition root is addressed
 * by this constant rather than its id so the same override survives a
 * republish that reroots the definition.
 */
export const STYLE_OVERRIDES_ROOT_KEY = 'root'

const isStyleRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).length > 0

/**
 * Every per-instance style override an instance node carries, keyed the way
 * it is stored (AGL-1332): {@link STYLE_OVERRIDES_ROOT_KEY} for the
 * component root, and a DEFINITION-internal node id for each overridden
 * leaf. Empty for a node that is not an instance or carries none.
 *
 * Keyed on the definition's own id, never the grafted `cmp__…` id: the
 * graft id is DERIVED from the instance id, so keying on it would break the
 * moment a subtree was duplicated or an instance re-keyed, and two
 * instances of one component could not share the same authoring vocabulary.
 * Entries that are not a non-empty plain object are dropped here rather
 * than at each call site — a `null`, a string, or a cleared `{}` must read
 * as "no override" identically in the graft, in detach and in the panel.
 *
 * Deliberately here rather than in a render surface: this file owns what
 * an instance node looks like, and the graft below is the ONE place the
 * overrides are applied — canvas, Preview and tenant SSR all call
 * {@link composeReusableComponentNodes}, so they cannot disagree about
 * what an override means.
 */
export function getInstanceStyleOverrides(
  node: { componentId?: string; styleOverrides?: unknown } | undefined | null,
): Record<string, Record<string, unknown>> {
  if (node?.componentId !== REUSABLE_INSTANCE_COMPONENT_ID) return {}
  const overrides = node?.styleOverrides as Record<string, unknown> | undefined
  if (!isStyleRecord(overrides)) return {}
  const clean: Record<string, Record<string, unknown>> = {}
  for (const [key, value] of Object.entries(overrides)) {
    if (key && isStyleRecord(value)) clean[key] = value
  }
  return clean
}

/**
 * The sx-shaped ROOT style override carried by an instance node, or
 * `undefined` when the node is not an instance or carries none — the
 * AGL-1306 half of {@link getInstanceStyleOverrides}.
 */
export function getInstanceRootStyleOverride(
  node: { componentId?: string; styleOverrides?: unknown } | undefined | null,
): Record<string, unknown> | undefined {
  return getInstanceStyleOverrides(node)[STYLE_OVERRIDES_ROOT_KEY]
}

/**
 * The `{ sx }` patch one definition node takes from an instance's
 * overrides, or `undefined` when none applies (AGL-1332).
 *
 * Two layers, coarse first: the root slice when this node IS the
 * definition root, then the node's own definition-id slice. Both go
 * through `mergeNodeSx`, so a per-leaf override gets exactly the cascade
 * semantics the root one already had — a `{ md: … }` slice keeps the
 * base's narrower widths, an `@scheme dark` slice merges key-by-key, and
 * a plain property replaces only the leaf it names.
 *
 * A key naming a node the definition no longer has is simply never
 * consulted: this runs per definition node, so a component edited after
 * the override was written degrades to the component's own styling rather
 * than throwing on a page nobody has opened since.
 *
 * Returned as a patch object rather than a value so the caller can spread
 * nothing at all — writing `sx: undefined` onto a node that never had one
 * would materialize the key on every grafted leaf.
 */
function instanceSxPatch(
  baseSx: unknown,
  overrides: Record<string, Record<string, unknown>>,
  defId: NodeId,
  rootId: NodeId | undefined,
): { sx: unknown } | undefined {
  // The root is addressed by the constant, so a definition node whose id
  // merely happens to BE `root` without being the root gets nothing from
  // the root slice — the alternative is styling an arbitrary leaf from the
  // panel's root target.
  const rootSlice =
    defId === rootId ? overrides[STYLE_OVERRIDES_ROOT_KEY] : undefined
  const leafSlice =
    defId === STYLE_OVERRIDES_ROOT_KEY ? undefined : overrides[defId]
  if (!rootSlice && !leafSlice) return undefined
  let sx = baseSx
  if (rootSlice) sx = mergeNodeSx(sx, rootSlice)
  if (leafSlice) sx = mergeNodeSx(sx, leafSlice)
  return { sx }
}

/** One styleable target inside an instance — see {@link listInstanceStyleTargets}. */
export interface InstanceStyleTarget {
  /** The `styleOverrides` key this target reads and writes. */
  key: string
  /** The definition-internal node id it styles. */
  componentInternalId: NodeId
  /** 0 for the component root, +1 per level down — the picker indents by it. */
  depth: number
  /** The definition node's `componentId`, so a picker can label it. */
  componentId?: string
  /** The definition node's own `name`, when the component author set one. */
  name?: string
  /** True for the component root (the AGL-1306 target). */
  isRoot: boolean
}

/**
 * The styleable targets inside one component definition, in tree order
 * (root first, then depth-first through each node's `nodes`) — what the
 * Styles panel offers when a component instance is selected (AGL-1332).
 *
 * Beside the graft on purpose: the panel must write the SAME keys the
 * graft reads, and a second walker that disagreed would offer authors
 * targets no renderer consults. Cycle-safe and unreachable-safe: a node
 * the root cannot reach is not offered, because the graft would never
 * render it either.
 */
export function listInstanceStyleTargets(
  definition:
    | Pick<ReusableComponentTree<any>, 'rootId' | 'nodes'>
    | null
    | undefined,
): InstanceStyleTarget[] {
  const rootId = definition?.rootId
  const nodes = definition?.nodes
  if (!rootId || !nodes?.[rootId]) return []
  const targets: InstanceStyleTarget[] = []
  const seen = new Set<NodeId>()
  const walk = (id: NodeId, depth: number) => {
    const node = nodes[id]
    // `seen` is what bounds the walk: a definition that referenced an
    // ancestor would otherwise recurse until the stack gave out.
    if (!node || seen.has(id)) return
    seen.add(id)
    const isRoot = id === rootId
    targets.push({
      key: isRoot ? STYLE_OVERRIDES_ROOT_KEY : id,
      componentInternalId: id,
      depth,
      componentId: (node as { componentId?: string }).componentId,
      name: (node as { name?: string }).name,
      isRoot,
    })
    const children = (node as { nodes?: unknown }).nodes
    if (!Array.isArray(children)) return
    for (const childId of children as NodeId[]) {
      if (typeof childId === 'string') walk(childId, depth + 1)
    }
  }
  walk(rootId, 0)
  return targets
}

/**
 * Token namespace a definition uses to reference its own declared props:
 * `{{prop.headline}}`. Mirrors `{{entry.*}}` and `{{host.*}}` so authors
 * meet one token syntax, not a second one invented for components.
 */
export const COMPONENT_PROP_TOKEN_PREFIX = 'prop.'

/**
 * Declared prop names must be plain identifiers (AGL-1247).
 *
 * Load-bearing rather than cosmetic, which is why it lives beside the
 * storage contract instead of in whichever form happens to edit it: the
 * Attributes panel names its field for the nested path
 * `propValues.<name>`, and final-form splits that on dots — so a prop
 * called `hero.title` would address a level that does not exist and its
 * value would silently never reach the node. The editor that declares
 * props and the panel that fills them in must agree on this, so they read
 * the same constant.
 */
export const COMPONENT_PROP_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Prefix namespacing a grafted definition's node ids per instance, so the
 * same definition can appear many times in one tree without id collisions.
 */
export const COMPONENT_NODE_ID_PREFIX = 'cmp__'

/**
 * Definitions may nest instances of other definitions; expansion runs in
 * passes capped here so a self-referencing definition can't recurse forever.
 */
const MAX_COMPONENT_DEPTH = 5

type NormalizedNodes<N extends AglynNodeSchema> = Record<NodeId, N>

/** Stored shape of a host-level reusable component definition's tree. */
export interface ReusableComponentTree<
  N extends AglynNodeSchema = AglynNodeSchema,
> {
  rootId: NodeId
  nodes: NormalizedNodes<N>
  /** Props this definition declares (AGL-1247); absent = unparameterised. */
  props?: ReusableComponentProp[]
  /**
   * The definition's chosen icon (AGL-1193), carried so every editor surface
   * that draws an instance can reach it without a second read. Nothing in
   * the graft below touches it — an instance's icon is editor chrome, and
   * the published page renders the definition's own nodes.
   */
  icon?: ReusableComponentIcon
}

function instancePrefix(instanceId: NodeId) {
  return `${COMPONENT_NODE_ID_PREFIX}${instanceId}__`
}

/**
 * The declared-prop name a stored value references when it is EXACTLY one
 * `{{prop.<name>}}` token (whitespace inside the braces tolerated, matching
 * `resolveNamedTokens`' grammar), else `null`.
 *
 * Exact-match on purpose: a value that merely CONTAINS a token
 * (`"Hi {{prop.name}}!"`) is only partially prop-fed, so an inline edit of
 * the rendered text could not be decomposed back into a prop value — those
 * leaves stay component-owned (AGL-1304).
 */
export function matchComponentPropToken(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match =
    /^\s*\{\{\s*prop\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}\s*$/.exec(value)
  return match ? match[1] : null
}

/** What feeds a grafted instance leaf — see {@link resolveInstanceLeafBinding}. */
export interface InstanceLeafBinding {
  /** The definition-internal node id the grafted leaf was copied from. */
  componentInternalId: NodeId
  /**
   * The declared prop whose value feeds the leaf's `contentProp`, or `null`
   * when the leaf's content is the component's own (not prop-fed).
   */
  boundProp: string | null
}

/**
 * Maps a grafted node id back to its component-internal source and the
 * declared prop (if any) feeding one of its content props (AGL-1304).
 *
 * The graft's provenance is its id scheme — `cmp__{instanceId}__{defId}`
 * (see {@link composeReusableComponentNodes}) — and this is the ONE reader
 * of that scheme, deliberately beside the writer: the canvas double-click
 * hit-test uses it today, and AGL-1306 phase 2 (inner-node style overrides)
 * and AGL-1303 phase 3 (in-place focus mode) need the same inverse mapping.
 *
 * Returns `null` when the id was not grafted from THIS instance, or when
 * the internal id is unknown to the definition — which includes leaves of a
 * NESTED instance's graft (prefixes stack per pass), whose props are fed by
 * the outer definition's own instance node, not by this one.
 *
 * `boundProp` is non-null only when the definition node's `contentProp`
 * (default `children`; pass `src` for image leaves) is exactly one
 * `{{prop.*}}` token naming a DECLARED prop — an undeclared token never
 * substitutes, so an override written for it would silently do nothing.
 *
 * Pure: no canvas, no DOM, inputs never mutated.
 */
export function resolveInstanceLeafBinding(
  graftedId: NodeId | null | undefined,
  instanceId: NodeId | null | undefined,
  definition:
    | Pick<ReusableComponentTree, 'nodes' | 'props'>
    | null
    | undefined,
  contentProp = 'children',
): InstanceLeafBinding | null {
  if (!graftedId || !instanceId) return null
  const prefix = instancePrefix(instanceId)
  if (!graftedId.startsWith(prefix)) return null
  const componentInternalId = graftedId.slice(prefix.length)
  if (!componentInternalId) return null
  const defNode = definition?.nodes?.[componentInternalId]
  if (!defNode) return null
  const raw = (defNode.props as Record<string, unknown> | undefined)?.[
    contentProp
  ]
  const name = matchComponentPropToken(raw)
  const declared =
    name != null && (definition?.props ?? []).some((prop) => prop?.name === name)
  return { componentInternalId, boundProp: declared ? name : null }
}

/**
 * The text an instance currently renders for a declared prop: its override
 * when set, else the prop's `defaultValue`, else `''`. `''` counts as unset,
 * mirroring {@link buildPropTokens} — clearing an override restores the
 * component's own copy, so the inline editor and the graft agree about what
 * the author is looking at.
 */
export function getInstanceEffectivePropText(
  instanceProps: unknown,
  declared: ReusableComponentProp[] | undefined | null,
  propName: string,
): string {
  const values = (instanceProps as Record<string, unknown> | undefined)?.[
    REUSABLE_INSTANCE_PROP_VALUES_KEY
  ] as Record<string, unknown> | undefined
  const override = values?.[propName]
  if (override != null && override !== '') return String(override)
  const prop = (declared ?? []).find((entry) => entry?.name === propName)
  return prop?.defaultValue == null ? '' : String(prop.defaultValue)
}

/**
 * Token map for one instance: each declared prop resolved to that
 * instance's override, or to the definition's default where it set none.
 *
 * An override of `''` counts as unset, not as "render nothing" — an empty
 * Attributes field shows the placeholder, so clearing one restores the
 * component's own copy rather than silently collapsing a section on a live
 * page. `false` and `0` are real values and survive.
 */
function buildPropTokens(
  declared: ReusableComponentProp[] | undefined,
  instanceProps: unknown,
): Record<string, string> {
  if (!declared?.length) return {}
  const values = (instanceProps as Record<string, unknown> | undefined)?.[
    REUSABLE_INSTANCE_PROP_VALUES_KEY
  ] as Record<string, unknown> | undefined
  const tokens: Record<string, string> = {}
  for (const prop of declared) {
    if (!prop?.name) continue
    const override = values?.[prop.name]
    const value =
      override == null || override === '' ? prop.defaultValue : override
    tokens[`${COMPONENT_PROP_TOKEN_PREFIX}${prop.name}`] =
      value == null ? '' : String(value)
  }
  return tokens
}

/**
 * Expands reusable-component instance nodes (componentId
 * {@link REUSABLE_INSTANCE_COMPONENT_ID}, `props.refId` → definition id) by
 * grafting the referenced definition's subtree under each instance:
 *
 * - Grafted node ids are namespaced per instance (`cmp__{instanceId}__…`).
 * - The instance node keeps its identity (selection/attributes target) and
 *   gains the grafted root as its only child.
 * - Unresolvable refIds leave the instance untouched — a deleted definition
 *   must never take a published screen down.
 * - Definitions may contain instances of other definitions; expansion
 *   repeats up to {@link MAX_COMPONENT_DEPTH} passes, which also bounds
 *   accidental self-reference.
 * - A definition's declared props (AGL-1247) resolve per instance as the
 *   subtree is grafted: `{{prop.name}}` tokens take that instance's
 *   override, falling back to the prop's default. This is what lets one
 *   hero serve eleven pages instead of being copied onto each.
 * - Inputs are never mutated.
 */
export function composeReusableComponentNodes<
  N extends AglynNodeSchema = AglynNodeSchema,
>(
  nodes: NormalizedNodes<N>,
  definitionsById:
    | Record<string, ReusableComponentTree<N> | undefined>
    | undefined,
): NormalizedNodes<N> {
  if (!definitionsById) return nodes

  let composed: NormalizedNodes<N> = nodes
  for (let depth = 0; depth < MAX_COMPONENT_DEPTH; depth++) {
    const pending = Object.entries(composed).filter(([id, node]) => {
      if (node?.componentId !== REUSABLE_INSTANCE_COMPONENT_ID) return false
      const refId = (node.props as any)?.refId as string | undefined
      if (!refId || !definitionsById[refId]) return false
      // Already expanded in a previous pass?
      const childIds = Array.isArray(node.nodes) ? (node.nodes as NodeId[]) : []
      return !childIds.some(
        (childId) =>
          typeof childId === 'string' &&
          childId.startsWith(instancePrefix(id)),
      )
    })
    if (!pending.length) break

    const next: NormalizedNodes<N> = { ...composed }
    for (const [instanceId, instanceNode] of pending) {
      const refId = (instanceNode.props as any).refId as string
      const definition = definitionsById[refId] as ReusableComponentTree<N>
      const prefix = instancePrefix(instanceId)
      const prefixId = (id: NodeId) => `${prefix}${id}`
      // Style overrides (AGL-1306 root, AGL-1332 per leaf): merged over
      // each definition node's own sx as this instance's copy is grafted —
      // per-instance scope exists only here, exactly like the declared-prop
      // substitution below. Merging into the graft (rather than a renderer
      // patch) is what gives canvas/Preview/tenant parity for free, and
      // reading the definition's CURRENT nodes each pass is why an override
      // can never pin the instance to an old component version.
      //
      // Per-leaf is not a nicety: a component's text leaves usually set
      // their OWN colour, so a root-level `color` never reaches them and an
      // instance given a white background renders white-on-white (AGL-1318).
      const styleOverrides = getInstanceStyleOverrides(
        instanceNode as { componentId?: string; styleOverrides?: unknown },
      )

      const grafted: NormalizedNodes<N> = {}
      for (const [defId, defNode] of Object.entries(definition.nodes)) {
        if (!defNode) continue
        grafted[prefixId(defId)] = {
          ...defNode,
          $id: prefixId(defNode.$id ?? defId),
          parentId:
            defId === definition.rootId
              ? instanceId
              : defNode.parentId != null
                ? prefixId(defNode.parentId)
                : defNode.parentId,
          ...(Array.isArray(defNode.nodes) && {
            nodes: (defNode.nodes as NodeId[]).map((childId) =>
              typeof childId === 'string' ? prefixId(childId) : childId,
            ),
          }),
          ...((instanceSxPatch(
            defNode.sx,
            styleOverrides,
            defId,
            definition.rootId,
          ) ?? {}) as any),
        }
      }
      // Declared props (AGL-1247) substitute HERE, on this instance's copy
      // of the subtree — the only point in the pipeline where per-instance
      // scope exists, since after the merge every grafted node is just
      // another entry in one flat map.
      //
      // The value lands in a real string prop and compose runs graft →
      // repeatables → `resolveNodesBindings`, so a `{{var:id}}` typed into
      // an override still resolves downstream for free.
      Object.assign(
        next,
        resolveNamedTokens(
          grafted,
          buildPropTokens(definition.props, instanceNode.props),
        ),
      )
      next[instanceId] = {
        ...instanceNode,
        nodes: [prefixId(definition.rootId)],
      }
    }
    composed = next
  }
  return composed
}

/**
 * Ids of every descendant of `rootId` reachable through `nodes` arrays —
 * the root itself excluded, unknown and repeated ids skipped, so a cycle
 * cannot hang the walk.
 */
function collectDescendantIds<N extends AglynNodeSchema>(
  nodes: NormalizedNodes<N>,
  rootId: NodeId,
): Set<NodeId> {
  const found = new Set<NodeId>()
  const root = nodes?.[rootId]
  const queue: NodeId[] = Array.isArray(root?.nodes)
    ? [...(root.nodes as NodeId[])]
    : []
  while (queue.length) {
    const id = queue.shift() as NodeId
    if (found.has(id) || id === rootId || !nodes[id]) continue
    found.add(id)
    const children = nodes[id]?.nodes
    if (Array.isArray(children)) queue.push(...(children as NodeId[]))
  }
  return found
}

/**
 * Materializes the instance at `instanceId` into a plain, freely editable
 * copy of what it was RENDERING (AGL-1314) — what "Detach from component"
 * does, and the inverse of {@link replaceSubtreeWithInstance}.
 *
 * Deliberately here, beside the graft, because "what the instance rendered"
 * is a question only {@link composeReusableComponentNodes} can answer. The
 * console used to copy `definition.nodes` verbatim, which is the whole bug:
 * the definition's leaves hold `{{prop.headline}}` TOKENS, not text, so a
 * detached hero rendered its own markers and the author's copy was gone.
 * A second, simpler materializer will always drift from the renderer —
 * so this one runs the renderer's own steps:
 *
 * - Declared props (AGL-1247) resolve through {@link buildPropTokens} +
 *   `resolveNamedTokens`, exactly as the graft does: the instance's
 *   override, else the definition's default. Every string prop is walked,
 *   so an image's `src` bakes to the bound media for free — the token is
 *   substituted by name, not by which prop happens to hold it.
 * - The style overrides (AGL-1306 root, AGL-1332 per leaf) merge over the
 *   matching definition node's own sx, so the copy keeps the look the page
 *   was showing rather than snapping back to the component's base styling.
 *   Every node is patched, not just the root: an instance re-coloured to a
 *   white band with black copy must detach as a white band with black copy.
 * - Ids are FRESH (`createId`), never the `cmp__…` graft namespace: a
 *   detached copy is an ordinary subtree, and leaving graft ids behind
 *   would collide the next time an instance of the same definition
 *   expanded here. Only the root keeps the instance's id, so the parent's
 *   child list, the undo stack and the selection all stay valid.
 * - Anything hanging under the instance (a pre-grafted layout-chrome
 *   subtree, AGL-1218) is dropped with it; the copy replaces the whole
 *   thing.
 *
 * A missing instance, a node that is not an instance, or a definition
 * without a resolvable root returns `nodes` UNCHANGED — detach must never
 * be the thing that empties a screen. Inputs are never mutated.
 */
export function detachInstanceSubtree<
  N extends AglynNodeSchema = AglynNodeSchema,
>(
  nodes: NormalizedNodes<N>,
  instanceId: NodeId,
  definition:
    | Pick<ReusableComponentTree<N>, 'rootId' | 'nodes' | 'props'>
    | null
    | undefined,
  createId: () => NodeId,
): NormalizedNodes<N> {
  const instanceNode = nodes?.[instanceId]
  if (instanceNode?.componentId !== REUSABLE_INSTANCE_COMPONENT_ID) {
    return nodes
  }
  const rootId = definition?.rootId
  if (!rootId || !definition?.nodes?.[rootId]) return nodes

  // Fresh ids for everything but the root, which inherits the instance's.
  // `createId` is injected so this stays pure (and specs stay readable);
  // the loop re-rolls rather than trusting uniqueness, because a collision
  // here would silently overwrite an unrelated node on the page.
  const taken = new Set<NodeId>(Object.keys(nodes))
  const idMap: Record<NodeId, NodeId> = { [rootId]: instanceId }
  for (const defId of Object.keys(definition.nodes)) {
    if (idMap[defId] != null) continue
    let fresh = createId()
    for (
      let attempt = 0;
      (!fresh || taken.has(fresh)) && attempt < 10;
      attempt++
    ) {
      fresh = createId()
    }
    taken.add(fresh)
    idMap[defId] = fresh
  }

  const styleOverrides = getInstanceStyleOverrides(
    instanceNode as { componentId?: string; styleOverrides?: unknown },
  )
  const copied: NormalizedNodes<N> = {}
  for (const [defId, defNode] of Object.entries(definition.nodes)) {
    if (!defNode) continue
    const newId = idMap[defId]
    copied[newId] = {
      ...defNode,
      $id: newId,
      parentId:
        defId === rootId
          ? (instanceNode.parentId ?? null)
          : defNode.parentId != null
            ? (idMap[defNode.parentId] ?? null)
            : (defNode.parentId ?? null),
      ...(Array.isArray(defNode.nodes) && {
        nodes: (defNode.nodes as NodeId[]).map((childId) =>
          typeof childId === 'string' ? (idMap[childId] ?? childId) : childId,
        ),
      }),
      // The SAME patch the graft applies, node for node (AGL-1332) — the
      // detached copy has to look identical to what the page was showing,
      // and a per-leaf override baked only at the root would repaint every
      // headline the moment an author detached.
      ...((instanceSxPatch(defNode.sx, styleOverrides, defId, rootId) ??
        {}) as any),
    }
  }

  const doomed = collectDescendantIds(nodes, instanceId)
  const next: NormalizedNodes<N> = {}
  for (const [id, node] of Object.entries(nodes)) {
    if (id === instanceId || doomed.has(id)) continue
    next[id] = node as N
  }
  return Object.assign(
    next,
    resolveNamedTokens(
      copied,
      buildPropTokens(definition.props, instanceNode.props),
    ),
  )
}

/**
 * Replaces the subtree rooted at `rootId` with an instance of `definitionId`
 * (AGL-1193) — what "Save as reusable component" does to the tree it was
 * promoted from.
 *
 * Without this the promoting document keeps an inline *copy*: the one place
 * guaranteed never to track the component it created, silently. Deliberately
 * in this file so the swap and {@link composeReusableComponentNodes} cannot
 * drift about what an instance node looks like.
 *
 * - The instance keeps the promoted root's `$id` and `parentId`, so the
 *   parent's child list, the undo stack and the current selection all stay
 *   valid — the mirror of the detach path, which reuses the instance id.
 * - Every descendant is dropped; its content now lives in the definition.
 * - `displayName` rides along as a prop purely so the editor placeholder can
 *   name what it stands for (definitions are not grafted into the canvas).
 * - Unknown `rootId` is a no-op, and the input is never mutated.
 */
export function replaceSubtreeWithInstance<
  N extends AglynNodeSchema = AglynNodeSchema,
>(
  nodes: NormalizedNodes<N>,
  rootId: NodeId,
  definitionId: string,
  displayName?: string,
): NormalizedNodes<N> {
  const root = nodes?.[rootId]
  if (!root || !definitionId) return nodes

  // Descendants only — the root is replaced, not removed.
  const doomed = collectDescendantIds(nodes, rootId)

  const next: NormalizedNodes<N> = {}
  for (const [id, node] of Object.entries(nodes)) {
    if (!doomed.has(id)) next[id] = node as N
  }
  next[rootId] = {
    $id: rootId,
    parentId: root.parentId ?? null,
    componentId: REUSABLE_INSTANCE_COMPONENT_ID,
    pluginId: 'mui',
    props: {
      refId: definitionId,
      ...(displayName && { name: displayName }),
    },
    nodes: [],
  } as unknown as N
  return next
}

/**
 * The icon path an instance node should be drawn with (AGL-1193), or
 * `undefined` when the node is not an instance, its definition is unknown,
 * or that definition chose no icon — every one of which means "fall back to
 * the component schema's own glyph".
 *
 * The visual half of `getNodeLabelShort`: an instance stands for one
 * specific component, so a hierarchy of promoted sections drawn with one
 * repeated package glyph tells the author nothing. Unlike the label, the
 * icon is NOT denormalized onto the instance — it is read live off the
 * definition, so changing a component's icon updates every instance already
 * placed instead of only the ones inserted afterwards.
 *
 * Deliberately here rather than in the canvas manager: this file owns what
 * an instance node looks like, and a second reader that disagreed would draw
 * definition icons on nodes the graft does not treat as instances.
 *
 * Returns only the stored `iconPath`. Resolving `iconId` would need the
 * ~2.9 MB icon catalog, which render surfaces never load — and the lookup
 * that "helpfully" substitutes a default is what made every icon a "help"
 * glyph in AGL-1212.
 */
export function resolveInstanceIconPath(
  node:
    | { componentId?: string; props?: unknown }
    | undefined
    | null,
  definitionsById:
    | Record<string, { icon?: ReusableComponentIcon } | undefined>
    | undefined
    | null,
): string | undefined {
  if (!node || !definitionsById) return undefined
  if (node.componentId !== REUSABLE_INSTANCE_COMPONENT_ID) return undefined
  const refId = (node.props as { refId?: unknown } | undefined)?.refId
  if (typeof refId !== 'string' || !refId) return undefined
  return definitionsById[refId]?.icon?.iconPath || undefined
}

/**
 * Whether a node map contains an instance of `definitionId` (AGL-703).
 *
 * The inverse of the graft above, and deliberately in the same file: a
 * "Used by" card that disagreed with {@link composeReusableComponentNodes}
 * about what counts as a reference would report "used nowhere" for
 * something the renderer does expand, which is an invitation to delete it.
 *
 * Scans ONLY direct instances. Callers wanting transitive usage must scan
 * definitions too — a definition may nest instances of other definitions,
 * so "used by no screen" does not mean "used by nothing".
 */
export function nodesReferenceComponent(
  nodes: Record<string, AglynNodeSchema | undefined> | undefined | null,
  definitionId: string,
): boolean {
  if (!nodes || !definitionId) return false
  return Object.values(nodes).some(
    (node) =>
      node?.componentId === REUSABLE_INSTANCE_COMPONENT_ID &&
      (node.props as { refId?: unknown } | undefined)?.refId === definitionId,
  )
}

export default composeReusableComponentNodes
