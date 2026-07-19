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

import { FieldComponentType } from '@aglyn/aglyn'

/**
 * First-class style controls beyond the base panel (AGL-540): sizing,
 * typography, borders & shadows, position & overflow, and grid/flex-child
 * fields, rendered as accordion groups in the styles panel. Everything
 * still writes through the responsive-sx pipeline, so breakpoint scoping
 * (AGL-333) applies to every field here.
 */
export interface StyleFieldGroup {
  $id: string
  label: string
  fields: Array<Record<string, unknown> & { name: string }>
}

const textField = (
  name: string,
  label: string,
  description: string,
  extra?: Record<string, unknown>,
) => ({
  component: FieldComponentType.TEXT_FIELD,
  name,
  label,
  description,
  ...extra,
})

const half = { FormFieldGridProps: { size: { xs: 12, sm: 6 } } }

const selectField = (
  name: string,
  label: string,
  description: string,
  values: string[],
) => ({
  component: FieldComponentType.SELECT,
  name,
  label,
  description,
  options: [
    { value: '', label: 'Default' },
    ...values.map((value) => ({ value, label: value })),
  ],
})

/**
 * Builds the style accordion groups. `presetColors` feeds the color
 * pickers with the site theme's palette, mirroring the base styles form.
 */
export function buildStyleFieldGroups(
  presetColors: string[],
): StyleFieldGroup[] {
  return [
    {
      $id: 'sizing',
      label: 'Sizing',
      fields: [
        textField('width', 'Width', 'CSS width, e.g. 320px, 50%, 20rem.', half),
        textField('height', 'Height', 'CSS height, e.g. 240px or 100vh.', half),
        textField(
          'minWidth',
          'Min Width',
          'Lower bound for the element width.',
          half,
        ),
        textField(
          'maxWidth',
          'Max Width',
          'Upper bound for the element width.',
          half,
        ),
        textField(
          'minHeight',
          'Min Height',
          'Lower bound for the element height.',
          half,
        ),
        textField(
          'maxHeight',
          'Max Height',
          'Upper bound for the element height.',
          half,
        ),
      ],
    },
    {
      $id: 'typography',
      label: 'Typography',
      fields: [
        textField(
          'fontSize',
          'Font Size',
          'CSS font size, e.g. 18px, 1.25rem.',
          half,
        ),
        selectField(
          'fontWeight',
          'Font Weight',
          'Thickness of the glyph strokes.',
          ['100', '200', '300', '400', '500', '600', '700', '800', '900'],
        ),
        textField(
          'fontFamily',
          'Font Family',
          'Font stack, e.g. Georgia, serif. Prefer theme typography when possible.',
        ),
        textField(
          'lineHeight',
          'Line Height',
          'Line box height, e.g. 1.5 or 28px.',
          half,
        ),
        textField(
          'letterSpacing',
          'Letter Spacing',
          'Tracking between characters, e.g. 0.5px or 0.02em.',
          half,
        ),
        selectField(
          'textTransform',
          'Text Transform',
          'Capitalization applied to the rendered text.',
          ['none', 'uppercase', 'lowercase', 'capitalize'],
        ),
        selectField(
          'textDecoration',
          'Text Decoration',
          'Decorative line on the text.',
          ['none', 'underline', 'overline', 'line-through'],
        ),
      ],
    },
    {
      $id: 'borders',
      label: 'Borders & Shadows',
      fields: [
        textField(
          'border',
          'Border',
          'Border shorthand, e.g. 1px solid or 2px dashed.',
          half,
        ),
        {
          component: FieldComponentType.COLOR_PICKER,
          name: 'borderColor',
          label: 'Border Color',
          description: 'Color for the border shorthand above.',
          presetColors,
          ...half,
        },
        textField(
          'borderRadius',
          'Corner Radius',
          'Rounded corners, e.g. 8px, 50%, or a theme spacing number.',
          half,
        ),
        textField(
          'outline',
          'Outline',
          'Outline shorthand drawn outside the border, e.g. 2px solid.',
          half,
        ),
        {
          component: FieldComponentType.SELECT,
          name: 'boxShadow',
          label: 'Shadow',
          description:
            'Drop shadow. Pick a preset here, or type any CSS box-shadow ' +
            'under Classes & custom CSS.',
          options: [
            { value: '', label: 'Default' },
            { value: 'none', label: 'None' },
            { value: '0 1px 3px rgba(0,0,0,0.2)', label: 'Subtle' },
            { value: '0 4px 12px rgba(0,0,0,0.15)', label: 'Medium' },
            { value: '0 12px 32px rgba(0,0,0,0.25)', label: 'Large' },
          ],
        },
      ],
    },
    {
      $id: 'position',
      label: 'Position & Overflow',
      fields: [
        selectField(
          'position',
          'Position',
          'Positioning scheme; offsets below apply to non-static elements.',
          ['static', 'relative', 'absolute', 'fixed', 'sticky'],
        ),
        textField('top', 'Top', 'Offset from the top edge.', half),
        textField('right', 'Right', 'Offset from the right edge.', half),
        textField('bottom', 'Bottom', 'Offset from the bottom edge.', half),
        textField('left', 'Left', 'Offset from the left edge.', half),
        textField(
          'zIndex',
          'Z-Index',
          'Stacking order for positioned elements.',
          { type: 'number', ...half },
        ),
        selectField(
          'overflow',
          'Overflow',
          'What happens to content that does not fit the element box.',
          ['visible', 'hidden', 'clip', 'scroll', 'auto'],
        ),
        textField(
          'opacity',
          'Opacity',
          'Element transparency from 0 (invisible) to 1 (opaque).',
          { type: 'number', ...half },
        ),
        selectField(
          'cursor',
          'Cursor',
          'Pointer shown while hovering the element.',
          ['default', 'pointer', 'text', 'move', 'grab', 'not-allowed'],
        ),
      ],
    },
    {
      $id: 'grid',
      label: 'Grid & Flex Child',
      fields: [
        textField(
          'gridTemplateColumns',
          'Grid Columns',
          'Column track list for display: grid, e.g. repeat(3, 1fr).',
        ),
        textField(
          'gridTemplateRows',
          'Grid Rows',
          'Row track list for display: grid, e.g. auto 1fr auto.',
        ),
        selectField(
          'gridAutoFlow',
          'Grid Auto Flow',
          'How auto-placed grid items fill the tracks.',
          ['row', 'column', 'dense', 'row dense', 'column dense'],
        ),
        textField(
          'gridColumn',
          'Grid Column',
          'Column placement of this item, e.g. span 2 or 1 / 3.',
          half,
        ),
        textField(
          'gridRow',
          'Grid Row',
          'Row placement of this item, e.g. span 2 or 1 / 3.',
          half,
        ),
        textField(
          'flexShrink',
          'Flex Shrink',
          'How much this flex item shrinks when space is tight.',
          { type: 'number', ...half },
        ),
        textField(
          'order',
          'Order',
          'Visual order of this flex/grid item within its container.',
          { type: 'number', ...half },
        ),
      ],
    },
  ]
}

/** Field names owned by a group — the only keys its save may touch. */
export function styleGroupFieldNames(group: StyleFieldGroup): string[] {
  return group.fields.map((field) => field.name)
}

/**
 * The sx partial a group save is allowed to produce: exactly its own
 * field names. Keys owned by other groups (or by the custom-CSS editor)
 * never appear, so one group's auto-save can never clear another's
 * values (AGL-540).
 */
export function computeStylePartial(
  fieldNames: readonly string[],
  values: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const partial: Record<string, unknown> = {}
  for (const name of fieldNames) {
    partial[name] = values?.[name]
  }
  return partial
}

/** Picks a group's own values out of the effective sx value map. */
export function pickStyleValues(
  fieldNames: readonly string[],
  values: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const picked: Record<string, unknown> = {}
  for (const name of fieldNames) {
    if (values && values[name] !== undefined) picked[name] = values[name]
  }
  return picked
}
