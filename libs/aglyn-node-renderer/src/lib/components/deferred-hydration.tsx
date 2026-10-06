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

// Type-only, for the reason in `stem.tsx`.
import type * as Aglyn from '@aglyn/aglyn'
import { components } from '@aglyn/aglyn/aglyn'
import { FEATURE_FLAG } from '@aglyn/aglyn/foundation/constants/shared'
import { isNamespacedComponentId } from '@aglyn/aglyn/plugin-manager/plugin-contributions'
import { useCallback, useState, useSyncExternalStore } from 'react'

/**
 * Static subtrees of a published page skip hydration until the visitor
 * nears them (AGL-3581).
 *
 * ## What it does
 *
 * A published page arrives as complete server HTML, and before this every
 * node of it hydrated at once: on `aglyn.com/` that was ~600 elements and the
 * largest single long task of the load. Most of them are copy, images and
 * layout — nothing a visitor operates — so hydrating them buys nothing until
 * the visitor reaches them.
 *
 * While the page hydrates, a static subtree that is not near the viewport
 * renders its root element with `dangerouslySetInnerHTML` in place of its
 * children. React hydrates that root and treats its contents as markup it
 * does not own, so the server's HTML stays exactly as it is — painted,
 * selectable, links working natively — and none of it costs hydration. When
 * the subtree comes within {@link NEAR_VIEWPORT_PX} of the viewport the
 * children render, and React builds them on the client in place of the held
 * markup: the same HTML, now live.
 *
 * ## Why not a Suspense boundary
 *
 * A boundary that suspends during hydration would keep the server HTML and
 * hydrate it in place, which is the textbook mechanism. React 19.2's server
 * renderer outlines every boundary over 500 bytes once the shell passes its
 * progressive chunk size (12.8 KB, not configurable through Next): each one
 * ships in a hidden `<div>` revealed by an inline script on a later animation
 * frame. That is content missing from first paint, a layout shift when it
 * appears, nothing at all in a background tab, and markup a non-rendering
 * crawler reads as hidden. A held root changes nothing in the server HTML.
 *
 * ## Which subtrees
 *
 * Every component in the subtree declares `flags.lazyHydration` — nothing in
 * it responds to the visitor before hydration beyond what HTML does on its
 * own — so the safe answer is the default: an element without the flag keeps
 * its whole ancestry hydrating now. The subtree's ROOT also declares
 * `flags.childrenInRoot`, the contract that lets it take
 * `dangerouslySetInnerHTML` instead of its children.
 *
 * A subtree near the viewport at hydration is not held, and its children
 * hydrate normally — each of them then decides for itself. So a page-wide
 * static wrapper does not hold the whole page: it hydrates, and the sections
 * inside it that are further down are what wait.
 *
 * ## Only during hydration
 *
 * The decision is taken once, when the leaf first renders, and only if that
 * render is part of the tree's first commit (see `treeHydrated`). A subtree
 * mounted by a client-side navigation renders at once and can never be left
 * empty.
 *
 * ## Interaction before release
 *
 * Nothing is released on a press: that would replace the element under the
 * visitor's finger between `pointerdown` and `click`, and the click would be
 * lost. The held HTML already does what a static element does — a link
 * navigates, text selects, focus moves.
 *
 * ## Fails open
 *
 * If the leaf's element is not in the document, or the browser has no
 * `IntersectionObserver`, nothing is held: the worst case is the old
 * behavior.
 */

/** How far outside the viewport a held subtree renders, in pixels. */
export const NEAR_VIEWPORT_PX = 600

const LEAF_ATTRIBUTE = 'data-aglyn'
const LEAF_PREFIX = 'leaf:'

/** The empty markup a held root is given, and React leaves alone. */
export const HELD_SERVER_HTML = Object.freeze({ __html: '' })

interface Hold {
  released: boolean
  readonly listeners: Set<() => void>
}

const holds = new Map<string, Hold>()
let observer: IntersectionObserver | null = null

function release(nodeId: string): void {
  const hold = holds.get(nodeId)
  if (!hold || hold.released) return
  hold.released = true
  for (const listener of [...hold.listeners]) listener()
}

function nearViewportObserver(): IntersectionObserver | null {
  if (observer) return observer
  if (typeof IntersectionObserver !== 'function') return null
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        observer?.unobserve(entry.target)
        const value = entry.target.getAttribute(LEAF_ATTRIBUTE) ?? ''
        release(value.slice(LEAF_PREFIX.length))
      }
    },
    { rootMargin: `${NEAR_VIEWPORT_PX}px 0px` },
  )
  return observer
}

