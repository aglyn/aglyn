/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import {
  AglynAttributeSchema,
  FieldComponentType,
} from '@aglyn/aglyn'

/**
 * Theme colour for Button and Screen Link.
 *
 * The `{ value: '', label: 'Default' }` option was DELETED (AGL-1453). It could
 * not persist — the attributes form strips `''` on change (AGL-1191) — so the
 * pick silently reverted, and it was a second name for a choice already on the
 * list: MUI's own default for both components is `primary`, offered below.
 *
 * Deliberately NOT replaced with a `'primary'` sentinel, which is where this
 * differs from the props that got one. "Default" means *unset*, and unset is
 * load-bearing: MUI reads a component's props through `useDefaultProps`, which
 * applies a host theme's `components.MuiButton.defaultProps.color` to
 * `undefined` ONLY. A sentinel would pin `primary` and bypass the host's own
 * default — the opposite of what an author asking for "Default" wants. Unset
 * stays expressible through the field's ✕, which persists `null`, and
 * `dropClearedProps` turns that back into `undefined` at the boundary.
 */
export const FIELD_COLOR: AglynAttributeSchema = {
  name: 'color',
  description:
    'The color of the component. It supports those theme colors that make sense for this component.',
  component: FieldComponentType.SELECT,
  label: 'Theme color',
  options: [
    { value: 'inherit', label: 'Inherit' },
    { value: 'primary', label: 'Primary' },
    { value: 'secondary', label: 'Secondary' },
    { value: 'success', label: 'Success' },
    { value: 'error', label: 'Error' },
    { value: 'info', label: 'Info' },
    { value: 'warning', label: 'Warning' },
  ],
}
/**
 * App Bar theme colors. Unlike the base FIELD_COLOR (where "Default" means
 * "unset — let the component decide"), MUI AppBar's `color="default"` is a
 * real value DISTINCT from its implicit default (`primary`), so the option
 * must persist. An empty-string option value never can: the attributes form
 * strips `''` on change (ddf's enhancedOnChange maps an emptied field to its
 * clearedValue, and final-form's default parse turns `''` into `undefined`),
 * so the prop key vanished before save and the pick silently reverted on
 * reload (AGL-1191). Persist the explicit `'default'` sentinel instead; an
 * author who wants "unset" clears the field with the ✕ affordance.
 */
export const FIELD_COLOR_ALT1: AglynAttributeSchema = {
  ...FIELD_COLOR,
  options: [
    { value: 'default', label: 'Default' },
    { value: 'inherit', label: 'Inherit' },
    { value: 'transparent', label: 'Transparent' },
    { value: 'primary', label: 'Primary' },
    { value: 'secondary', label: 'Secondary' },
    { value: 'tertiary', label: 'Tertiary' },
  ],
}
export const FIELD_DISABLED: AglynAttributeSchema = {
  name: 'disabled',
  description: 'If true, the component is disabled.',
  component: FieldComponentType.SWITCH,
  label: 'Disabled?',
}
export const FIELD_FULL_WIDTH: AglynAttributeSchema = {
  name: 'fullWidth',
  description:
    'If true, the button will take up the full width of its container.',
  component: FieldComponentType.SWITCH,
  label: 'Full width?',
}
export const FIELD_DISABLE_GUTTERS: AglynAttributeSchema = {
  name: 'disableGutters',
  description: 'If true, disables gutter padding.',
  component: FieldComponentType.SWITCH,
  label: 'Disable gutters?',
}
/**
 * Size for Button and Screen Link. Pagination replaces the option list.
 *
 * `{ value: '', label: 'Default' }` deleted for the same reason as
 * FIELD_COLOR's (AGL-1453): unpersistable, and a second name for `medium`,
 * which is MUI's own default and is already on the list.
 */
export const FIELD_SIZE: AglynAttributeSchema = {
  name: 'size',
  description:
    'The size of the component. small is equivalent to the dense button styling.',
  component: FieldComponentType.SELECT,
  label: 'Size',
  options: [
    { value: 'inherit', label: 'Inherit' },
    { value: 'small', label: 'Small' },
    { value: 'medium', label: 'Medium' },
    { value: 'large', label: 'Large' },
  ],
}
/**
 * App Bar positioning.
 *
 * `{ value: '', label: 'Default' }` deleted (AGL-1453): unpersistable, and a
 * second name for `fixed`, MUI AppBar's own default, already on the list.
 */
export const FIELD_POSITION: AglynAttributeSchema = {
  name: 'position',
  description:
    'The positioning type. The behavior of the different options is described in the MDN web docs. Note: sticky is not universally supported and will fall back to static when unavailable.',
  component: FieldComponentType.SELECT,
  label: 'Position',
  options: [
    { value: 'absolute', label: 'Absolute' },
    { value: 'fixed', label: 'Fixed' },
    { value: 'relative', label: 'Relative' },
    { value: 'static', label: 'Static' },
    { value: 'sticky', label: 'Sticky' },
  ],
}
/**
 * Text content of a text-capable component (`children` prop). Pair with the
 * `textEditable` schema flag so editor surfaces know the component renders
 * its children as editable text.
 */
export const FIELD_TEXT_CONTENT: AglynAttributeSchema = {
  name: 'children',
  description: 'The text content this element displays.',
  component: FieldComponentType.TEXTAREA,
  label: 'Text',
}
