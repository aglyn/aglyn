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
  mdiFormatParagraph,
  mdiFormatText,
} from '@aglyn/shared-ui-jsx'
import Typography from '@mui/material/Typography'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

const ID: Aglyn.ComponentId = 'typography'
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
  {
    value: 'paragraph',
    label: 'Paragraph',
    icon: { path: mdiFormatParagraph.path },
  },
]

export const schema: Aglyn.ComponentSchema = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Typography',
  icon: {
    path: mdiAlphabetical.path,
    sx: { color: '#057822' },
  },
  attributes: [
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
        { value: 'paragraph', label: 'Paragraph' },
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
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Typography',
    icon: {
      path: mdiAlphabetical.path,
      sx: { color: '#057822' },
    },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {
        variant: 'outlined',
        children: 'Typographical text element',
      },
    },
  },
  ...typographyVariants.map((item) => ({
    $id: generatePresetId(ID, item.value),
    type: Aglyn.NodeType.PRESET,
    displayName: item.label,
    icon: {
      sx: { color: '#057822' },
      ...item.icon,
    },
    category: Aglyn.ComponentCategory.DATA_DISPLAY,
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

export default Typography