function findLeafElement(nodeId: string): Element | null {
  try {
    // A quoted attribute value needs only its quote and backslash escaped.
    const value = `${LEAF_PREFIX}${nodeId}`.replace(/["\\]/g, '\\$&')
    return document.querySelector(`[${LEAF_ATTRIBUTE}="${value}"]`)
  } catch {
    return null
  }
}

function nearViewport(element: Element): boolean {
  const { top, bottom } = element.getBoundingClientRect()
  return (
    bottom >= -NEAR_VIEWPORT_PX && top <= window.innerHeight + NEAR_VIEWPORT_PX
  )
}

/**
 * Hold this node's server HTML? Idempotent per node, because React may run a
 * render's state initializer more than once before it commits.
 */
function holdIfFar(nodeId: string): boolean {
  const existing = holds.get(nodeId)
  if (existing) return !existing.released
  const element = findLeafElement(nodeId)
  const io = element ? nearViewportObserver() : null
  if (!element || !io || nearViewport(element)) return false
  holds.set(nodeId, { released: false, listeners: new Set() })
  io.observe(element)
  return true
}

/**
 * Has the published tree committed its first render? Until it has, every
 * leaf rendering on the client is hydrating. Set from `TreeRoot`'s effect,
 * which runs after the whole first commit — so it is false for every leaf of
 * the hydration and true for anything a later navigation mounts.
 *
 * A module flag rather than `useSyncExternalStore`'s server snapshot: a store
 * whose client and server snapshots differ makes React re-render every
 * component reading it right after hydration, which here would be every leaf
 * on the page — the work this module exists to avoid.
 */
let treeHydrated = false

/** Called by `TreeRoot` once its first commit has landed. */
export function markTreeHydrated(): void {
  treeHydrated = true
}

/**
 * Should this leaf render its root with {@link HELD_SERVER_HTML} instead of
 * its children? True only from a hydration render of an `eligible` leaf that
 * is far from the viewport, until it comes near.
 */
export function useHeldServerHtml(eligible: boolean, nodeId: string): boolean {
  const [held] = useState(
    () =>
      eligible &&
      !treeHydrated &&
      typeof document !== 'undefined' &&
      holdIfFar(nodeId),
  )
  const subscribe = useCallback(
    (listener: () => void) => {
      const hold = holds.get(nodeId)
      if (!hold) return () => undefined
      hold.listeners.add(listener)
      return () => {
        hold.listeners.delete(listener)
      }
    },
    [nodeId],
  )
  // Both snapshots read `false` for a leaf that holds nothing, so no leaf is
  // re-rendered for having read this store.
  const released = useSyncExternalStore(
    subscribe,
    () => holds.get(nodeId)?.released ?? false,
    () => false,
  )
  return held && !released
}

const staticSubtrees = new WeakMap<object, boolean>()

function declares(
  componentId: string | undefined,
  flag: 'lazyHydration' | 'childrenInRoot',
): boolean {
  if (!componentId || isNamespacedComponentId(componentId)) return false
  const value = components.getSchema(componentId)?.flags?.[flag] ?? 0
  return Boolean(value & FEATURE_FLAG.ENABLED)
}

/**
 * Is every node in this subtree a component that declared `lazyHydration`?
 * Cached per node OBJECT: a published page's tree does not change under it,
 * and the editor, whose tree does, never turns deferral on.
 */
export function isLazyHydrationSubtree(node: Aglyn.NodeSchema<any>): boolean {
  const cached = staticSubtrees.get(node)
  if (cached !== undefined) return cached
  let answer = declares(node.componentId, 'lazyHydration')
  if (answer) {
    for (const child of (node.children ?? []) as Aglyn.NodeSchema<any>[]) {
      if (!child || !isLazyHydrationSubtree(child)) {
        answer = false
        break
      }
    }
  }
  staticSubtrees.set(node, answer)
  return answer
}

/** May this node hold its server HTML: a static subtree under a plain root? */
export function mayHoldServerHtml(
  node: Aglyn.NodeSchema<any> | undefined,
): boolean {
  return Boolean(
    node?.children?.length &&
      declares(node.componentId, 'childrenInRoot') &&
      isLazyHydrationSubtree(node),
  )
}

/** Test seam: forget every hold, and that the tree ever hydrated. */
export function resetDeferredHydrationForTests(): void {
  treeHydrated = false
  holds.clear()
  observer?.disconnect()
  observer = null
}
