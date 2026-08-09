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
import { mdiChevronDown, mdiUnfoldMoreHorizontal } from '@aglyn/shared-data-mdi'
import { AppLink, MdiIcon } from '@aglyn/shared-ui-jsx'
import MuiAccordion from '@mui/material/Accordion'
import MuiAccordionDetails from '@mui/material/AccordionDetails'
import MuiAccordionSummary from '@mui/material/AccordionSummary'
import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import type { SxProps } from '@mui/material/styles'
import { forwardRef, type ReactNode } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { FIELD_TEXT_CONTENT } from '../constants/field-presets'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ACCORDION_ID: Aglyn.ComponentId = 'muiAccordion'
export const ACCORDION_SUMMARY_ID: Aglyn.ComponentId = 'muiAccordionSummary'
export const ACCORDION_DETAILS_ID: Aglyn.ComponentId = 'muiAccordionDetails'

export interface AccordionElementProps {
  /** Starts open on the published site. */
  defaultExpanded?: boolean
  disabled?: boolean
  /** Removes the extra margin an expanded accordion normally gains. */
  disableGutters?: boolean
  children?: ReactNode
}

/**
 * Expand/collapse panel (https://mui.com/material-ui/react-accordion/).
 *
 * On the besigner canvas it renders **expanded regardless of
 * `defaultExpanded`**: collapsed details are unreachable for selection
 * and styling, which is the same reason the Drawer expands its contents
 * while selected (AGL-571). Preview and the published site both honour
 * the author's setting and toggle normally, so what ships is never in
 * doubt — only the editing surface differs.
 */
const AccordionElement = forwardRef<HTMLDivElement, AccordionElementProps>(
  (props, ref) => {
    const { defaultExpanded, children, ...rest } = props
    const { editorInert } = Aglyn.useScreenLink(undefined)
    if (editorInert) {
      // Controlled-open with no onChange: the canvas is a static surface,
      // clicks there select rather than toggle.
      // MUI types Accordion's children as NonNullable: an accordion with
      // no summary/details is not a renderable shape, and the renderer
      // always supplies the pair.
      return (
        <MuiAccordion
          ref={ref}
          expanded
          {...rest}
          children={children as NonNullable<ReactNode>}
        />
      )
    }
    return (
      <MuiAccordion
        ref={ref}
        defaultExpanded={!!defaultExpanded}
        {...rest}
        children={children as NonNullable<ReactNode>}
      />
    )
  },
)
AccordionElement.displayName = 'AglynAccordion'

export interface AccordionSummaryElementProps {
  /**
   * Optional screen the header's label links to (AGL-1232). Setting it
   * SPLITS the row — see {@link AccordionSummaryElement}. A screen id, never
   * a path: the href is resolved from the host routing map at render time,
   * so a slug rename or re-parent cannot break it, and a bare `href` would
   * full-reload the site instead of routing.
   */
  screenId?: string
  /**
   * Authored node styles, handed over by the renderer rather than typed
   * into an attribute — recomposed below so the Styles panel's values are
   * merged rather than replaced (AGL-1240/1284).
   */
  sx?: SxProps
  children?: ReactNode
}

/** Label and chevron sit on one line; the label takes the slack. */
const SUMMARY_ROW_SX = {
  display: 'flex',
  alignItems: 'center',
  width: '100%',
} as const

/** Matches MuiAccordionSummary's own gutters so the split row lines up. */
const SUMMARY_LABEL_SX = {
  flex: 1,
  minWidth: 0,
  px: 2,
  py: 1.5,
} as const

/**
 * The toggle keeps only its chevron: the label is a sibling now, so the
 * summary's own content slot would just add empty width.
 */
const SUMMARY_TOGGLE_SX = {
  flex: '0 0 auto',
  '& .MuiAccordionSummary-content': { display: 'none' },
} as const

