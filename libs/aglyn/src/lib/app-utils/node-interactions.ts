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

import type { HostAction } from './actions'

/**
 * Interactions stored on the element that carries them.
 *
 * An interaction is what an ELEMENT does — clicked, hovered, scrolled into
 * view. A host action is what the SITE does — an order was placed, a form was
 * submitted. Both compile to the same runtime shape, and until now both were
 * stored the same way too, as rows in `hosts/{hostId}/actions` bound to an
 * element by selector. That made an interaction a site-wide object that
 * merely happened to point at one element, with all four consequences an
 * author would be surprised by: it did not publish or roll back with its
 * screen, it did not travel with a copied component or a packaged template,
 * deleting the element orphaned it, and it cluttered the site's automation
 * list with a nav menu's hover timing.
 *
 * Here the node owns them, so all four answer themselves — the node is the
 * thing that versions, travels, and is deleted.
 *
 * ## The selector is not stored
 *
 * `trigger.selector` is derived from the node's id at compose time, never
 * persisted. A stored selector is a second name for the element that can
 * disagree with the first: a duplicate, a re-key, or a paste into another
 * document would carry a selector still naming the ORIGINAL element, and the
 * interaction would silently drive someone else's button. Deriving it means
 * the copy binds to the copy, which is the whole reason for moving the
 * storage.
 */
export interface NodeInteraction extends Omit<HostAction, 'trigger'> {
  /** Stable within its node, so an edit updates rather than appends. */
  id: string
  trigger: Omit<HostAction['trigger'], 'selector'>
}

/** Cap per element. Ten triggers on one button is a bug, not a design. */
export const NODE_MAX_INTERACTIONS = 10

/** The selector the renderer stamps for a node, and the runtime targets. */
export function nodeInteractionSelector(nodeId: string): string {
  return `[data-aglyn="leaf:${nodeId}"]`
}

/** The node a derived selector names, or undefined for anything else. */
export function nodeIdFromInteractionSelector(
  selector: unknown,
): string | undefined {
  const match = /^\[data-aglyn="leaf:(.+)"\]$/.exec(String(selector ?? ''))
  return match?.[1] || undefined
}

/**
 * The prefix that makes a collected id say where it lives.
 *
 * Every surface that can toggle, edit or delete an interaction is handed an
 * id and nothing else, and there are now two places one can be stored. A
 * self-describing id is what lets those surfaces route without a second
 * lookup — and, more to the point, without GUESSING, which during the
 * migration would mean writing a node interaction into the actions
 * collection or vice versa.
 */
export const NODE_INTERACTION_ID_PREFIX = 'node:'

/** The node and interaction a collected id names, or null for a host action. */
export function parseNodeInteractionId(
  id: unknown,
): { nodeId: string; interactionId: string } | null {
  const value = String(id ?? '')
  if (!value.startsWith(NODE_INTERACTION_ID_PREFIX)) return null
  const rest = value.slice(NODE_INTERACTION_ID_PREFIX.length)
  // The node id comes first and cannot contain a colon; the interaction id
  // takes the remainder, so a colon inside one survives the round trip.
  const separator = rest.indexOf(':')
  if (separator <= 0 || separator === rest.length - 1) return null
  return {
    nodeId: rest.slice(0, separator),
    interactionId: rest.slice(separator + 1),
  }
}

/** The collected id for one interaction on one node. */
export function nodeInteractionId(
  nodeId: string,
  interactionId: string,
): string {
  return `${NODE_INTERACTION_ID_PREFIX}${nodeId}:${interactionId}`
}

/** Minimal node shape this module reads; the canvas node satisfies it. */
export interface InteractionNode {
  $id?: string
  interactions?: NodeInteraction[] | null
  /** Denormalized children. Ids are the normalized form and carry nothing. */
  nodes?: unknown
}

/**
 * Every node in a DENORMALIZED tree, depth-first, parents before children.
 *
 * Composition is what makes this the right input: a layout's chrome and a
 * reusable component's internals are grafted in by then, and their node ids
 * are the graft ids the renderer actually stamps. Collecting from the raw
 * screen document instead would derive a selector for an id that is never on
 * the page — which is the same bug as a stored selector, arrived at from the
 * other direction.
 *
 * A normalized tree (children as id strings) yields only the node it was
 * given; there is nothing to follow, and guessing at a lookup table this
 * module does not have would be worse than answering honestly.
 */
/** A single node rather than a map of them: it names itself. */
function isInteractionNodeLike(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { $id?: unknown }).$id === 'string'
  )
}

