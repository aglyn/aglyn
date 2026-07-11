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
import { mdiPageLayoutBody } from '@aglyn/shared-data-mdi'
import Box from '@mui/material/Box'
import { forwardRef } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'section'

/** W3C sectioning/grouping elements the component may render as (AGL-336). */
export const SECTION_ELEMENTS = [
  'section',
  'div',
  'article',
  'aside',
  'nav',
  'header',
  'footer',
  'main',
] as const
export type SectionElement = (typeof SECTION_ELEMENTS)[number]

export interface SectionProps {
  /** The DOM element rendered; defaults to `section`. */
  element?: SectionElement
  /** Accessible name announced for landmark elements. */
  ariaLabel?: string
  children?: JSX.Children
}

/**
 * Semantic grouping container (AGL-336): renders children inside the
 * chosen W3C element so pages keep meaningful document structure
 * (landmarks for assistive tech, better SEO outlines) instead of
 * div-soup. Behaves like any container: droppable, stylable via sx,
 * classes, and interactions.
 */
const Section = forwardRef<HTMLElement, SectionProps>((props, ref) => {
  const { element, ariaLabel, children, ...rest } = props
  const component = SECTION_ELEMENTS.includes(element as SectionElement)
    ? (element as SectionElement)
    : 'section'
  return (
    <Box
      ref={ref}
      component={component}
      aria-label={ariaLabel || undefined}
      {...rest}
    >
      {children}
    </Box>
  )
})
Section.displayName = 'AglynSection'

export const schema: Aglyn.ComponentSchema<SectionProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Section',
  description:
    'Groups components inside a semantic HTML element (section, article, nav, …).',
  category: Aglyn.ComponentCategory.LAYOUT,
  icon: { path: mdiPageLayoutBody.path, sx: { color: '#2196f3' } },
  attributes: [
    {
      name: 'element',
      label: 'HTML element',
      description:
        'The DOM element this section renders as, per W3C semantics. ' +
        'Use section/article/aside/nav/header/footer/main for meaningful ' +
        'structure; div for purely visual grouping.',
      component: Aglyn.FieldComponentType.SELECT,
      options: SECTION_ELEMENTS.map((value) => ({ value, label: value })),
    },
    {
      name: 'ariaLabel',
      label: 'Accessible label',
      description:
        'Names the landmark for screen readers (recommended when a page ' +
        'has several of the same element).',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Section',
    pluginId: BUNDLE_ID,
    description: 'Semantic grouping container (section/div/article/…)',
    category: Aglyn.ComponentCategory.LAYOUT,
    icon: { path: mdiPageLayoutBody.path, sx: { color: '#2196f3' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: { element: 'section' },
    },
  },
]

export default Section
