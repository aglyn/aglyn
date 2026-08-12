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

/**
 * The drop/render agreement (AGL-1389).
 *
 * A component that accepts a drop in the hierarchy and discards the node at
 * render is silent data loss: the author sees the node in the tree, the
 * published page does not have it, and nothing warns — so the work reads as
 * *never done* rather than broken. Three /press screenshots shipped in a page
 * payload for weeks that way (AGL-1388).
 *
 * That was found by reading all 82 registered schemas by hand, one at a time.
 * This module is the repeatable half: the predicate the editor actually gates
 * drops on, plus an audit that turns "someone added a component and never
 * thought about children" into a red test.
 *
 * Deliberately NOT a render sweep. Rendering every schema with a sentinel
 * child fails for components that legitimately hide children behind state
 * (a collapsed Accordion, a closed Drawer, a `lazyPanels` TabPanel) and for
 * every one needing a provider or the canvas singleton — so it would need an
 * exemption list, and an exemption list that grows silently is worth less
 * than no test. See {@link auditChildContract} for what is enforced instead.
 */

import { FEATURE_FLAG } from '../foundation'

/**
 * The slice of a component schema this contract reads. Structural on purpose:
 * `ComponentSchema` (types/nodes) and `AglynComponentSchema` (foundation) are
 * two spellings of the same thing and bundles are typed with both.
 */
export interface ChildContractSchema {
  $id?: string
  displayName?: string
  restrictChildren?: unknown
  flags?: {
    dropping?: FEATURE_FLAG
    selfClosing?: FEATURE_FLAG
    textEditable?: FEATURE_FLAG
  }
}

/** One registry entry — matches `MUI_BUNDLE` / `FeatureBundleEntry`. */
export interface ChildContractEntry {
  schema: ChildContractSchema
}

/**
 * True only when a feature flag is explicitly present and carries the ENABLED
 * bit. An absent (undefined) flag reads as false: components that declare no
 * flags at all (Stack, Section, the document root) must not be mistaken for
 * self-closing leaves.
 */
export function isLeafFlagEnabled(flag?: FEATURE_FLAG): boolean {
  return typeof flag === 'number' && (flag & FEATURE_FLAG.ENABLED) !== 0
}

/**
 * The mirror, for the flags whose interesting value is the switched-OFF one.
 * An absent flag reads as false, so a component that declares no flags keeps
 * the permissive default.
 */
export function isFlagDisabled(flag?: FEATURE_FLAG): boolean {
  return typeof flag === 'number' && (flag & FEATURE_FLAG.DISABLED) !== 0
}

/**
 * A `restrictChildren` that allows NOTHING — `[LIMIT_TO, { components: [] }]`,
 * the Layout Slot's spelling of "my children come from somewhere else".
 *
 * Read here as a fourth way to say "no canvas child slot", alongside the three
 * flags: the dnd manager's `confirmValidLinealRelationship` already refuses
 * every candidate against an empty allowlist, so a schema that says this and
 * nothing else was already unreachable by drop — the hierarchy just hadn't
 * been told. Deliberately narrow: an empty DISALLOW list forbids nothing, and
 * an allowlist naming plugins (rather than components) still admits those.
 */
function restrictsChildrenToNothing(restrict: unknown): boolean {
  if (!Array.isArray(restrict) || restrict.length < 2) return false
  const [directive, definition] = restrict as [unknown, unknown]
  if (directive !== 'limitedTo') return false
  if (Array.isArray(definition)) return definition.length === 0
  if (!definition || typeof definition !== 'object') return false
  const { components, plugins } = definition as {
    components?: unknown
    plugins?: unknown
  }
  if (Array.isArray(plugins) && plugins.length > 0) return false
  return Array.isArray(components) && components.length === 0
}

