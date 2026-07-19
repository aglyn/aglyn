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
import { BoxStyler, Measurements } from '../box-styler'
import {
  ButtonGroupFormControl,
  ToggleButtonFormControl,
} from '../form-fields'
import { FieldComponentType } from '@aglyn/aglyn'
import { useAglynSiteTheme } from '@aglyn/aglyn-node-renderer'
import {
  ICON_VARIANT_ALIGN_CENTER,
  ICON_VARIANT_ALIGN_JUSTIFY,
  ICON_VARIANT_ALIGN_LEFT,
  ICON_VARIANT_ALIGN_RIGHT,
  ICON_VARIANT_CSS_INHERIT,
} from '@aglyn/shared-data-enums'
import {
  alignContentCenterIcon,
  alignContentEndIcon,
  alignContentSpaceAroundIcon,
  alignContentSpaceBetweenIcon,
  alignContentSpaceEvenlyIcon,
  alignContentStartIcon,
  alignContentStretchIcon,
  alignItemsCenterIcon,
  alignItemsFlexEndIcon,
  alignItemsFlexStartIcon,
  alignItemsStretchIcon,
  alignSelfCenterIcon,
  alignSelfFlexEndIcon,
  alignSelfFlexStartIcon,
  alignSelfStretchIcon,
  flexDirectionIcon,
  flexNowrapIcon,
  flexWrapIcon,
  justifyContentCenterIcon,
  justifyContentFlexEndIcon,
  justifyContentFlexStartIcon,
  justifyContentSpaceAroundIcon,
  justifyContentSpaceBetweenIcon,
} from '@aglyn/shared-svg-icons'
import {
  componentMapper,
  FormRenderer,
  type FormRendererProps,
} from '@aglyn/shared-ui-jsx-forms'
import { Container, MdiIcon } from '@aglyn/shared-ui-jsx'
import { objectFlatten } from '@aglyn/shared-util-vendor'
import {
  Chip,
  FormHelperText,
  FormLabel,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from '@mui/material'
import Button from '@mui/material/Button'
import FormControl from '@mui/material/FormControl'
import { action } from 'mobx'
import { observer } from 'mobx-react-lite'
import { forwardRef, type SyntheticEvent, useCallback, useMemo } from 'react'
import useAglynBesignerFlag from '../hooks/use-aglyn-besigner-flag'
import useDeleteElementCallback from '../hooks/use-delete-element-callback'
import {
  deviceFlagToBreakpoint,
  readSxValue,
  writeSxValue,
} from '../utils/responsive-sx'
import {
  buildStyleFieldGroups,
  computeStylePartial,
  pickStyleValues,
  styleGroupFieldNames,
} from '../utils/style-field-groups'
import { Accordion } from './accordion-list.component'
import CustomCssForm from './custom-css-form.component'
import ElementClassesField from './element-classes-field.component'
import { ElementPropsFormTemplate } from './element-props-form.component'

const stylesSchema = (presetColors: string[]) => ({
  fields: [
    {
      component: FieldComponentType.SELECT,
      name: 'display',
      label: 'Display Variant',
      description:
        'The display property specifies the display behavior (the type of rendering box) of an element.',
      options: [
        { value: '', label: 'Default' },
        { value: 'block', label: 'Block' },
        { value: 'inline', label: 'Inline' },
        { value: 'content', label: 'Contents' },
        { value: 'list-item', label: 'List Item' },
        { value: 'inline-block', label: 'Inline Block' },
        { value: 'flex', label: 'Flex' },
        { value: 'inline-flex', label: 'Inline Flex' },
        { value: 'grid', label: 'Grid' },
        { value: 'inline-grid', label: 'Inline Grid' },
        { value: 'table', label: 'Table' },
        { value: 'inline-table', label: 'Inline Table' },
        { value: 'table-caption', label: 'Table Caption' },
        { value: 'table-column', label: 'Table Column' },
        { value: 'table-column-group', label: 'Table Column Group' },
        { value: 'table-cell', label: 'Table Cell' },
        { value: 'table-row', label: 'Table Row' },
        { value: 'table-row-group', label: 'Table Row Group' },
        { value: 'table-header-group', label: 'Table Header Group' },
        { value: 'table-footer-group', label: 'Table Footer Group' },
        { value: 'none', label: 'None' },
        { value: 'initial', label: 'Initial' },
        { value: 'unset', label: 'Unset' },
      ],
    },
    {
      component: FieldComponentType.COLOR_PICKER,
      name: 'color',
      label: 'Text Color',
      description: 'The text color of the element',
      presetColors,
      FormFieldGridProps: {
        size: { xs: 12, sm: 6 },
      },
    },
    {
      component: FieldComponentType.COLOR_PICKER,
      name: 'backgroundColor',
      label: 'Background Color',
      description: 'The background color of the element',
      presetColors,
      FormFieldGridProps: {
        size: { xs: 12, sm: 6 },
      },
    },
    {
      component: FieldComponentType.SELECT,
      name: 'float',
      label: 'Float',
      description:
        'The float property is used for positioning and formatting content e.g. let an image float left to the text in a container.',
      options: [
        {
          value: '',
          label: 'Default',
        },
        {
          value: 'inherit',
          label: 'Inherit',
          description: 'The element inherits the float value of its parent',
        },
        {
          value: 'none',
          label: 'None',
          description:
            'The element does not float (will be displayed just where it occurs in the text)',
        },
        {
          value: 'left',
          label: 'Left',
          description: 'The element floats to the left of its container',
        },
        {
          value: 'right',
          label: 'Right',
          description: 'The element floats to the right of its container',
        },
      ],
    },
    {
      component: FieldComponentType.SELECT,
      name: 'flexDirection',
      label: 'Flex Direction',
      description:
        'Sets how flex items are placed in the flex container defining the main axis and the direction (normal or reversed).',
      options: [
        { value: '', label: 'Default' },
        { value: 'unset', label: 'Unset' },
        { value: 'inherit', label: 'Inherit' },
        { value: 'initial', label: 'Initial' },
        { value: 'row', label: 'Row' },
        { value: 'row-reverse', label: 'Row Reverse' },
        { value: 'column', label: 'Column' },
        { value: 'column-reverse', label: 'Column Reverse' },
        { value: 'revert', label: 'Revert' },
        { value: 'revert-layer', label: 'Revert Layer' },
      ],
    },
    {
      component: FieldComponentType.TEXT_FIELD,
      type: 'number',
      name: 'flexGrow',
      label: 'Flex Grow',
      description: "Sets the flex grow factor of a flex item's main size",
    },
    {
      component: FieldComponentType.TEXT_FIELD,
      name: 'gap',
      label: 'Gap',
      description:
        'Sets the gaps (gutters) between rows and columns. It is a shorthand for row-gap and column-gap',
    },
    {
      component: FieldComponentType.TEXT_FIELD,
      name: 'columnGap',
      label: 'Column Gap',
      description:
        "Sets the size of the gap (gutter) between an element's columns",
    },
    {
      component: FieldComponentType.TEXT_FIELD,
      name: 'rowGap',
      label: 'Row Gap',
      description:
        "Sets the size of the gap (gutter) between an element's rows",
    },
    {
      component: FieldComponentType.TEXT_FIELD,
      name: 'flexBasis',
      label: 'Flex Basis',
      description:
        'Sets the initial main size of a flex item. It sets the size of the content box unless otherwise set with box-sizing',
    },
    {
      component: FieldComponentType.SELECT,
      // type: 'number',
      name: 'alignItems',
      label: 'Align Items',
      description:
        'Sets the align-self value on all direct children as a group. In Flexbox, it controls the alignment of items on the Cross Axis. In Grid Layout, it controls the alignment of items on the Block Axis within their grid area',
      options: [
        { value: '', label: 'Default' },
        { value: 'unset', label: 'Unset' },
        { value: 'inherit', label: 'Inherit' },
        { value: 'initial', label: 'Initial' },
        { value: 'normal', label: 'normal' },
        { value: 'stretch', label: 'stretch' },
        { value: 'center', label: 'center' },
        { value: 'start', label: 'start' },
        { value: 'end', label: 'end' },
        { value: 'flex-start', label: 'flex-start' },
        { value: 'flex-end', label: 'flex-end' },
        { value: 'baseline', label: 'baseline' },
        { value: 'first baseline', label: 'first baseline' },
        { value: 'last baseline', label: 'last baseline' },
        { value: 'safe center', label: 'safe center' },
        { value: 'unsafe center', label: 'unsafe center' },
        { value: 'revert', label: 'revert' },
        { value: 'revert-layer', label: 'revert-layer' },
      ],
    },
    {
      component: FieldComponentType.SELECT,
      // type: 'number',
      name: 'alignContent',
      label: 'Align Content',
      description:
        "Sets the distribution of space between and around content items along a flexbox's cross-axis or a grid's block axis",
      options: [
        { value: '', label: 'Default' },
        { value: 'unset', label: 'Unset' },
        { value: 'inherit', label: 'Inherit' },
        { value: 'initial', label: 'Initial' },
        { value: 'normal', label: 'normal' },
        { value: 'stretch', label: 'stretch' },
        { value: 'center', label: 'center' },
        { value: 'start', label: 'start' },
        { value: 'end', label: 'end' },
        { value: 'space-between', label: 'space-between' },
        { value: 'space-around', label: 'space-around' },
        { value: 'space-evenly', label: 'space-evenly' },
        { value: 'flex-start', label: 'flex-start' },
        { value: 'flex-end', label: 'flex-end' },
        { value: 'baseline', label: 'baseline' },
        { value: 'first baseline', label: 'first baseline' },
        { value: 'last baseline', label: 'last baseline' },
        { value: 'safe center', label: 'safe center' },
        { value: 'unsafe center', label: 'unsafe center' },
        { value: 'revert', label: 'revert' },
        { value: 'revert-layer', label: 'revert-layer' },
      ],
    },
    {
      component: FieldComponentType.SELECT,
      // type: 'number',
      name: 'justifyContent',
      label: 'Justify Content',
      description:
        'Defines how the browser distributes space between and around content items along the main-axis of a flex container, and the inline axis of a grid container',
      options: [
        { value: '', label: 'Default' },
        { value: 'unset', label: 'Unset' },
        { value: 'inherit', label: 'Inherit' },
        { value: 'initial', label: 'Initial' },
        { value: 'normal', label: 'normal' },
        { value: 'stretch', label: 'stretch' },
        { value: 'center', label: 'center' },
        { value: 'start', label: 'start' },
        { value: 'end', label: 'end' },
        { value: 'space-between', label: 'space-between' },
        { value: 'space-around', label: 'space-around' },
        { value: 'space-evenly', label: 'space-evenly' },
        { value: 'flex-start', label: 'flex-start' },
        { value: 'flex-end', label: 'flex-end' },
        { value: 'baseline', label: 'baseline' },
        { value: 'first baseline', label: 'first baseline' },
        { value: 'last baseline', label: 'last baseline' },
        { value: 'safe center', label: 'safe center' },
        { value: 'unsafe center', label: 'unsafe center' },
        { value: 'revert', label: 'revert' },
        { value: 'revert-layer', label: 'revert-layer' },
      ],
    },
    {
      component: FieldComponentType.SELECT,
      // type: 'number',
      name: 'justifyItems',
      label: 'Justify Items',
      description:
        'Defines the default justify-self for all items of the box, giving them all a default way of justifying each box along the appropriate axis',
      options: [
        { value: '', label: 'Default' },
        { value: 'unset', label: 'Unset' },
        { value: 'inherit', label: 'Inherit' },
        { value: 'initial', label: 'Initial' },
        { value: 'normal', label: 'normal' },
        { value: 'stretch', label: 'stretch' },
        { value: 'center', label: 'center' },
        { value: 'start', label: 'start' },
        { value: 'end', label: 'end' },
        { value: 'left', label: 'left' },
        { value: 'right', label: 'right' },
        { value: 'self-start', label: 'self-start' },
        { value: 'self-end', label: 'self-end' },
        { value: 'space-between', label: 'space-between' },
        { value: 'space-around', label: 'space-around' },
        { value: 'space-evenly', label: 'space-evenly' },
        { value: 'flex-start', label: 'flex-start' },
        { value: 'flex-end', label: 'flex-end' },
        { value: 'baseline', label: 'baseline' },
        { value: 'first baseline', label: 'first baseline' },
        { value: 'last baseline', label: 'last baseline' },
        { value: 'safe center', label: 'safe center' },
        { value: 'unsafe center', label: 'unsafe center' },
        { value: 'revert', label: 'revert' },
        { value: 'revert-layer', label: 'revert-layer' },
      ],
    },
    {
      component: FieldComponentType.SELECT,
      // type: 'number',
      name: 'flexWrap',
      label: 'Flex Wrap',
      description:
        'Sets whether flex items are forced onto one line or can wrap onto multiple lines. If wrapping is allowed, it sets the direction that lines are stacked',
      options: [
        { value: '', label: 'Default' },
        { value: 'unset', label: 'Unset' },
        { value: 'inherit', label: 'Inherit' },
        { value: 'initial', label: 'Initial' },
        { value: 'nowrap', label: 'nowrap' },
        { value: 'wrap', label: 'wrap' },
        { value: 'wrap-reverse', label: 'wrap-reverse' },
      ],
    },
    // {
    //   component: FieldComponentType.TOGGLE_BUTTON,
    //   name: 'textAlign',
    //   label: 'Text Alignment',
    //   description:
    //     'Sets the horizontal alignment of the inline-level content inside a block element or table-cell box.',
    //   exclusive: true,
    //   size: 'small',
    //   fullWidth: true,
    //   options: [
    //     {
    //       value: '',
    //       children: (
    //         <MdiIcon
    //           fontSize={'inherit'}
    //           path={ICON_VARIANT_CSS_DEFAULT.path}
    //         />
    //       ),
    //     },
    //     {
    //       value: 'inherit',
    //       children: (
    //         <MdiIcon
    //           fontSize={'inherit'}
    //           path={ICON_VARIANT_CSS_INHERIT.path}
    //         />
    //       ),
    //     },
    //     {
    //       value: 'left',
    //       children: (
    //         <MdiIcon fontSize={'inherit'} path={ICON_VARIANT_ALIGN_LEFT.path} />
    //       ),
    //     },
    //     {
    //       value: 'center',
    //       children: (
    //         <MdiIcon
    //           fontSize={'inherit'}
    //           path={ICON_VARIANT_ALIGN_CENTER.path}
    //         />
    //       ),
    //     },
    //     {
    //       value: 'right',
    //       children: (
    //         <MdiIcon
    //           fontSize={'inherit'}
    //           path={ICON_VARIANT_ALIGN_RIGHT.path}
    //         />
    //       ),
    //     },
    //     {
    //       value: 'justify',
    //       children: (
    //         <MdiIcon
    //           fontSize={'inherit'}
    //           path={ICON_VARIANT_ALIGN_JUSTIFY.path}
    //         />
    //       ),
    //     },
    //   ],
    // },
  ],
})

const alignItems: ButtonGroupFormControl = {
  name: 'alignItems',
  label: 'Align items',
  helperText:
    'The CSS align-items property sets the align-self value on all direct children as a group. In Flexbox, it controls the alignment of items on the Cross Axis. In Grid Layout, it controls the alignment of items on the Block Axis within their grid area.',
  options: [
    {
      value: 'center',
      label: 'Center',
      icon: {
        viewBox: '0 0 13 13',
        component: alignItemsCenterIcon,
      },
    },
    {
      value: 'flex-end',
      label: 'Flex end',
      icon: {
        viewBox: '0 0 13 13',
        component: alignItemsFlexEndIcon,
      },
    },
    {
      value: 'flex-start',
      label: 'Flex start',
      icon: {
        viewBox: '0 0 13 13',
        component: alignItemsFlexStartIcon,
      },
    },
    {
      value: 'stretch',
      label: 'Stretch',
      icon: {
        viewBox: '0 0 13 13',
        component: alignItemsStretchIcon,
      },
    },
  ],
}

const alignContent: ButtonGroupFormControl = {
  name: 'alignContent',
  label: 'Align content',
  helperText:
    "The CSS align-content property sets the distribution of space between and around content items along a flexbox's cross-axis or a grid's block axis.",
  options: [
    {
      value: 'center',
      label: 'Center',
      icon: {
        viewBox: '0 0 13 13',
        component: alignContentCenterIcon,
      },
    },
    {
      value: 'end',
      label: 'End',
      icon: {
        viewBox: '0 0 13 13',
        component: alignContentEndIcon,
      },
    },
    {
      value: 'space-around',
      label: 'Space around',
      icon: {
        viewBox: '0 0 13 13',
        component: alignContentSpaceAroundIcon,
      },
    },
    {
      value: 'space-between',
      label: 'Space between',
      icon: {
        viewBox: '0 0 13 13',
        component: alignContentSpaceBetweenIcon,
      },
    },
    {
      value: 'space-evenly',
      label: 'Space evenly',
      icon: {
        viewBox: '0 0 13 13',
        component: alignContentSpaceEvenlyIcon,
      },
    },
    {
      value: 'start',
      label: 'Start',
      icon: {
        viewBox: '0 0 13 13',
        component: alignContentStartIcon,
      },
    },
    {
      value: 'stretch',
      label: 'Stretch',
      icon: {
        viewBox: '0 0 13 13',
        component: alignContentStretchIcon,
      },
    },
  ],
}

const alignSelf: ButtonGroupFormControl = {
  name: 'alignSelf',
  label: 'Align self',
  helperText:
    "The align-self CSS property overrides a grid or flex item's align-items value. In Grid, it aligns the item inside the grid area. In Flexbox, it aligns the item on the cross axis.",
  options: [
    {
      value: 'center',
      label: 'Center',
      icon: {
        viewBox: '0 0 13 13',
        component: alignSelfCenterIcon,
      },
    },
    {
      value: 'end',
      label: 'End',
      icon: {
        viewBox: '0 0 13 13',
        component: alignSelfFlexEndIcon,
      },
    },
    {
      value: 'start',
      label: 'Start',
      icon: {
        viewBox: '0 0 13 13',
        component: alignSelfFlexStartIcon,
      },
    },
    {
      value: 'stretch',
      label: 'Stretch',
      icon: {
        viewBox: '0 0 13 13',
        component: alignSelfStretchIcon,
      },
    },
  ],
}

const flexWrap: ButtonGroupFormControl = {
  name: 'flexWrap',
  label: 'Flex wrap',
  helperText:
    'The flex-wrap CSS property sets whether flex items are forced onto one line or can wrap onto multiple lines. If wrapping is allowed, it sets the direction that lines are stacked.',
  options: [
    {
      value: 'nowrap',
      label: 'No wrap',
      icon: {
        viewBox: '0 0 13 13',
        component: flexNowrapIcon,
      },
    },
    {
      value: 'wrap',
      label: 'Wrap',
      icon: {
        viewBox: '0 0 13 13',
        component: flexWrapIcon,
      },
    },
    {
      value: 'wrap-reverse',
      label: 'Wrap reverse',
      icon: {
        viewBox: '0 0 13 13',
        component: flexWrapIcon,
      },
    },
  ],
}

const flexDirection: ButtonGroupFormControl = {
  name: 'flexDirection',
  label: 'Flex direction',
  helperText:
    'The flex-direction CSS property sets how flex items are placed in the flex container defining the main axis and the direction (normal or reversed).',
  options: [
    {
      value: 'column',
      label: 'Column',
      icon: {
        viewBox: '0 0 13 13',
        component: flexDirectionIcon,
      },
    },
    {
      value: 'column-reverse',
      label: 'Column reverse',
      icon: {
        viewBox: '0 0 13 13',
        component: flexDirectionIcon,
        sx: { transform: 'rotate(-180deg)' },
      },
    },
    {
      value: 'row',
      label: 'Row',
      icon: {
        viewBox: '0 0 13 13',
        component: flexDirectionIcon,
        sx: { transform: 'rotate(-90deg)' },
      },
    },
    {
      value: 'row-reverse',
      label: 'Row reverse',
      icon: {
        viewBox: '0 0 13 13',
        component: flexDirectionIcon,
        sx: { transform: 'rotate(90deg)' },
      },
    },
  ],
}

const justifyItems: ButtonGroupFormControl = {
  name: 'justifyItems',
  label: 'Justify items',
  helperText:
    'The CSS justify-items property defines the default justify-self for all items of the box, giving them all a default way of justifying each box along the appropriate axis.',
  options: [
    {
      value: 'center',
      label: 'Center',
      icon: {
        viewBox: '0 0 13 13',
        component: alignSelfCenterIcon,
      },
    },
    {
      value: 'end',
      label: 'End',
      icon: {
        viewBox: '0 0 13 13',
        component: alignSelfFlexEndIcon,
      },
    },
    {
      value: 'start',
      label: 'Start',
      icon: {
        viewBox: '0 0 13 13',
        component: alignSelfFlexStartIcon,
      },
    },
    {
      value: 'stretch',
      label: 'Stretch',
      icon: {
        viewBox: '0 0 13 13',
        component: alignSelfStretchIcon,
      },
    },
  ],
}

const justifyContent: ButtonGroupFormControl = {
  name: 'justifyContent',
  label: 'Justify content',
  helperText:
    'The CSS justify-content property defines how the browser distributes space between and around content items along the main-axis of a flex container, and the inline axis of a grid container.',
  options: [
    {
      value: 'center',
      label: 'Center',
      icon: {
        viewBox: '0 0 13 13',
        component: justifyContentCenterIcon,
      },
    },
    {
      value: 'flex-end',
      label: 'Flex end',
      icon: {
        viewBox: '0 0 13 13',
        component: justifyContentFlexEndIcon,
      },
    },
    {
      value: 'flex-start',
      label: 'Flex start',
      icon: {
        viewBox: '0 0 13 13',
        component: justifyContentFlexStartIcon,
      },
    },
    {
      value: 'space-around',
      label: 'Space around',
      icon: {
        viewBox: '0 0 13 13',
        component: justifyContentSpaceAroundIcon,
      },
    },
    {
      value: 'space-between',
      label: 'Space between',
      icon: {
        viewBox: '0 0 13 13',
        component: justifyContentSpaceBetweenIcon,
      },
    },
  ],
}

const justifySelf: ButtonGroupFormControl = {
  name: 'justifySelf',
  label: 'Justify self',
  helperText:
    'The CSS justify-self property sets the way a box is justified inside its alignment container along the appropriate axis.',
  options: [
    {
      value: 'center',
      label: 'Center',
      icon: {
        viewBox: '0 0 13 13',
        component: alignSelfCenterIcon,
      },
    },
    {
      value: 'end',
      label: 'End',
      icon: {
        viewBox: '0 0 13 13',
        component: alignSelfFlexEndIcon,
      },
    },
    {
      value: 'start',
      label: 'Start',
      icon: {
        viewBox: '0 0 13 13',
        component: alignSelfFlexStartIcon,
      },
    },
    {
      value: 'stretch',
      label: 'Stretch',
      icon: {
        viewBox: '0 0 13 13',
        component: alignSelfStretchIcon,
      },
    },
  ],
}

const TextAlignToggleButtonGroup = (props: { onChange: (e: SyntheticEvent, value: string) => void; value: string; field: { component?: FieldComponentType; name: string; label: string; exclusive?: boolean; options: { value: string; icon: string; label: string }[]; description?: string } }) => {
  const { onChange, value, field } = props

  return (
    <FormControl fullWidth>
      <FormLabel htmlFor={field.name} sx={{ marginBottom: 1 }}>
        {field.label}
      </FormLabel>
      <div>
        <ToggleButtonGroup
          id={field.name}
          value={value || ''}
          size="small"
          color="secondary"
          onChange={onChange}
          fullWidth
          exclusive
        >
          {field.options.map((option) => (
            <ToggleButton key={option.value} value={option.value}>
              <Tooltip key={option.value} title={option.label}>
                <MdiIcon path={option.icon} fontSize="inherit" />
              </Tooltip>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </div>
      <FormHelperText>{field.description}</FormHelperText>
    </FormControl>
  )
}

export interface ElementStylesFormProps extends FormRendererProps {
  node?: Aglyn.NodeSchema
}

const ElementStylesForm = observer(
  forwardRef<any, ElementStylesFormProps>((props, ref) => {
    const { node, ...rest } = props
    const deleteElementCallback = useDeleteElementCallback()
    const nodeSx = node?.sx
    const siteTheme = useAglynSiteTheme()

    const presetColors = useMemo(
      () =>
        Object.entries(objectFlatten(siteTheme.palette))
          .map(([, value]) => String(value))
          .filter((color) => Boolean(color.match(/^(rgb|#)/)?.[0])),
      [siteTheme],
    )
    const schema = useMemo(() => stylesSchema(presetColors), [presetColors])
    // Accordion field groups (AGL-540): sizing, typography, borders &
    // shadows, position & overflow, grid/flex-child controls.
    const styleGroups = useMemo(
      () => buildStyleFieldGroups(presetColors),
      [presetColors],
    )

    // Breakpoint-scoped editing (AGL-333): when the artboard preview is a
    // device size, style edits write into that breakpoint's slice of the
    // responsive sx value; fluid preview edits the base.
    const [devicePreview] = useAglynBesignerFlag('devicePreview')
    const activeBreakpoint = deviceFlagToBreakpoint(devicePreview)

    const handleFormCancel = useCallback((e: SyntheticEvent, reason?: string) => {}, [])

    /**
     * Merges style values into node.sx at the active breakpoint scope.
     * Unchanged values are skipped so effective (inherited) readings never
     * get pinned into a breakpoint slice by round-tripping through a form.
     */
    const applyStyleValues = useCallback(
      (partial: Record<string, unknown>) => {
        action(() => {
          if (!node) return
          let sx = { ...(node.sx ?? {}) } as Record<string, any>
          for (const [key, value] of Object.entries(partial)) {
            const normalized = value === '' ? undefined : value
            if (readSxValue(sx, key, activeBreakpoint) === normalized) continue
            sx = writeSxValue(sx, key, normalized, activeBreakpoint)
          }
          node.sx = sx as any
        })()
      },
      [node, activeBreakpoint],
    )

    // Effective scalar values at the active breakpoint — feeds the form
    // and controls; responsive objects resolve to their active slice.
    const effectiveValues = useMemo(() => {
      const out: Record<string, any> = {}
      for (const key of Object.keys((nodeSx ?? {}) as Record<string, any>)) {
        const value = readSxValue(
          nodeSx as Record<string, any>,
          key,
          activeBreakpoint,
        )
        if (value !== undefined && typeof value !== 'object') out[key] = value
      }
      return out
    }, [nodeSx, activeBreakpoint])

    const handleElementSave = useCallback(
      (values: Record<string, unknown>) => {
        const keys = new Set([
          ...Object.keys(values ?? {}),
          ...Object.keys(effectiveValues),
        ])
        const partial: Record<string, unknown> = {}
        for (const key of keys) partial[key] = (values as any)?.[key]
        applyStyleValues(partial)
      },
      [applyStyleValues, effectiveValues],
    )

    /**
     * Scoped group save (AGL-540): a group's auto-submit may only write
     * its own field names, so it can never clear values owned by other
     * groups or by the custom-CSS editor.
     */
    const handleGroupSave = useCallback(
      (fieldNames: string[]) => (values: Record<string, unknown>) => {
        applyStyleValues(computeStylePartial(fieldNames, values))
      },
      [applyStyleValues],
    )

    const handleBoxStylerChange = useCallback(
      (dimensions: Measurements) => {
        applyStyleValues(dimensions as Record<string, unknown>)
      },
      [applyStyleValues],
    )

    const boxMeasurements = {
      marginTop: effectiveValues['marginTop'] ?? undefined,
      marginLeft: effectiveValues['marginLeft'] ?? undefined,
      marginRight: effectiveValues['marginRight'] ?? undefined,
      marginBottom: effectiveValues['marginBottom'] ?? undefined,
      paddingTop: effectiveValues['paddingTop'] ?? undefined,
      paddingLeft: effectiveValues['paddingLeft'] ?? undefined,
      paddingRight: effectiveValues['paddingRight'] ?? undefined,
      paddingBottom: effectiveValues['paddingBottom'] ?? undefined,
    }

    const handleTextAlignChange = useCallback(
      (e, value: string) => {
        applyStyleValues({ textAlign: value || undefined })
      },
      [applyStyleValues],
    )

    const handleFlexboxChange = useCallback(
      (name: string) => (e, value: string) => {
        applyStyleValues({ [name]: value || undefined })
      },
      [applyStyleValues],
    )

    return (
      <>
        <Container gutterY={[1]} dense>
          <Tooltip
            title={
              activeBreakpoint
                ? `Edits apply from the ${activeBreakpoint.toUpperCase()} ` +
                  'breakpoint up. Switch the artboard preview to Fluid ' +
                  'Responsive to edit the base styles.'
                : 'Edits apply at every screen size. Switch the artboard ' +
                  'preview to a device size to style that breakpoint only.'
            }
          >
            <Chip
              size="small"
              color={activeBreakpoint ? 'secondary' : 'default'}
              label={
                activeBreakpoint
                  ? `Styling breakpoint: ${activeBreakpoint.toUpperCase()}`
                  : 'Styling: all screen sizes'
              }
            />
          </Tooltip>
        </Container>
        <Container gutterY={[2]} dense>
          <BoxStyler
            measurements={boxMeasurements}
            onChange={handleBoxStylerChange}
          />
        </Container>

        <Accordion summary="Flexbox & Grids" sx={{ mb: 2 }}>
          <ToggleButtonFormControl
            onChange={handleFlexboxChange(alignItems.name)}
            schema={alignItems}
          />
          <ToggleButtonFormControl
            onChange={handleFlexboxChange(alignContent.name)}
            schema={alignContent}
          />
          <ToggleButtonFormControl
            onChange={handleFlexboxChange(alignSelf.name)}
            schema={alignSelf}
          />
          <ToggleButtonFormControl
            onChange={handleFlexboxChange(flexWrap.name)}
            schema={flexWrap}
          />
          <ToggleButtonFormControl
            onChange={handleFlexboxChange(flexDirection.name)}
            schema={flexDirection}
          />
          <ToggleButtonFormControl
            onChange={handleFlexboxChange(justifyItems.name)}
            schema={justifyItems}
          />
          <ToggleButtonFormControl
            onChange={handleFlexboxChange(justifyContent.name)}
            schema={justifyContent}
          />
          <ToggleButtonFormControl
            onChange={handleFlexboxChange(justifySelf.name)}
            schema={justifySelf}
          />
        </Accordion>

        <Container gutterY={[2]} dense>
          <TextAlignToggleButtonGroup
            onChange={handleTextAlignChange}
            value={nodeSx?.['textAlign']}
            field={{
              component: FieldComponentType.TOGGLE_BUTTON,
              name: 'textAlign',
              label: 'Text Alignment',
              description:
                'Sets the horizontal alignment of the inline-level content inside a block element or table-cell box.',
              exclusive: true,
              options: [
                {
                  value: 'inherit',
                  icon: ICON_VARIANT_CSS_INHERIT.path,
                  label: 'Inherit',
                },
                {
                  value: 'left',
                  icon: ICON_VARIANT_ALIGN_LEFT.path,
                  label: 'Left',
                },
                {
                  value: 'center',
                  icon: ICON_VARIANT_ALIGN_CENTER.path,
                  label: 'Center',
                },
                {
                  value: 'right',
                  icon: ICON_VARIANT_ALIGN_RIGHT.path,
                  label: 'Right',
                },
                {
                  value: 'justify',
                  icon: ICON_VARIANT_ALIGN_JUSTIFY.path,
                  label: 'Justify',
                },
              ],
            }}
          />

          <FormRenderer
            FormTemplate={ElementPropsFormTemplate}
            componentMapper={componentMapper}
            onCancel={handleFormCancel}
            onSubmit={handleElementSave}
            initialValues={effectiveValues}
            schema={schema}
            {...rest}
          />

          {/* First-class style groups (AGL-540). Each form is keyed on
              the node + breakpoint so switching selection or artboard
              scope re-seeds the initial values. */}
          {styleGroups.map((group) => {
            const fieldNames = styleGroupFieldNames(group)
            return (
              <Accordion
                key={group.$id}
                summary={group.label}
                sx={{ mt: 2 }}
              >
                <FormRenderer
                  key={`${node?.$id ?? ''}:${activeBreakpoint ?? 'base'}`}
                  FormTemplate={ElementPropsFormTemplate}
                  componentMapper={componentMapper}
                  onSubmit={handleGroupSave(fieldNames)}
                  initialValues={pickStyleValues(fieldNames, effectiveValues)}
                  schema={{ fields: group.fields }}
                />
              </Accordion>
            )
          })}

          <Accordion summary="Classes & custom CSS" sx={{ mt: 2 }}>
            <ElementClassesField node={node} />
            <CustomCssForm node={node} breakpoint={activeBreakpoint} />
          </Accordion>

          <FormControl margin="none" fullWidth>
            <Button
              onClick={() => deleteElementCallback(node)}
              sx={{ mt: 2, color: 'error.main' }}
              fullWidth
            >
              Delete Element
            </Button>
          </FormControl>
        </Container>
      </>
    )
  }),
)
ElementStylesForm.displayName = 'ElementStylesForm'

export default ElementStylesForm
