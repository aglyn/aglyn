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
import { mdiFormatColorHighlight, mdiFormatColorText } from '@aglyn/shared-data-mdi'
import MuiBox from '@mui/material/Box'
import type { SxProps } from '@mui/material/styles'
import { forwardRef, type ReactNode } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { FIELD_TEXT_CONTENT } from '../constants/field-presets'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'muiInlineText'

/**
 * Inline elements the run may render as. An allow-list rather than a
 * free-text field, for the same reason Box's is (AGL-1201): `element` is
 * persisted and rendered verbatim into every visitor's page, so a typed
 * value would let an author put `script`/`iframe` there.
 *
 * All five are phrasing content, so a run is always legal inside a
 * paragraph — which is the whole point of the element.
 */
export const INLINE_TEXT_ELEMENTS = [
  'span',
  'strong',
  'em',
  'mark',
  'small',
] as const
export type InlineTextElement = (typeof INLINE_TEXT_ELEMENTS)[number]

/**
 * Theme palette paths, never raw hexes: the design's `text/muted` and
 * `text/primary` tokens ARE `text.secondary` / `text.primary`, and a
 * hardcoded `#757575` would ignore the site's theme (and dark mode).
 *
 * Every value is a real sentinel — an option value of `''` is stripped
 * before save and the pick silently reverts on reload (AGL-1191), so
 * "inherit" has to be spelled out rather than left blank.
 */
const TONE_COLOR: Record<string, string> = {
  inherit: undefined,
  primary: 'text.primary',
  secondary: 'text.secondary',
  disabled: 'text.disabled',
  accent: 'primary.main',
  accentAlt: 'secondary.main',
  success: 'success.main',
  warning: 'warning.main',
  error: 'error.main',
}

/** Named weights so the field is a pick, not a number to remember. */
const FONT_WEIGHT: Record<string, number> = {
  inherit: undefined,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
}

/**
 * `text-decoration` PROPAGATES — it is not inherited. An ancestor's
 * underline (a Screen Link, a struck-through block) is painted straight
 * across every in-flow inline descendant, and `text-decoration: none` on
 * the descendant CANNOT remove it. Only an element that is not an in-flow
 * non-atomic inline box escapes the propagation, which is why "None" also
 * switches the run to `inline-block`: an atomic inline box is not painted
 * through.
 *
 * That costs line-breaking — an inline-block will not break across lines —
 * so it is opt-in rather than the default, and the field says so. The
 * default, `inherit`, is a plain `display: inline` run that flows and wraps
 * with the rest of the sentence.
 */
const DECORATION_SX: Record<string, Record<string, string>> = {
  inherit: {},
  none: { display: 'inline-block', textDecoration: 'none' },
  underline: { textDecoration: 'underline' },
  lineThrough: { textDecoration: 'line-through' },
}

export interface InlineTextProps {
  /** The DOM element rendered; defaults to `span`. */
  element?: InlineTextElement
  /** Palette token key from {@link TONE_COLOR}. */
  tone?: string
  /** Named weight key from {@link FONT_WEIGHT}. */
  weight?: string
  /** Decoration behaviour key from {@link DECORATION_SX}. */
  decoration?: string
  /**
   * Authored node styles, handed over by the renderer rather than typed
   * into an attribute. Declared because the merge below reads it —
   * undeclared, no typed caller could style a run (AGL-1323).
   */
  sx?: SxProps
  /** The text of this run; edited inline on the canvas. */
  children?: ReactNode
}

/**
 * One run of text inside a sentence (AGL-1235).
 *
 * The gap this fills: `muiTypography` is `textEditable`, therefore a leaf —
 * `nodeAcceptsChildren` reports false, so no span can be nested inside it.
 * A statement whose argument lives in an emphasised phrase ("Aglyn commerce
 * is **part of the platform**") could not be authored at all; the whole line
 * was one flat colour.
 *
 * This is a leaf too, deliberately: the shape that renders correctly is a
 * block container holding SIBLING inline runs, not a nested span. Sibling
 * runs flow and wrap as a single paragraph, so the sentence breaks
 * naturally with the emphasis landing in the right place. Drop a Box as
 * `p`, then one of these per style change.
 */
const InlineText = forwardRef<HTMLElement, InlineTextProps>((props, ref) => {
  const { element, tone, weight, decoration, children, sx, ...rest } = props
  const component = INLINE_TEXT_ELEMENTS.includes(element as InlineTextElement)
    ? (element as InlineTextElement)
    : 'span'
  // Node styles ride the renderer-merged sx; recompose rather than spread
  // (the stack.ts/link-box.tsx pattern). Writing an `sx` literal after the
  // props spread would REPLACE the author's styles silently — the defect
  // class `aglyn/no-sx-after-spread` guards (AGL-1240/1284).
  const nodeSx = Array.isArray(sx) ? sx : sx ? [sx] : []
  // A cleared attribute persists as null, so every lookup below must miss
  // rather than throw; `Record[null]` is simply undefined.
  const color = TONE_COLOR[tone]
  const fontWeight = FONT_WEIGHT[weight]
  return (
    <MuiBox
      ref={ref}
      component={component}
      {...rest}
      // Order matters: the baseline first, then the declared attributes,
      // then the author's node styles last so the Styles panel always wins.
      sx={[
        { display: 'inline' },
        color ? { color } : {},
        fontWeight ? { fontWeight } : {},
        DECORATION_SX[decoration] ?? {},
        ...nodeSx,
      ]}
    >
      {children}
    </MuiBox>
  )
})
InlineText.displayName = 'AglynInlineText'

