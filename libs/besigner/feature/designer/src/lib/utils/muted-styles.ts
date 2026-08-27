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

import { expandSxAliases } from '@aglyn/shared-data-enums'
import type { FieldMuteAction } from '@aglyn/shared-ui-jsx-forms'

import { readSxValue, type SxBreakpoint, writeSxValue } from './responsive-sx'
import { SX_STATE_SELECTORS, type SxState } from './state-sx'

/**
 * Muting one style declaration while designing (AGL-2486).
 *
 * ## What this is
 *
 * Every field in the Styles panel could set a value and take one off, and
 * nothing in between. Seeing a layout without its `maxWidth` meant deleting
 * the value and typing it back afterwards — which loses the very thing being
 * compared against. This is the browser-devtools checkbox: the declaration
 * stops applying, its value stays where it is, and one click puts it back.
 *
 * ## Canvas only, and the value is never moved
 *
 * A mute is held in the `mutedStyles` canvas flag, alongside `heldState`. The
 * document is not touched at all — the declaration stays in `node.sx` exactly
 * where the author left it, and the canvas renders a COPY with it removed,
 * through the same `LeafSxTransformContext` seam the artboard device pin and
 * the interaction-state hold already use.
 *
 * That is what makes the two requirements of a comparison tool hold at once.
 * The value is not parked somewhere and restored later, so turning a mute back
 * off cannot fail or lose anything; and nothing disabled can reach a published
 * page, because there is nothing in the document to reach it — no reserved sx
 * key for a renderer to recognise, no substitution pass on the tenant's render
 * path, and nothing for a publish to serialize. The cost is that a mute is a
 * session's worth of comparison rather than a saved state: reload, and every
 * declaration is applying again.
 *
 * ## Scope
 *
 * A mute belongs to the scope the panel was in when it was made — the
 * interaction state and the breakpoint the chips name. Muting `color` in the
 * hover slice leaves the default one applying, and a mute made while styling
 * SM is not in force at "all screen sizes".
 */

/** One muted declaration, in the scope it was muted in. */
export interface MutedStyleTarget {
  nodeId: string
  /** sx property key, in the panel's spelling (`backgroundColor`, not `bgcolor`). */
  property: string
  /** Interaction-state slice, or null for the element's default styles. */
  state?: SxState | null
  /** Breakpoint scope, or null for "all screen sizes". */
  breakpoint?: SxBreakpoint | null
}

const SCOPE_BASE = 'base'

/**
 * The flag entry for a target. Encoded rather than stored as an object
 * because the flag is a plain value compared by identity: a string list is
 * cheap to test membership in and cheap to rewrite immutably.
 */
export function mutedStyleKey(target: MutedStyleTarget): string {
  return [
    target.nodeId,
    target.state ?? SCOPE_BASE,
    target.breakpoint ?? SCOPE_BASE,
    target.property,
  ].join('|')
}

/** The target a flag entry stands for, or null when it is not one of ours. */
export function parseMutedStyleKey(key: string): MutedStyleTarget | null {
  const parts = key.split('|')
  if (parts.length !== 4) return null
  const [nodeId, state, breakpoint, property] = parts
  if (!nodeId || !property) return null
  return {
    nodeId,
    property,
    state: state === SCOPE_BASE ? null : (state as SxState),
    breakpoint: breakpoint === SCOPE_BASE ? null : (breakpoint as SxBreakpoint),
  }
}

/** Whether this declaration is muted in this scope. */
export function isStyleMuted(
  mutedStyles: readonly string[] | undefined,
  target: MutedStyleTarget,
): boolean {
  const key = mutedStyleKey(target)
  return !!mutedStyles?.some((entry) => entry === key)
}

/**
 * The mute list with one declaration flipped. Returns a new array so the
 * flag's subscribers see a changed value, and never mutates the input.
 */
export function toggleMutedStyle(
  mutedStyles: readonly string[] | undefined,
  target: MutedStyleTarget,
): string[] {
  const key = mutedStyleKey(target)
  const current = mutedStyles ?? []
  return current.some((entry) => entry === key)
    ? current.filter((entry) => entry !== key)
    : [...current, key]
}

/** Every mute recorded against one element. */
export function mutedStylesForNode(
  mutedStyles: readonly string[] | undefined,
  nodeId: string | undefined,
): MutedStyleTarget[] {
  if (!nodeId || !mutedStyles?.length) return []
  const targets: MutedStyleTarget[] = []
  for (const entry of mutedStyles) {
    const target = parseMutedStyleKey(entry)
    if (target && target.nodeId === nodeId) targets.push(target)
  }
  return targets
}

const isPlainObject = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The record with one declaration removed.
 *
 * Aliases are expanded for the muted key first, for the reason
 * `applyStylePartialToSx` expands them: a preset writes `bgcolor` and the
 * panel calls the field `backgroundColor`, so muting the field has to reach
 * the declaration that is actually painting.
 *
 * Which breakpoint slice goes follows what the author is looking at. A
 * property carrying an own slice at the active breakpoint loses THAT slice,
 * so the mobile-first cascade fills in from below — the devtools behaviour of
 * unchecking a declaration inside one media block. A property with no own
 * slice there is applying at that width through the cascade, and the whole
 * declaration goes; the alternative is a control that reads as available and
 * does nothing when clicked.
 */