/**
 * The always-visible header row. Supplies the expand chevron MUI leaves
 * to the caller — without it the control looks like inert text and gives
 * no hint that there is anything to open.
 *
 * ## Why a linked header is a different shape (AGL-1232)
 *
 * `MuiAccordionSummary` renders a `<button>`, and the mobile drawer needs
 * Product/Solutions to reach their jump pages as well as open. An anchor
 * inside that button is invalid nesting — browsers unnest it, and nested
 * interactive content is unusable with a screen reader or a keyboard — so
 * the row cannot both toggle and navigate while it is one control.
 *
 * With a `screenId` set the row therefore splits in two: the label becomes
 * a real anchor, and a chevron-only `MuiAccordionSummary` beside it becomes
 * the toggle. Two siblings, each independently focusable, no nesting. The
 * summary keeps driving the panel through MUI's accordion context, so
 * `aria-expanded` and the transition are unchanged.
 *
 * With no `screenId` — every accordion authored before this — the output is
 * byte-for-byte what it always was: one `MuiAccordionSummary`, whole row
 * toggles.
 */
export const AccordionSummaryElement = forwardRef<
  HTMLDivElement,
  AccordionSummaryElementProps
>((props, ref) => {
  const { screenId, ...rest } = props
  // Resolution is the routing map's job, exactly as Screen Link does it;
  // an unpublished or deleted target yields no href.
  const { href, suppressNavigation } = Aglyn.useScreenLink(screenId)

  if (!screenId) {
    return (
      <MuiAccordionSummary
        ref={ref}
        expandIcon={<MdiIcon path={mdiChevronDown.path} />}
        {...rest}
      />
    )
  }

  const { children, sx, ...rowRest } = rest
  const nodeSx = Array.isArray(sx) ? sx : sx ? [sx] : []
  // The chevron button's only content is an icon, so it needs a name of its
  // own — "Product" the link and "Product" the toggle are two controls.
  const label = typeof children === 'string' ? children.trim() : ''
  return (
    <Box ref={ref} {...rowRest} sx={[SUMMARY_ROW_SX, ...nodeSx]}>
      {href && !suppressNavigation ? (
        <AppLink href={href} underline="hover" sx={SUMMARY_LABEL_SX}>
          {children}
        </AppLink>
      ) : (
        // Unresolved target, or a surface that must not navigate (canvas,
        // preview): same two-part shape, so the editor never shows a row
        // that behaves differently from the one that ships.
        <Link
          component="span"
          underline="none"
          color="inherit"
          sx={SUMMARY_LABEL_SX}
        >
          {children}
        </Link>
      )}
      <MuiAccordionSummary
        aria-label={label ? `Toggle ${label}` : 'Toggle section'}
        expandIcon={<MdiIcon path={mdiChevronDown.path} />}
        sx={SUMMARY_TOGGLE_SX}
      />
    </Box>
  )
})
AccordionSummaryElement.displayName = 'AglynAccordionSummary'

export const AccordionDetailsElement = forwardRef<
  HTMLDivElement,
  { children?: ReactNode }
>((props, ref) => <MuiAccordionDetails ref={ref} {...props} />)
AccordionDetailsElement.displayName = 'AglynAccordionDetails'

