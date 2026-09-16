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

import { matchComponentPropToken } from '@aglyn/aglyn/app-utils/compose-reusable-components'
import {
  NODE_HIDE_IF_PROP,
  NODE_HIDE_UNLESS_PROP,
} from '@aglyn/aglyn/app-utils/reusable-component-keys'
import type { ReusableComponentProp } from '@aglyn/aglyn/foundation/definitions/platform.types'
import {
  attributeFieldValueShape,
  reusablePropBindsToField,
  reusablePropValueShape,
  unofferedChoiceValues,
} from '@aglyn/aglyn/foundation/definitions/property-kinds'
import { aiBindingTokensIn } from '../model/ai-template-subjects'
import type { AiPaletteEntry } from './ai-palette'

/**
 * Which field of a generated reusable component may carry which of the
 * component's own properties (AGL-2908).
 *
 * A component's tree reaches its properties through `{{prop.<name>}}` tokens,
 * and the graft hands each field the value its property's kind holds
 * (`resolveComponentPropTokens`). So a binding is right only where the field
 * can show that value:
 *
 * - A field that is not typed into — a switch, a dropdown, a screen picker, a
 *   slider — takes exactly the properties the Attributes panel offers it
 *   under its `{}` (AGL-2871): `reusablePropBindsToField`, the editor's own
 *   judgment, over the field kind the palette records. The token is the
 *   field's whole value.
 * - A field that is typed into takes any token in the editor. A generated
 *   binding is held to what reads right there: copy in copy (Text, Long text
 *   or Number, whole or inside a sentence), a picture as an image's source
 *   and a link as an address, each as the whole value.
 * - The visibility directives are switches the graft reads before anything
 *   renders: `hideIf` takes a Yes / no, and `hideUnless` a Link, whose
 *   absence hides the part.
 *
 * Pure: the palette validator reads it to keep a token as written, and the
 * component step's check reads it to hold each token to its property.
 */

/** A declared property, as a binding reads it. */
export type AiComponentPropBinding = Pick<
  ReusableComponentProp,
  'name' | 'type' | 'options' | 'settings'
>

/** Where a token sits in a field's value: the whole value, or inside copy. */
export type AiComponentPropPlacement = 'whole' | 'inside'

/** The node props a component's tree may bind that no element declares. */
export const AI_COMPONENT_VISIBILITY_PROPS: readonly string[] = [
  NODE_HIDE_IF_PROP,
  NODE_HIDE_UNLESS_PROP,
]

/** Kinds whose value reads as copy, which copy may carry inside a sentence. */
export const AI_COMPONENT_COPY_KINDS: ReadonlySet<string> = new Set(['text', 'richText', 'number'])

/** Whether a value is exactly one component property token. */
export function isAiComponentPropToken(value: unknown): value is string {
  return matchComponentPropToken(value) !== null
}

/** The property names a value's tokens name, each once, in order. */
export function aiComponentPropNamesIn(value: unknown): string[] {
  if (typeof value !== 'string' || !value.includes('{{')) return []
  const names: string[] = []
  for (const token of aiBindingTokensIn(value)) {
    const name = matchComponentPropToken(token)
    if (name && !names.includes(name)) names.push(name)
  }
  return names
}

type PaletteFields = Pick<AiPaletteEntry, 'propsSchema' | 'propRoles' | 'propFields'>

/** A palette prop as the attribute field the editor draws it with. */
function attributeField(
  entry: PaletteFields,
  field: string,
): { component: string; options?: Array<{ value: string }> } | null {
  const schema = entry.propsSchema.properties[field]
  const component = entry.propFields[field]
  if (!schema || !component) return null
  return {
    component,
    ...(schema.enum ? { options: schema.enum.map((value) => ({ value })) } : {}),
  }
}

/**
 * Whether a property may be bound to one field of an element, placed as it
 * is. `field` is a prop the palette declares for the element, or one of the
 * visibility directives.
 */
export function aiComponentPropBindsToField(
  prop: AiComponentPropBinding,
  entry: PaletteFields | undefined,
  field: string,
  placement: AiComponentPropPlacement,
): boolean {
  if (field === NODE_HIDE_IF_PROP) {
    return placement === 'whole' && reusablePropValueShape(prop) === 'boolean'
  }
  if (field === NODE_HIDE_UNLESS_PROP) {
    return placement === 'whole' && prop.type === 'href'
  }
  const declared = entry ? attributeField(entry, field) : null
  if (!entry || !declared) return false
  if (attributeFieldValueShape(declared) !== undefined) {
    return placement === 'whole' && reusablePropBindsToField(prop, declared)
  }
  const type = prop.type ?? 'text'
  switch (entry.propRoles[field]) {
    case 'url':
      return placement === 'whole' && type === 'href'
    case 'media':
      return placement === 'whole' && type === 'image'
    case 'text':
      return AI_COMPONENT_COPY_KINDS.has(type)
    default:
      return false
  }
}

/** The answers of a property that the field it is bound to does not list. */
export function aiComponentUnofferedAnswers(
  prop: AiComponentPropBinding,
  entry: PaletteFields | undefined,
  field: string,
): string[] {
  const declared = entry ? attributeField(entry, field) : null
  return unofferedChoiceValues(prop, declared?.options)
}
