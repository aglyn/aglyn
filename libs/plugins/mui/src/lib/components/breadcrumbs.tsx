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
import { mdiSlashForward } from '@aglyn/shared-data-mdi'
import MuiBreadcrumbs from '@mui/material/Breadcrumbs'
import { forwardRef, type ReactNode } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'muiBreadcrumbs'

export interface BreadcrumbsElementProps {
  /** Text drawn between crumbs; defaults to `/`. */
  separator?: string
  /** Collapse into an ellipsis above this many crumbs. */
  maxItems?: number | string
  itemsBeforeCollapse?: number | string
  itemsAfterCollapse?: number | string
  /** Accessible name of the ellipsis button. */
  expandText?: string
  /** Accessible name of the navigation landmark. */
  ariaLabel?: string
  children?: ReactNode
}

function toCount(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) return undefined
  return Math.round(parsed)
}

/**
 * Breadcrumb trail (https://mui.com/material-ui/react-breadcrumbs/).
 *
 * MUI renders a `nav` and inserts the separators between whatever
 * children it is given, so the crumbs themselves are ordinary Screen
 * Links — the trail stays rename-safe for free, and the last crumb can
 * be plain Typography for the current page.
 */
const BreadcrumbsElement = forwardRef<
  HTMLElement,
  BreadcrumbsElementProps
>((props, ref) => {
  const {
    separator,
    maxItems,
    itemsBeforeCollapse,
    itemsAfterCollapse,
    expandText,
    ariaLabel,
    children,
    ...rest
  } = props
  return (
    <MuiBreadcrumbs
      ref={ref}
      // A blank separator would collapse the trail into run-on text.
      separator={separator || '/'}
      maxItems={toCount(maxItems)}
      itemsBeforeCollapse={toCount(itemsBeforeCollapse)}
      itemsAfterCollapse={toCount(itemsAfterCollapse)}
      expandText={expandText || undefined}
      aria-label={ariaLabel || 'Breadcrumb'}
      {...rest}
    >
      {children}
    </MuiBreadcrumbs>
  )
})
BreadcrumbsElement.displayName = 'AglynBreadcrumbs'

/** The collapse tuning only matters once a max is set. */
const COLLAPSING = { when: 'maxItems', isNotEmpty: true }

export const schema: Aglyn.ComponentSchema<BreadcrumbsElementProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Breadcrumbs',
  description:
    'Trail showing where a page sits. Fill it with Screen Links so it ' +
    'survives slug changes.',
  category: Aglyn.ComponentCategory.NAVIGATION,
  icon: { path: mdiSlashForward.path, sx: { color: '#2196f3' } },
  attributes: [
    {
      name: 'separator',
      label: 'Separator',
      description: 'Text drawn between crumbs, e.g. / or ›. Default /.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'maxItems',
      label: 'Collapse above',
      description:
        'Collapse the middle of the trail into an ellipsis once there ' +
        'are more crumbs than this. Blank never collapses.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      type: 'number',
    },
    {
      name: 'itemsBeforeCollapse',
      label: 'Keep at start',
      description: 'Crumbs kept before the ellipsis. Default 1.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      type: 'number',
      condition: COLLAPSING,
    },
    {
      name: 'itemsAfterCollapse',
      label: 'Keep at end',
      description: 'Crumbs kept after the ellipsis. Default 1.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      type: 'number',
      condition: COLLAPSING,
    },
    {
      name: 'expandText',
      label: 'Expand button label',
      description:
        'Accessible name of the ellipsis button. Default "Show path".',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      condition: COLLAPSING,
    },
    {
      name: 'ariaLabel',
      label: 'Accessible label',
      description:
        'Names the navigation landmark for screen readers. Default ' +
        '"Breadcrumb".',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
  ],
}

const crumb = (label: string) => ({
  $id: null,
  componentId: 'muiScreenLink',
  pluginId: BUNDLE_ID,
  // Text links, not buttons: a breadcrumb rendered as a button gets
  // button typography and the wrong role for assistive tech (AGL-1195).
  props: { children: label, renderAs: 'link', color: 'inherit' },
})

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Breadcrumbs',
    pluginId: BUNDLE_ID,
    description: 'Two links and the current page',
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: schema.icon,
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {},
      nodes: [
        crumb('Home'),
        crumb('Section'),
        {
          // The current page is not a link — linking a page to itself is
          // the classic breadcrumb accessibility mistake.
          $id: null,
          componentId: 'muiTypography',
          pluginId: BUNDLE_ID,
          props: {
            variant: 'body2',
            color: 'text.primary',
            children: 'Current page',
          },
        },
      ],
    },
  },
]

export default BreadcrumbsElement
