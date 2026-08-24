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
import { action, toJS } from 'mobx'

/**
 * Props an instance override must never write (AGL-1899).
 *
 * `sx` is refused at the RENDER layer too (`ATTR_OVERRIDE_REFUSED_PROPS` in
 * `compose-reusable-components.ts`) — styling an instance already has its own
 * override field one level up, and honouring both would leave two writers
 * racing for one rendered value with no rule to say which wins.
 *
 * `children` and `html` are refused HERE, by the writer, and deliberately not
 * at the render layer. They are CONTENT, and content inside a component
 * already has two routes with an owner each: a declared `{{prop.*}}` filled
 * in per instance, and AGL-1304's double-click-to-edit on the canvas, which
 * writes through that same binding. A third control writing `children` on the
 * instance would be a third writer on one rendered string — the shape behind
 * the unreproduced "Maximum update depth exceeded" report on this panel — and
 * it would silently win over a binding the component author put there on
 * purpose. Refusing it in the writer (rather than in the graft) keeps the
 * storage layer's meaning unchanged, so a later issue can offer content
 * overrides deliberately instead of inheriting them by accident.
 */
export const ATTR_OVERRIDE_REFUSED_WRITE_PROPS = new Set([
  'sx',
  'children',
  'html',
])

/**
 * Where the Attributes panel's per-instance ATTRIBUTE overrides land for the
 * selected node (AGL-1899) — the attribute-side twin of
 * {@link getNodeStyleTarget}.
 *
 * A reusable-component instance's overrides read and write one slice of
 * `node.attrOverrides`: the root slice by default, or the slice keyed by a
 * DEFINITION-internal node id when the author has picked a leaf inside the
 * component. The graft (`composeReusableComponentNodes`) merges that slice
 * over the matching definition node's props, per named prop, so canvas,
 * Preview and tenant SSR agree without any of them knowing this file exists.
 *
 * A PLAIN node has no attribute-override layer at all, and this target
 * refuses to write one: a plain node's attributes are `node.props`, which the
 * Attributes form itself owns through `updateNodeProps`. Handing back a
 * second writer for the same record is exactly how two controls end up
 * fighting over one value, so the plain-node target reports
 * `isInstanceOverride: false` and its `setAttrs` does nothing.
 *
 * `attrs` is a GETTER so `observer` components track the underlying MobX
 * state at read time; a snapshot captured when the target was built would go
 * stale after the first write.
 */
export interface NodeAttrTarget {
  /**
   * The override slice edits read from and write to (live view), or
   * `undefined` when this instance overrides nothing for this target.
   *
   * Deliberately NOT composed with the definition's own props: an override
   * slice starts empty and empty MEANS "whatever the component says". Merging
   * a base into the reading would make every inherited value look like an
   * override this instance had chosen, and the ✕ on its chip would then
   * appear to do nothing.
   */
  readonly attrs: Record<string, any> | undefined
  /** True when edits land in one of the instance's override slices. */
  readonly isInstanceOverride: boolean
  /**
   * The `attrOverrides` key being edited — `root`, or a definition-internal
   * node id. Empty string for a plain node, which has no override layer.
   */
  readonly overrideKey: string
  /** True when the target is a leaf inside the component, not its root. */
  readonly isLeafOverride: boolean
  /** Replaces the target slice wholesale (MobX action inside). */
  setAttrs(next: Record<string, any> | undefined): void
  /** Removes ONE overridden prop, leaving this instance's others (MobX action inside). */
  clearAttr(prop: string): void
}

const isPlainRecord = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Whether a value the form produced is an OVERRIDE at all (AGL-1899).
 *
 * `strictNullChecks` is off repo-wide, so "absent" and "empty" fold together
 * the moment anything tests an override slice for truthiness. This function is
 * the one place that decision is made, and it is deliberately narrow:
 *
 * - `undefined` is not an override. A cleared field, and every prop the
 *   definition declares that this instance has not touched, arrive as
 *   `undefined`, and storing them would turn "I opened the panel" into an
 *   override on every prop of the component.
 * - `''` is not an override either. final-form gives a cleared text box an
 *   empty string, so this is what "clear this field" actually looks like on
 *   the way in; the explicit way to say "override, and render nothing" is not
 *   offered by this panel, which does not edit content props at all.
 * - `false` and `0` ARE overrides, and this is the case worth naming. They
 *   are the values `strictNullChecks: false` code most often loses: an
 *   instance that turns a component's `disableGutters` OFF, or sets an
 *   `elevation` of `0`, is making a real choice, and folding it to "no
 *   override" would render the component's own value instead — the override
 *   would appear to save and then silently not apply.
 */