export function* walkInteractionNodes(
  root: InteractionNode | null | undefined,
): Generator<InteractionNode> {
  /*
   * A NORMALIZED map is the shape the tenant actually composes.
   *
   * `composeScreenNodes` returns `{ [id]: node }` with children as id
   * STRINGS, and the enricher handed that straight here. The old code took
   * the map itself for a node: it carries no `$id` and no `interactions`, its
   * `nodes` property does not exist, so the walk yielded one useless object
   * and stopped. Every node interaction on every published page was dropped —
   * silently, because an empty automation list is what a page with none looks
   * like.
   *
   * A map is recognisable without guessing: no `$id`, no `nodes` array, and
   * every value an object carrying its own `$id`. Yielding its values is
   * exact rather than a lookup this module would have to invent — the map is
   * already flat, so there is nothing to follow.
   */
  if (root && typeof root === 'object' && !isInteractionNodeLike(root)) {
    const values = Object.values(root as Record<string, unknown>)
    if (values.length && values.every((v) => isInteractionNodeLike(v))) {
      for (const node of values) yield node as InteractionNode
      return
    }
  }
  if (!root || typeof root !== 'object') return
  yield root
  const children = (root as { nodes?: unknown }).nodes
  if (!Array.isArray(children)) return
  for (const child of children) {
    if (child && typeof child === 'object') {
      yield* walkInteractionNodes(child as InteractionNode)
    }
  }
}

/** One interaction resolved into the runtime's own shape. */
export interface CollectedNodeInteraction {
  /**
   * Namespaced with the node id, so two elements carrying the same preset —
   * two Dropdown Panels inserted from the same source — cannot collide, and
   * so a runtime keyed on this id (the once-per-visitor and cooldown caps
   * are) treats them as the separate things they are.
   */
  id: string
  action: HostAction
}

/**
 * Every interaction in a composed tree, in the runtime's shape.
 *
 * Order follows the nodes, which is document order — a page with two
 * elements listening for the same event fires them in the order they appear,
 * which is the only ordering an author can predict.
 *
 * Disabled interactions are kept, not dropped. The compiler downstream is the
 * one place that decides what runs (it also applies the plan trims), and two
 * places deciding is how a step gets dropped for a reason nobody can find.
 */
/**
 * Step selectors, re-pointed at the ids the graft actually stamped.
 *
 * A trigger needs no help: the node IS the selector, derived above from the
 * composed id. A STEP is different — it names another element, and it was
 * written when the component was authored, so it holds that component's own
 * id. Grafting an instance re-stamps every id with the instance's prefix, so
 * `[data-aglyn="leaf:panel"]` names nothing on a page that renders
 * `leaf:cmp__inst__panel`, and a mega menu opens nothing.
 *
 * Rewritten only when the bare id is absent AND exactly the prefixed sibling
 * is present: an interaction that legitimately targets a page-level element
 * from inside a component keeps working, and an unresolvable selector is left
 * exactly as written rather than pointed somewhere plausible.
 */
function regraftStepSelectors(
  steps: HostAction['steps'],
  nodeId: string,
  present: ReadonlySet<string>,
): HostAction['steps'] {
  const boundary = nodeId.lastIndexOf('__')
  if (boundary < 0) return steps
  const prefix = nodeId.slice(0, boundary + 2)
  if (!prefix) return steps
  return (steps ?? []).map((step) => {
    const targetId = nodeIdFromInteractionSelector(
      (step as { selector?: unknown })?.selector,
    )
    if (!targetId || present.has(targetId)) return step
    const grafted = `${prefix}${targetId}`
    if (!present.has(grafted)) return step
    return { ...step, selector: nodeInteractionSelector(grafted) }
  }) as HostAction['steps']
}

export function collectNodeInteractions(
  nodes: Iterable<InteractionNode | null | undefined>,
): CollectedNodeInteraction[] {
  const collected: CollectedNodeInteraction[] = []
  const all = [...nodes]
  const present = new Set(
    all.map((node) => node?.$id).filter((id): id is string => !!id),
  )
  for (const node of all) {
    const nodeId = node?.$id
    if (!nodeId || !Array.isArray(node?.interactions)) continue
    let index = 0
    for (const interaction of node.interactions) {
      if (index >= NODE_MAX_INTERACTIONS) break
      if (!interaction?.trigger?.event) continue
      index += 1
      collected.push({
        id: nodeInteractionId(nodeId, interaction.id || String(index)),
        action: {
          ...interaction,
          ...(Array.isArray((interaction as { steps?: unknown }).steps)
            ? {
                steps: regraftStepSelectors(
                  (interaction as unknown as HostAction).steps,
                  nodeId,
                  present,
                ),
              }
            : {}),
          trigger: {
            ...interaction.trigger,
            // Derived here and nowhere else — see the note above on why it
            // is not stored.
            selector: nodeInteractionSelector(nodeId),
          },
        } as HostAction,
      })
    }
  }
  return collected
}

/**
 * The interactions on one node with one entry added or replaced.
 *
 * Returns a new array; never mutates the one passed in, which is a MobX
 * observable on the canvas and a plain array everywhere else.
 */
export function upsertNodeInteraction(
  interactions: readonly NodeInteraction[] | undefined,
  interaction: NodeInteraction,
): NodeInteraction[] {
  const current = interactions ?? []
  const existing = current.findIndex((entry) => entry.id === interaction.id)
  if (existing < 0) return [...current, interaction].slice(0, NODE_MAX_INTERACTIONS)
  const next = [...current]
  next[existing] = interaction
  return next
}

/** The interactions on one node with one removed. */
export function removeNodeInteraction(
  interactions: readonly NodeInteraction[] | undefined,
  id: string,
): NodeInteraction[] {
  return (interactions ?? []).filter((entry) => entry.id !== id)
}
