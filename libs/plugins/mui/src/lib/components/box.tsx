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
import { mdiSquareOutline } from '@aglyn/shared-data-mdi'
import MuiBox from '@mui/material/Box'
import { forwardRef, type ReactNode } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'muiBox'

/**
 * Elements Box may render as. Deliberately *not* the landmark set —
 * section/article/nav/header/footer/main belong to the Section element,
 * which also exposes the accessible-name field a landmark needs. Box owns
 * the generic wrappers that carry no document outline.
 *
 * An allow-list rather than a free-text field: `component` is persisted
 * and rendered verbatim, so a typed value would let an author put
 * `script`/`iframe` into every visitor's page.
 */
export const BOX_ELEMENTS = [
  'div',
  'span',
  'p',
  'figure',
  'figcaption',
  'blockquote',
  'pre',
] as const
export type BoxElement = (typeof BOX_ELEMENTS)[number]

export interface BoxElementProps {
  /** The DOM element rendered; defaults to `div`. */
  component?: BoxElement
  children?: ReactNode
}

/**
 * The plain styling primitive (https://mui.com/material-ui/react-box/):
 * a wrapper with no opinions of its own, sized/spaced/coloured entirely
 * from the styles panel's `sx`. Use it when the grouping is purely
 * visual; use Section when the grouping means something in the document
 * outline.
 */
const BoxElement = forwardRef<HTMLElement, BoxElementProps>((props, ref) => {
  const { component, children, ...rest } = props
  const element = BOX_ELEMENTS.includes(component as BoxElement)
    ? (component as BoxElement)
    : 'div'
  return (
    <MuiBox ref={ref} component={element} {...rest}>
      {children}
    </MuiBox>
  )
})
BoxElement.displayName = 'AglynBox'

export const schema: Aglyn.ComponentSchema<BoxElementProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Box',
  description:
    'Generic container with no styling of its own — style it from the ' +
    'styles panel.',
  category: Aglyn.ComponentCategory.LAYOUT,
  icon: { path: mdiSquareOutline.path, sx: { color: '#2196f3' } },
  attributes: [
    {
      name: 'component',
      label: 'HTML element',
      description:
        'The DOM element this box renders as. For landmarks ' +
        '(section, article, nav, header, footer, main) use the Section ' +
        'element instead — it also names the landmark for screen readers.',
      component: Aglyn.FieldComponentType.SELECT,
      options: BOX_ELEMENTS.map((value) => ({ value, label: value })),
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Box',
    pluginId: BUNDLE_ID,
    description: 'Generic container you style yourself',
    category: Aglyn.ComponentCategory.LAYOUT,
    icon: schema.icon,
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      // Ships with padding and a visible outline: an empty, zero-height
      // div is dropped onto the canvas and appears to have done nothing.
      props: {
        component: 'div',
        sx: {
          p: 2,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
        },
      },
    },
  },
]

export default BoxElement