export function isAttrOverrideValue(value: unknown): boolean {
  return value !== undefined && value !== ''
}

/**
 * The slice as it may be STORED: refused props dropped, and every
 * non-override value dropped by KEY (AGL-1899).
 *
 * Deleting the key rather than storing `undefined` is load-bearing, not
 * tidiness. The graft applies a slice by spreading it over the definition's
 * props, so a stored `{ variant: undefined }` would set `variant` to
 * `undefined` on the rendered node — while `CanvasManager.toJSON`'s
 * `stripUndefinedDeep` removes that same key on the way to storage. The
 * instance would then render one way on the canvas and another way after a
 * reload, which is precisely the canvas/Preview/SSR disagreement this whole
 * override layer is built as a single merge point to prevent.
 */
function storableSlice(
  next: Record<string, any> | undefined,
): Record<string, any> {
  const slice: Record<string, any> = {}
  if (!isPlainRecord(next)) return slice
  for (const [prop, value] of Object.entries(next)) {
    if (!prop || ATTR_OVERRIDE_REFUSED_WRITE_PROPS.has(prop)) continue
    if (!isAttrOverrideValue(value)) continue
    slice[prop] = value
  }
  return slice
}

/** A no-op target for nodes with no attribute-override layer. */
function plainNodeTarget(): NodeAttrTarget {
  return {
    isInstanceOverride: false,
    overrideKey: '',
    isLeafOverride: false,
    get attrs() {
      return undefined
    },
    setAttrs: () => undefined,
    clearAttr: () => undefined,
  }
}

/**
 * The attribute-override target for a selected node — see
 * {@link NodeAttrTarget}.
 *
 * `overrideKey` selects WHICH slice of an instance's overrides is edited. A
 * falsy key falls back to the root, so a caller that has not resolved a
 * definition yet still edits something real rather than writing an
 * `undefined`-keyed slice no renderer reads.
 */
export function getNodeAttrTarget(
  node: Aglyn.NodeSchema<any> | null | undefined,
  overrideKey?: string | null,
): NodeAttrTarget {
  const isInstance = node?.componentId === Aglyn.REUSABLE_INSTANCE_COMPONENT_ID
  if (!node || !isInstance) return plainNodeTarget()
  const key = overrideKey || Aglyn.STYLE_OVERRIDES_ROOT_KEY
  return {
    isInstanceOverride: true,
    overrideKey: key,
    isLeafOverride: key !== Aglyn.STYLE_OVERRIDES_ROOT_KEY,
    get attrs() {
      return (node.attrOverrides as Record<string, any> | undefined)?.[key]
    },
    setAttrs: action((next: Record<string, any> | undefined) => {
      const overrides: Record<string, any> = {
        ...toJS(node.attrOverrides ?? {}),
      }
      const slice = storableSlice(next)
      if (Object.keys(slice).length > 0) {
        overrides[key] = slice
      } else {
        // An emptied override is REMOVED, not stored as `{}`: the panel's
        // override chip and the graft's "has an override" check must both
        // read a cleared instance as clean. Only THIS slice goes — the
        // instance's other targets keep theirs.
        delete overrides[key]
      }
      node.attrOverrides =
        Object.keys(overrides).length > 0 ? overrides : undefined
    }),
    clearAttr: action((prop: string) => {
      const current = (node.attrOverrides as Record<string, any> | undefined)?.[
        key
      ]
      if (!isPlainRecord(current) || !(prop in current)) return
      const nextSlice = { ...toJS(current) }
      delete nextSlice[prop]
      const overrides: Record<string, any> = {
        ...toJS(node.attrOverrides ?? {}),
      }
      if (Object.keys(nextSlice).length > 0) overrides[key] = nextSlice
      else delete overrides[key]
      node.attrOverrides =
        Object.keys(overrides).length > 0 ? overrides : undefined
    }),
  }
}