/**
 * Whether the editor will let a node be dropped into a node of this component
 * — the ONE rule every author-facing entry point shares (the Insert menu and
 * paste via `resolveInsertTarget`, canvas drag-and-drop via the dnd manager's
 * `computedDrop`, and the drop indicator), read through
 * `CanvasManager.nodeAcceptsChildren`.
 *
 * Four ways a schema declares it has nowhere to put a dropped node:
 *
 * - `flags.selfClosing` — an image, an icon, a divider.
 * - `flags.textEditable` — the component renders `children` as editable text,
 *   so an element dropped in would be destroyed by the next text edit.
 * - `flags.dropping: DISABLED` — neither of the above, but still no slot
 *   (AGL-1388): Markdown renders its parsed `content` prop and nothing else;
 *   a Reusable Component instance has its child list REPLACED by the grafted
 *   definition at compose time; List Item Text hands `children` to MUI, which
 *   reads it only as a fallback for a missing `primary`.
 * - an empty `restrictChildren` allowlist — see above.
 *
 * Anything else accepts children, which is why the audit below exists: the
 * permissive answer is the DEFAULT, so a component nobody thought about is
 * indistinguishable from a container until something asks.
 *
 * An unregistered / missing schema accepts children, matching the canvas.
 */
export function schemaAcceptsChildren(
  schema: ChildContractSchema | null | undefined,
): boolean {
  if (!schema) return true
  const flags = schema.flags
  if (isFlagDisabled(flags?.dropping)) return false
  if (isLeafFlagEnabled(flags?.selfClosing)) return false
  if (isLeafFlagEnabled(flags?.textEditable)) return false
  return !restrictsChildrenToNothing(schema.restrictChildren)
}

/**
 * A bundle's declared containers: the component ids whose author has
 * confirmed the component renders the nodes dropped into it.
 *
 * Not an exemption list — the inverse. Exemptions are the entries a guard
 * agrees to skip, so they accumulate quietly and the guard shrinks. This list
 * is the set the guard is ABOUT: a new component defaults to accepting
 * children, so it lands here or the test is red, and the only way to make it
 * green is to answer the question ("does it render `children`?") one way or
 * the other. Nothing can be added by accident.
 */
export type DeclaredContainers = readonly string[]

/**
 * Every disagreement between a bundle's schemas and its declared container
 * list, as reviewer-facing lines (empty = the contract holds).
 *
 * Both directions matter:
 *
 * - An undeclared container is the AGL-1388 shape arriving again — a
 *   component the editor will accept a drop into that nobody has confirmed
 *   renders one.
 * - A declared id that no longer accepts a drop, or is no longer registered,
 *   is a stale entry. Left alone the list would slowly become a wish, and a
 *   guard checked against a wish passes over anything.
 *
 * Returns strings rather than throwing so the caller is a one-line
 * `expect(...).toEqual([])` whose failure output names every offender at once
 * — the whole point being that the next person does not repeat the 82-schema
 * hand audit.
 */
export function auditChildContract(
  entries: readonly ChildContractEntry[],
  declared: DeclaredContainers,
): string[] {
  const problems: string[] = []
  const declaredSet = new Set(declared)
  const registered = new Set<string>()

  for (const entry of entries) {
    const schema = entry?.schema
    const id = schema?.$id
    if (!id) {
      problems.push(
        `a schema in this bundle has no $id (${
          schema?.displayName ?? 'unnamed'
        }) — it cannot be held to the drop/render agreement`,
      )
      continue
    }
    registered.add(id)
    const accepts = schemaAcceptsChildren(schema)
    if (accepts && !declaredSet.has(id)) {
      problems.push(
        `${id} accepts a drop but is not a declared container — either it ` +
          'renders its children (add it to the list) or it does not, and ' +
          'then it must SAY so: flags.selfClosing, flags.textEditable, ' +
          'flags.dropping: FEATURE_FLAG.DISABLED, or an empty ' +
          'restrictChildren allowlist (AGL-1389)',
      )
    }
    if (!accepts && declaredSet.has(id)) {
      problems.push(
        `${id} is a declared container but the editor now refuses drops ` +
          'into it — drop it from the list, or remove whatever flag closed ' +
          'it (AGL-1389)',
      )
    }
  }

  for (const id of declaredSet) {
    if (!registered.has(id)) {
      problems.push(
        `${id} is a declared container but is not registered in this ` +
          'bundle — remove the stale entry (AGL-1389)',
      )
    }
  }

  return problems.sort()
}

/** The ids in a bundle the editor will accept a drop into, sorted. */
export function listAcceptingComponentIds(
  entries: readonly ChildContractEntry[],
): string[] {
  return entries
    .filter((entry) => schemaAcceptsChildren(entry?.schema))
    .map((entry) => entry.schema.$id as string)
    .filter(Boolean)
    .sort()
}
