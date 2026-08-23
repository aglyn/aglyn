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
 * One derived statement about an element (AGL-2486).
 *
 * Every fact here is READ OFF the schema, never authored. That is the whole
 * point: a component that changes its `restrictChildren` changes what the
 * picker says about it in the same commit, whereas a sentence somebody typed
 * about it in 2026 is wrong the moment the component moves and nothing
 * fails. Prose is reserved for the things that genuinely cannot be derived.
 */
export interface ElementFact {
  /** Stable key — a surface may order or style by it. Not persisted. */
  id: string
  /** Short user-facing sentence. */
  label: string
}

export interface ElementDetail {
  /** The picker item's own id (a preset id for drawer entries). */
  $id?: string
  /** The component the item ultimately places. */
  componentId?: string
  name: string
  category?: string
  /**
   * Authored one-liner, when the schema carries one. ~22 of the 57 mui
   * component schemas do, and most presets do; the rest show facts only.
   * Deliberately NOT padded with generated filler — a thin honest entry
   * beats an invented paragraph.
   */
  description?: string
  /** Derived, never authored. */
  facts: ElementFact[]
  /** Attribute labels the Attributes panel will offer for this element. */
  attributes: string[]
  /** Set only for components a plugin contributed. */
  pluginId?: string
  /**
   * Parents this element must sit inside, when its schema limits them.
   *
   * Derived from the same `restrictParent` the facts read. A preview uses it
   * to explain itself: an element that only renders in context often draws
   * nothing on its own, and an unexplained blank frame reads as a broken
   * preview rather than as an honest one.
   */
  requiredParents: string[]
}

/** The mui bundle is the built-in set — not worth calling out as a plugin. */
const BUILT_IN_PLUGIN_IDS = new Set(['mui'])

function label(componentId?: string): string | undefined {
  if (!componentId) return undefined
  return Aglyn.components.getLabel(componentId) ?? componentId
}

/**
 * The component ids named by a lineal directive of `directive` type, as
 * labels. Mirrors the reading `confirmValidLinealRelationship` does at drop
 * time, so what the detail view promises is what the canvas enforces.
 */
function linealLabels(
  order: Aglyn.ComponentsLinealOrder | undefined,
  directive: Aglyn.LinealDirectiveFlag,
): string[] {
  if (!order) return []
  const [directiveType, definition] = order
  if (directiveType !== directive) return []
  const components = Array.isArray(definition)
    ? definition
    : definition?.components
  return (components ?? []).map((id) => label(id)).filter(Boolean) as string[]
}

function isEnabled(flag?: Aglyn.FEATURE_FLAG): boolean {
  return Boolean(flag) && Boolean(flag & Aglyn.FEATURE_FLAG.ENABLED)
}

function isDisabled(flag?: Aglyn.FEATURE_FLAG): boolean {
  return Boolean(flag) && Boolean(flag & Aglyn.FEATURE_FLAG.DISABLED)
}

/**
 * The component schema a picker item ultimately places.
 *
 * Drawer entries are PRESETS — "FAQ" is three stacked Accordions — so the
 * facts have to come from the component the preset builds on, while the
 * name and description stay the preset's own. Matches how the drop path
 * resolves a dragged preset before validating it.
 */
function resolveComponentSchema(item: any): {
  componentId?: string
  schema?: Aglyn.ComponentSchema
} {
  const componentId = item?.data?.componentId ?? item?.$id
  if (!componentId) return {}
  return {
    componentId,
    schema: Aglyn.components.getSchema(componentId) as Aglyn.ComponentSchema,
  }
}

/**
 * Everything the element pickers show about one element, derived from the
 * registry (AGL-2486).
 *
 * Both surfaces call this — the Choose-element dialog and the docked
 * Elements panel — so the content is designed once and only the
 * presentation differs. A schema that says nothing produces an entry with a
 * name, a category and no prose, which is the honest answer.
 */
export function describeElement(item: any): ElementDetail | null {
  if (!item) return null

  const { componentId, schema } = resolveComponentSchema(item)
  const name =
    item?.label ||
    item?.displayName ||
    label(item?.$id) ||
    item?.$id ||
    'Element'

  const facts: ElementFact[] = []

  // 1. Can it hold anything? The single most useful thing to know before
  //    dropping one, and the question the child contract already answers.
  const acceptsChildren = Aglyn.schemaAcceptsChildren(schema)
  facts.push({
    id: 'children',
    label: acceptsChildren
      ? 'Holds other elements'
      : 'Does not hold other elements',
  })

  // 2. Lineal relationships, both directions.
  const onlyChildren = linealLabels(
    schema?.restrictChildren,
    Aglyn.LinealDirectiveFlag.LIMIT_TO,
  )
  if (onlyChildren.length) {
    facts.push({
      id: 'only-accepts',
      label: `Only accepts ${onlyChildren.join(', ')}`,
    })
  }
  const noChildren = linealLabels(
    schema?.restrictChildren,
    Aglyn.LinealDirectiveFlag.DISALLOW,
  )
  if (noChildren.length) {
    facts.push({
      id: 'never-accepts',
      label: `Will not accept ${noChildren.join(', ')}`,
    })
  }
  const onlyParents = linealLabels(
    schema?.restrictParent,
    Aglyn.LinealDirectiveFlag.LIMIT_TO,
  )
  if (onlyParents.length) {
    facts.push({
      id: 'only-inside',
      label: `Must be placed inside ${onlyParents.join(' or ')}`,
    })
  }
  const notInside = linealLabels(
    schema?.restrictParent,
    Aglyn.LinealDirectiveFlag.DISALLOW,
  )
  if (notInside.length) {
    facts.push({
      id: 'never-inside',
      label: `Cannot be placed inside ${notInside.join(', ')}`,
    })
  }

  // 3. How its content is edited.
  if (isEnabled(schema?.flags?.textEditable)) {
    facts.push({
      id: 'text-editable',
      label: isEnabled(schema?.flags?.richTextEditable)
        ? 'Its text is edited on the canvas, with basic formatting'
        : 'Its text is edited directly on the canvas',
    })
  }

  // 4. Limitations the editor imposes, where a flag turns one OFF. These are
  //    the ones a user hits and cannot explain.
  if (isDisabled(schema?.flags?.dragging)) {
    facts.push({ id: 'no-drag', label: 'Cannot be moved by dragging' })
  }
  if (isDisabled(schema?.flags?.removing)) {
    facts.push({ id: 'no-remove', label: 'Cannot be deleted' })
  }

  // 5. Provenance — a third-party element should say so, since removing the
  //    plugin removes the element.
  const pluginId = schema?.pluginId ?? item?.pluginId
  if (pluginId && !BUILT_IN_PLUGIN_IDS.has(pluginId)) {
    facts.push({ id: 'plugin', label: `Provided by the ${pluginId} plugin` })
  }

  const attributes = (schema?.attributes ?? [])
    .map((attr: any) => attr?.label || attr?.name)
    .filter(Boolean)

  return {
    $id: item?.$id,
    componentId,
    name,
    category: (item?.category ?? schema?.category) as string,
    // The item's own prose wins — a preset describes itself better than the
    // component it is built from ("Three stacked question panels" vs
    // "Header that expands to reveal its details").
    description: item?.description || schema?.description || undefined,
    facts,
    attributes,
    requiredParents: onlyParents,
    pluginId: pluginId && !BUILT_IN_PLUGIN_IDS.has(pluginId) ? pluginId : undefined,
  }
}

export default describeElement
