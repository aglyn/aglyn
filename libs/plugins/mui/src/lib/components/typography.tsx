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
import {
  mdiAlphabetical,
  mdiFormatHeader1,
  mdiFormatHeader2,
  mdiFormatHeader3,
  mdiFormatHeader4,
  mdiFormatHeader5,
  mdiFormatHeader6,
  mdiFormatText,
} from '@aglyn/shared-data-mdi'
import Typography, { type TypographyProps } from '@mui/material/Typography'
import DOMPurify from 'dompurify'
import { forwardRef, useMemo } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { FIELD_TEXT_CONTENT } from '../constants/field-presets'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; keep the legacy ids.
export const ID: Aglyn.ComponentId = 'muiTypography'
const typographyVariants = [
  { value: 'h1', label: 'Heading 1', icon: { path: mdiFormatHeader1.path } },
  { value: 'h2', label: 'Heading 2', icon: { path: mdiFormatHeader2.path } },
  { value: 'h3', label: 'Heading 3', icon: { path: mdiFormatHeader3.path } },
  { value: 'h4', label: 'Heading 4', icon: { path: mdiFormatHeader4.path } },
  { value: 'h5', label: 'Heading 5', icon: { path: mdiFormatHeader5.path } },
  { value: 'h6', label: 'Heading 6', icon: { path: mdiFormatHeader6.path } },
  {
    value: 'subtitle1',
    label: 'Subtitle 1',
    icon: { path: mdiFormatText.path },
  },
  {
    value: 'subtitle2',
    label: 'Subtitle 2',
    icon: { path: mdiFormatText.path },
  },
  { value: 'body1', label: 'Body 1', icon: { path: mdiFormatText.path } },
  { value: 'body2', label: 'Body 2', icon: { path: mdiFormatText.path } },
  { value: 'overline', label: 'Overline', icon: { path: mdiFormatText.path } },
  { value: 'caption', label: 'Caption', icon: { path: mdiFormatText.path } },
]

export const schema: Aglyn.ComponentSchema = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Typography',
  category: Aglyn.ComponentCategory.TEXT,
  icon: {
    path: mdiAlphabetical.path,
    sx: { color: '#057822' },
  },
  flags: {
    textEditable: Aglyn.FEATURE_FLAG.ENABLED,
    richTextEditable: Aglyn.FEATURE_FLAG.ENABLED,
  },
  attributes: [
    FIELD_TEXT_CONTENT,
    // FIELD_COLOR,
    {
      name: 'variant',
      description: 'The variant to use.',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Variant',
      options: [{ value: '', label: 'Default' }, ...typographyVariants],
    },
    {
      name: 'component',
      description: 'The html element to use.',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Component',
      options: [
        { value: '', label: 'Default' },
        { value: 'h1', label: 'Heading 1' },
        { value: 'h2', label: 'Heading 2' },
        { value: 'h3', label: 'Heading 3' },
        { value: 'h4', label: 'Heading 4' },
        { value: 'h5', label: 'Heading 5' },
        { value: 'h6', label: 'Heading 6' },
        { value: 'p', label: 'Paragraph' },
        { value: 'div', label: 'Div' },
        { value: 'span', label: 'Span' },
      ],
    },
    {
      name: 'align',
      description: 'The text alignment',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Alignment',
      options: [
        { value: '', label: 'Default' },
        { value: 'inherit', label: 'Inherit' },
        { value: 'left', label: 'Left' },
        { value: 'center', label: 'Center' },
        { value: 'right', label: 'Right' },
        { value: 'justify', label: 'Justified' },
      ],
    },
    {
      name: 'noWrap',
      description: 'If true, the text will not wrap/fold.',
      component: Aglyn.FieldComponentType.SWITCH,
      label: 'Disable wrapping?',
    },
    {
      name: 'gutterBottom',
      description: 'If true, the text will have a space beneath.',
      component: Aglyn.FieldComponentType.SWITCH,
      label: 'Gutter bottom?',
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  ...typographyVariants.map((item): Aglyn.PresetSchema => ({
    $id: generatePresetId(ID, item.value),
    type: Aglyn.NodeType.PRESET,
    displayName: item.label,
    pluginId: BUNDLE_ID,
    description: `Element with ${item.label} styles`,
    category: Aglyn.ComponentCategory.TEXT,
    icon: {
      sx: { color: '#057822' },
      ...item.icon,
    },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {
        variant: item.value,
        children: item.label,
      },
    },
  })),
]

/**
 * Typography that renders rich text (AGL-54): when the node carries an
 * `html` prop it renders as innerHTML; otherwise plain `children`.
 *
 * The `html` prop is re-sanitized on EVERY render (AGL-497). The inline
 * editor sanitizes at commit, but screen node props are written directly via
 * the Firebase client SDK, so a host editor can plant arbitrary `html`
 * (bypassing the editor) that would execute on the public site AND in the
 * besigner canvas on console.aglyn.io. DOMPurify is DOM-based, so it paints
 * on hydrate (SSR yields empty), matching custom-html.
 */
function sanitizeTypographyHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'base', 'style'],
    FORBID_ATTR: ['srcdoc', 'formaction'],
    ALLOW_DATA_ATTR: false,
  })
}

const AglynTypography = forwardRef<
  HTMLElement,
  TypographyProps & { html?: string }
>(function AglynTypography(props, ref) {
  const { html, children, ...rest } = props
  const sanitized = useMemo(() => {
    if (typeof html !== 'string' || !html) return null
    if (typeof window === 'undefined') return '' // SSR paints on hydrate.
    return sanitizeTypographyHtml(html)
  }, [html])
  if (sanitized !== null) {
    return (
      <Typography
        ref={ref}
        {...rest}
        dangerouslySetInnerHTML={{ __html: sanitized }}
      />
    )
  }
  return (
    <Typography ref={ref} {...rest}>
      {children}
    </Typography>
  )
})

export default AglynTypography