export const accordionSchema: Aglyn.ComponentSchema<AccordionElementProps> = {
  $id: ACCORDION_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Accordion',
  description:
    'Header that expands to reveal its details — FAQs, long forms, ' +
    'anything progressive.',
  category: Aglyn.ComponentCategory.SURFACE,
  icon: { path: mdiUnfoldMoreHorizontal.path, sx: { color: '#2196f3' } },
  // Structure is fixed by MUI: summary first, details second.
  restrictChildren: [
    Aglyn.LinealDirectiveFlag.LIMIT_TO,
    { components: [ACCORDION_SUMMARY_ID, ACCORDION_DETAILS_ID] },
  ],
  // …and it reads that structure BY INDEX, so the renderer has to hand it one
  // React child per node child (AGL-1237). Without this the summary swallowed
  // the details and every accordion on every published site expanded to reveal
  // an empty panel, with its content rendering unconditionally inside the
  // summary's heading.
  flags: { positionalChildren: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'defaultExpanded',
      label: 'Start expanded?',
      description:
        'If true, the panel is already open when a visitor arrives. The ' +
        'canvas always shows it open so you can edit inside it.',
      component: Aglyn.FieldComponentType.SWITCH,
    },
    {
      name: 'disableGutters',
      label: 'Disable gutters?',
      description:
        'If true, the panel keeps its height when expanded instead of ' +
        'gaining extra margin — the tighter look for a stacked FAQ.',
      component: Aglyn.FieldComponentType.SWITCH,
    },
    {
      name: 'disabled',
      label: 'Disabled?',
      description: 'If true, visitors cannot expand the panel.',
      component: Aglyn.FieldComponentType.SWITCH,
    },
  ],
}

export const accordionSummarySchema: Aglyn.ComponentSchema = {
  $id: ACCORDION_SUMMARY_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Accordion Summary',
  description: 'The clickable header row of an accordion.',
  category: Aglyn.ComponentCategory.SURFACE,
  icon: { path: mdiUnfoldMoreHorizontal.path, sx: { color: '#2196f3' } },
  flags: { textEditable: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    FIELD_TEXT_CONTENT,
    {
      name: 'screenId',
      label: 'Header links to',
      description:
        'Optional. Give the header a destination and the row splits: the ' +
        'text becomes a link to that screen and the chevron beside it ' +
        'opens the panel. That is the only way a header can do both — a ' +
        'link inside the toggle button is invalid and unreachable by ' +
        'keyboard. Leave it empty and the whole row toggles, as before.',
      component: Aglyn.FieldComponentType.SCREEN_SELECT,
    },
  ],
}

export const accordionDetailsSchema: Aglyn.ComponentSchema = {
  $id: ACCORDION_DETAILS_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Accordion Details',
  description: 'The region an accordion reveals when expanded.',
  category: Aglyn.ComponentCategory.SURFACE,
  icon: { path: mdiUnfoldMoreHorizontal.path, sx: { color: '#2196f3' } },
}

const panel = (summary: string, body: string) => ({
  $id: null,
  componentId: ACCORDION_ID,
  pluginId: BUNDLE_ID,
  props: {},
  nodes: [
    {
      $id: null,
      componentId: ACCORDION_SUMMARY_ID,
      pluginId: BUNDLE_ID,
      props: { children: summary },
    },
    {
      $id: null,
      componentId: ACCORDION_DETAILS_ID,
      pluginId: BUNDLE_ID,
      nodes: [
        {
          $id: null,
          componentId: 'muiTypography',
          pluginId: BUNDLE_ID,
          props: { variant: 'body2', children: body },
        },
      ],
    },
  ],
})

export const accordionPresets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ACCORDION_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Accordion',
    pluginId: BUNDLE_ID,
    description: 'One expandable panel with a header and body text',
    category: Aglyn.ComponentCategory.SURFACE,
    icon: accordionSchema.icon,
    data: panel('Accordion header', 'The details revealed when expanded.'),
  },
  {
    $id: generatePresetId(ACCORDION_ID, 'faq'),
    type: Aglyn.NodeType.PRESET,
    displayName: 'FAQ',
    pluginId: BUNDLE_ID,
    description: 'Three stacked question panels, ready to edit',
    category: Aglyn.ComponentCategory.SURFACE,
    icon: { path: mdiUnfoldMoreHorizontal.path, sx: { color: '#1976d2' } },
    data: {
      $id: null,
      componentId: 'muiStack',
      pluginId: BUNDLE_ID,
      props: { direction: 'column' },
      nodes: [
        panel('How do I get started?', 'Answer the first question here.'),
        panel('What does it cost?', 'Answer the second question here.'),
        panel('How do I get support?', 'Answer the third question here.'),
      ],
    },
  },
]

export default AccordionElement
