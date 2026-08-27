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

import * as Aglyn from '@aglyn/aglyn'

/**
 * Switching a CLASS off while designing (AGL-2486).
 *
 * ## What the chip's eye means, and what it does not
 *
 * The Classes field's chips could only be removed. Seeing an element without
 * one of its classes meant deleting the chip and typing the name back, which
 * is the same destructive round trip the style fields had. The eye stops the
 * class applying ON THE CANVAS and keeps it on the element.
 *
 * It is CANVAS ONLY, exactly like the style mutes it sits beside: the class
 * list in the document is untouched, so what the chips show is what ships,
 * and a switched-off class cannot reach a published page as an enabled one
 * because it was never disabled anywhere a publish can see. The chip's ✕
 * remains the one control that changes what the element carries.
 *
 * ## The one class that is not switched here
 *
 * {@link Aglyn.ELEMENT_HIDDEN_CLASS} is what the hierarchy's visibility eye
 * already keys on (AGL-592), and "stop applying the hidden class on the
 * canvas" and "show this element while I design it" are the same act. Two
 * controls carrying one meaning can disagree, so they do not: this module
 * refuses that class ({@link isClassSwitchable}) and the chip is wired to the
 * visibility state instead. One switch, reachable from the hierarchy row and
 * from the chip.
 */

/** One muted class on one element. */
export interface MutedClassTarget {
  nodeId: string
  className: string
}

/**
 * Whether a class carries its own canvas switch. The hidden class does not —
 * the element's own visibility toggle owns that decision.
 */
export function isClassSwitchable(className: string): boolean {
  return className !== Aglyn.ELEMENT_HIDDEN_CLASS
}

/** The flag entry for a target. */
export function mutedClassKey(target: MutedClassTarget): string {
  return `${target.nodeId}|${target.className}`
}

/** The target a flag entry stands for, or null when it is not one of ours. */
export function parseMutedClassKey(key: string): MutedClassTarget | null {
  const separator = key.indexOf('|')
  if (separator <= 0 || separator === key.length - 1) return null
  return {
    nodeId: key.slice(0, separator),
    className: key.slice(separator + 1),
  }
}

/** Whether this class is switched off on this element. */
export function isClassMuted(
  mutedClasses: readonly string[] | undefined,
  target: MutedClassTarget,
): boolean {
  const key = mutedClassKey(target)
  return !!mutedClasses?.some((entry) => entry === key)
}

/**
 * The mute list with one class flipped. Returns a new array so the flag's
 * subscribers see a changed value, and never mutates the input.
 */
export function toggleMutedClass(
  mutedClasses: readonly string[] | undefined,
  target: MutedClassTarget,
): string[] {
  const key = mutedClassKey(target)
  const current = mutedClasses ?? []
  return current.some((entry) => entry === key)
    ? current.filter((entry) => entry !== key)
    : [...current, key]
}

/** The classes switched off on one element. */
export function mutedClassesForNode(
  mutedClasses: readonly string[] | undefined,
  nodeId: string | undefined,
): string[] {
  if (!nodeId || !mutedClasses?.length) return []
  const names: string[] = []
  for (const entry of mutedClasses) {
    const target = parseMutedClassKey(entry)
    if (target && target.nodeId === nodeId) names.push(target.className)
  }
  return names
}

/** A class list with the switched-off names taken out. */
function withoutClasses(
  value: unknown,
  removed: readonly string[],
): string | undefined {
  if (typeof value !== 'string') return value as undefined
  const kept = value
    .split(/\s+/)
    .filter((name) => name && !removed.includes(name))
  return kept.length ? kept.join(' ') : undefined
}

/**
 * CANVAS ONLY: the node as the canvas should render it, with its
 * switched-off classes taken out of the class list.
 *
 * Applied to the RENDER copy the canvas leaf already builds for resolved
 * bindings, never to the canvas node itself — selection, the hierarchy and
 * every save keep reading the element's real class list. Returns the node BY
 * IDENTITY when it carries no muted class, which is every element until
 * somebody opens the comparison.
 */
export function stripMutedClasses<T extends Record<string, any>>(
  node: T | undefined,
  nodeId: string | undefined,
  mutedClasses: readonly string[] | undefined,
): T | undefined {
  if (!node) return node
  const removed = mutedClassesForNode(mutedClasses, nodeId)
  if (!removed.length) return node
  const props = node['props'] as Record<string, unknown> | undefined
  const propsClassName = props?.['className']
  const nextPropsClassName = withoutClasses(propsClassName, removed)
  const nextClassName = withoutClasses(node['className'], removed)
  const propsChanged =
    typeof propsClassName === 'string' && nextPropsClassName !== propsClassName
  const nodeChanged =
    typeof node['className'] === 'string' && nextClassName !== node['className']
  if (!propsChanged && !nodeChanged) return node
  const next: Record<string, any> = { ...node }
  if (propsChanged) {
    const nextProps = { ...(props ?? {}) }
    if (nextPropsClassName === undefined) delete nextProps['className']
    else nextProps['className'] = nextPropsClassName
    next['props'] = nextProps
    // `Leaf` prefers `resolvedProps` when a component declares a resolver, so
    // the copy has to agree with itself or the class comes back through the
    // other reading.
    if (node['resolvedProps']) {
      const resolved = { ...(node['resolvedProps'] as Record<string, unknown>) }
      const nextResolved = withoutClasses(resolved['className'], removed)
      if (nextResolved === undefined) delete resolved['className']
      else resolved['className'] = nextResolved
      next['resolvedProps'] = resolved
    }
  }
  if (nodeChanged) {
    if (nextClassName === undefined) delete next['className']
    else next['className'] = nextClassName
  }
  return next as T
}