function muteDeclaration(
  record: Record<string, any>,
  property: string,
  breakpoint: SxBreakpoint | null | undefined,
): Record<string, any> {
  const expanded = expandSxAliases(record, { only: [property], deep: true })
  if (readSxValue(expanded, property, breakpoint ?? null) === undefined) {
    return record
  }
  const value = expanded[property]
  const ownSlice =
    isPlainObject(value) &&
    Object.prototype.hasOwnProperty.call(value, breakpoint ?? 'xs')
  if (ownSlice) {
    return writeSxValue(expanded, property, undefined, breakpoint ?? null)
  }
  const next = { ...expanded }
  delete next[property]
  return next
}

/** One target applied to one plain sx record. */
function muteOne(
  sx: Record<string, any>,
  target: MutedStyleTarget,
): Record<string, any> {
  if (!target.state) {
    return muteDeclaration(sx, target.property, target.breakpoint)
  }
  const selector = SX_STATE_SELECTORS[target.state]
  const slice = sx[selector]
  if (!isPlainObject(slice)) return sx
  const nextSlice = muteDeclaration(slice, target.property, target.breakpoint)
  if (nextSlice === slice) return sx
  const next = { ...sx }
  if (Object.keys(nextSlice).length) next[selector] = nextSlice
  else delete next[selector]
  return next
}

/**
 * CANVAS ONLY: the element's sx with its muted declarations removed.
 *
 * Runs on the fully merged sx at the one point in `Leaf` where it reaches the
 * element, and BEFORE the interaction-state hoist: a muted base declaration
 * has to be gone before a hover slice is folded over it, and a muted hover
 * declaration has to leave its slice so the base shows through.
 *
 * Handles the array form of sx for the same reason `hoistStateSx` does — a
 * component may compose its own sx with the author's. Returns the input BY
 * IDENTITY when nothing is muted, which is every element in every session
 * where nobody has opened the comparison.
 */
export function applyMutedStyles<T>(
  sx: T,
  nodeId: string | undefined,
  mutedStyles: readonly string[] | undefined,
): T {
  const targets = mutedStylesForNode(mutedStyles, nodeId)
  if (!targets.length) return sx
  return muteTargets(sx, targets)
}

function muteTargets<T>(sx: T, targets: MutedStyleTarget[]): T {
  if (Array.isArray(sx)) {
    let changed = false
    const next = sx.map((entry) => {
      const value = muteTargets(entry, targets)
      if (value !== entry) changed = true
      return value
    })
    return (changed ? next : sx) as unknown as T
  }
  if (!isPlainObject(sx)) return sx
  let out = sx as Record<string, any>
  for (const target of targets) out = muteOne(out, target)
  return (out === sx ? sx : out) as unknown as T
}

/** What the panel needs to know to offer a row's mute control. */
export interface StyleMuteScope {
  nodeId?: string
  state?: SxState | null
  breakpoint?: SxBreakpoint | null
  /**
   * What the ACTIVE SCOPE declares, keyed by field name — not what the panel
   * displays. The two differ in a state scope, where a field the author has
   * not overridden for hover still shows the base value it inherits: there is
   * no hover declaration to switch off, so that row gets no control.
   */
  scopeValues: Record<string, unknown>
  mutedStyles?: readonly string[]
  onToggle: (target: MutedStyleTarget) => void
}

/** The mute control for one field, or nothing when there is none to offer. */
export function buildStyleMute(
  name: string,
  label: unknown,
  scope: StyleMuteScope,
): FieldMuteAction | undefined {
  if (!scope.nodeId || !name) return undefined
  const target: MutedStyleTarget = {
    nodeId: scope.nodeId,
    property: name,
    state: scope.state ?? null,
    breakpoint: scope.breakpoint ?? null,
  }
  const muted = isStyleMuted(scope.mutedStyles, target)
  // A row with nothing declared in this scope has nothing to switch off. A
  // muted row keeps its control however it reads, or there would be no way
  // back to the value it is still holding.
  if (!muted && scope.scopeValues[name] === undefined) return undefined
  const named = typeof label === 'string' && label ? label : 'this style'
  return {
    label: muted
      ? `Apply ${named} again`
      : `Stop applying ${named} while designing`,
    muted,
    onToggle: () => scope.onToggle(target),
  }
}

/**
 * A group's field declarations carrying their per-row mute control.
 *
 * Supplied through `FormFieldGridProps`, which every editor in the shared
 * mapper spreads onto its wrapper, so the affordance arrives on every field
 * without each editor knowing anything about it. Fields with nothing to mute
 * come back BY IDENTITY, so a panel where nothing is set re-renders exactly
 * as it did before.
 */
export function withStyleMuteControls<
  T extends { name?: string; label?: unknown },
>(fields: readonly T[], scope: StyleMuteScope): T[] {
  return fields.map((field) => {
    const mute = buildStyleMute(field?.name ?? '', field?.label, scope)
    if (!mute) return field
    return {
      ...field,
      FormFieldGridProps: {
        ...((field as { FormFieldGridProps?: object }).FormFieldGridProps ??
          {}),
        mute,
      },
    }
  })
}