/**
 * Attribute editors the override panel offers (AGL-1899).
 *
 * Every entry is registered in `elementPropsComponentMapper` AND resolves
 * entirely from the component schema — no canvas context, no host callback,
 * no second prop written beside it. An unregistered editor makes the form
 * renderer THROW, which is what once blanked the whole email designer's
 * attributes panel (AGL-584), so the filter is an allowlist rather than a
 * denylist: a component declaring an editor nobody thought about here loses
 * one row from the override list, not the panel.
 *
 * Deliberately NOT offered, and each for its own reason:
 *
 * - `ICON_PICKER` writes a SECOND prop beside the one it names (the
 *   denormalized SVG path, AGL-1212). An override slice that carried the id
 *   without the path would render the "help" glyph.
 * - `SCREEN_LINK`, and the screen/entity/dataset/node selects, resolve their
 *   options from editor context the graft never sees.
 * - `MARKDOWN`, `CSS_GRADIENT`, `BREAKPOINT_SPAN` and `PLUGIN_SETTINGS` each
 *   edit a composite value with its own rules; a per-instance override of one
 *   is a design question, not a plumbing one.
 */
export const ATTR_OVERRIDE_SUPPORTED_EDITORS = new Set<string>([
  Aglyn.FieldComponentType.TEXT_FIELD,
  Aglyn.FieldComponentType.TEXTAREA,
  Aglyn.FieldComponentType.SELECT,
  Aglyn.FieldComponentType.SWITCH,
  Aglyn.FieldComponentType.CHECKBOX,
  Aglyn.FieldComponentType.COLOR_PICKER,
  Aglyn.FieldComponentType.CSS_DIMENSION,
])

/** One overridable attribute of a node inside a component definition. */
export interface InstanceAttrField {
  /** The prop name, which is also the form field name and the slice key. */
  name: string
  /** The field schema handed to the form renderer. */
  field: Record<string, unknown>
}

/**
 * The attributes of ONE node inside a component definition that this
 * instance may override, in the component schema's own order (AGL-1899).
 *
 * The definition node's CURRENT value shows as the field's placeholder, which
 * is the whole of how "empty means the component's value" is made legible:
 * an author looking at a blank Variant box can see it says `contained`
 * underneath, and knows what clearing an override goes back to.
 *
 * Field names are the prop names verbatim and the form is flat, so a name
 * carrying a dot is skipped — final-form reads `a.b` as a nested path, so
 * such a field would write a level the slice does not have and the value
 * would silently never reach the node (the same trap
 * `COMPONENT_PROP_NAME_PATTERN` exists for one layer up).
 */
export function listInstanceAttrFields(
  defNode:
    | { componentId?: string; props?: Record<string, unknown> }
    | null
    | undefined,
): InstanceAttrField[] {
  const attributes = defNode?.componentId
    ? (Aglyn.components.getSchema(defNode.componentId)?.attributes ?? [])
    : []
  const fields: InstanceAttrField[] = []
  const seen = new Set<string>()
  for (const attribute of attributes) {
    const name = (attribute as { name?: string })?.name
    const component = (attribute as { component?: string })?.component
    if (!name || seen.has(name)) continue
    if (name.includes('.') || name.includes('[')) continue
    if (ATTR_OVERRIDE_REFUSED_WRITE_PROPS.has(name)) continue
    if (!component || !ATTR_OVERRIDE_SUPPORTED_EDITORS.has(component)) continue
    seen.add(name)
    const inherited = (defNode?.props as Record<string, unknown> | undefined)?.[
      name
    ]
    fields.push({
      name,
      field: {
        ...(attribute as Record<string, unknown>),
        name,
        // An override field is never required: leaving it empty is the
        // supported state, and a `required` copied off the component's own
        // schema would make the form invalid — and therefore unsavable — the
        // moment the panel opened.
        isRequired: false,
        validate: undefined,
        placeholder:
          typeof inherited === 'string' || typeof inherited === 'number'
            ? String(inherited)
            : undefined,
      },
    })
  }
  return fields
}

export default getNodeAttrTarget