export const schema: Aglyn.ComponentSchema<InlineTextProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Inline Text',
  description:
    'One run of text inside a sentence — put several side by side in a ' +
    'paragraph to emphasise a phrase without breaking the line.',
  category: Aglyn.ComponentCategory.TEXT,
  icon: { path: mdiFormatColorText.path, sx: { color: '#057822' } },
  flags: {
    // The run IS its text: edited inline on the canvas, like Typography.
    textEditable: Aglyn.FEATURE_FLAG.ENABLED,
  },
  attributes: [
    FIELD_TEXT_CONTENT,
    {
      name: 'element',
      label: 'HTML element',
      description:
        'The DOM element this run renders as. `strong` and `em` carry ' +
        'meaning for screen readers and search engines; `mark` marks a ' +
        'highlighted phrase; `span` is purely visual.',
      component: Aglyn.FieldComponentType.SELECT,
      options: INLINE_TEXT_ELEMENTS.map((value) => ({ value, label: value })),
    },
    {
      name: 'tone',
      label: 'Colour',
      description:
        "Palette token for this run. Two-tone text is a muted sentence " +
        'with one run set to Primary (or Accent) — theme tokens, so it ' +
        'still reads correctly in dark mode.',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { value: 'inherit', label: 'Inherit' },
        { value: 'primary', label: 'Text primary' },
        { value: 'secondary', label: 'Text muted' },
        { value: 'disabled', label: 'Text disabled' },
        { value: 'accent', label: 'Accent' },
        { value: 'accentAlt', label: 'Accent alternate' },
        { value: 'success', label: 'Success' },
        { value: 'warning', label: 'Warning' },
        { value: 'error', label: 'Error' },
      ],
    },
    {
      name: 'weight',
      label: 'Weight',
      description: 'Font weight for this run only.',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { value: 'inherit', label: 'Inherit' },
        { value: 'regular', label: 'Regular' },
        { value: 'medium', label: 'Medium' },
        { value: 'semibold', label: 'Semi bold' },
        { value: 'bold', label: 'Bold' },
      ],
    },
    {
      name: 'decoration',
      label: 'Underline / strike',
      description:
        'Inherit follows the surrounding text, including a link\'s ' +
        'underline — an underline PROPAGATES down and cannot be switched ' +
        'off from inside. None does switch it off, at the cost of the run ' +
        'no longer breaking across lines, so keep it to a short phrase.',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { value: 'inherit', label: 'Inherit' },
        { value: 'none', label: 'None (does not wrap)' },
        { value: 'underline', label: 'Underline' },
        { value: 'lineThrough', label: 'Strikethrough' },
      ],
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Inline Text',
    pluginId: BUNDLE_ID,
    description: 'One run of text inside a sentence',
    category: Aglyn.ComponentCategory.TEXT,
    icon: schema.icon,
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: { element: 'span', children: 'Inline text' },
    },
  },
  {
    $id: generatePresetId(ID, 'emphasis'),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Emphasised Text',
    pluginId: BUNDLE_ID,
    description: 'A phrase picked out of a muted sentence',
    category: Aglyn.ComponentCategory.TEXT,
    icon: { path: mdiFormatColorHighlight.path, sx: { color: '#057822' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {
        element: 'strong',
        tone: 'primary',
        weight: 'bold',
        children: 'the emphasised phrase',
      },
    },
  },
  {
    // The whole shape in one drop (AGL-1235): the reason the emphasis was
    // never authored is that assembling it by hand meant a container, three
    // runs and a colour on each. This is that assembly, ready to retype.
    $id: generatePresetId(ID, 'statement'),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Two-tone Statement',
    pluginId: BUNDLE_ID,
    description: 'A muted sentence with one phrase emphasised',
    category: Aglyn.ComponentCategory.TEXT,
    icon: { path: mdiFormatColorHighlight.path, sx: { color: '#057822' } },
    data: {
      $id: null,
      // A real `<p>`, not a div: the runs are phrasing content, so the
      // paragraph is the honest container and screen readers get a
      // sentence rather than three unrelated fragments.
      componentId: 'muiBox',
      pluginId: BUNDLE_ID,
      props: { component: 'p' },
      // Node-level sx (AGL-1346) — the record the Styles panel edits.
      sx: { m: 0 },
      nodes: [
        {
          $id: null,
          componentId: ID,
          pluginId: BUNDLE_ID,
          props: {
            element: 'span',
            tone: 'secondary',
            children: 'Everything you build is ',
          },
        },
        {
          $id: null,
          componentId: ID,
          pluginId: BUNDLE_ID,
          props: {
            element: 'strong',
            tone: 'primary',
            weight: 'bold',
            children: 'part of the platform',
          },
        },
        {
          $id: null,
          componentId: ID,
          pluginId: BUNDLE_ID,
          props: {
            element: 'span',
            tone: 'secondary',
            children: ', not bolted onto it.',
          },
        },
      ],
    },
  },
]

export default InlineText
