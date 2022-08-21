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

import { BoxStyler } from '@aglyn/besigner-ui-box-styler'
import { updateCanvasElement } from '@aglyn/core-data-app'
import { FieldComponentType, type NodeId } from '@aglyn/core-data-foundation'
import {
  useAglynAppContext,
  useAglynElementData,
  useAglynSiteTheme,
} from '@aglyn/core-feature-renderer'
import {
  componentMapper,
  FormRenderer,
  type FormRendererProps,
} from '@aglyn/shared-ui-jsx-forms'
import {
  mdiAlignHorizontalDistribute,
  mdiAlignVerticalCenter,
  mdiFormatHorizontalAlignCenter,
  mdiFormatHorizontalAlignLeft,
  mdiFormatHorizontalAlignRight,
  MdiIcon,
} from '@aglyn/shared-ui-mdi-jsx'
import { objectFlatten } from '@aglyn/shared-util-vendor'
import Button from '@mui/material/Button'
import FormControl from '@mui/material/FormControl'
import { type ChangeEvent, forwardRef, useCallback, useMemo } from 'react'
import useDeleteElementCallback from '../hooks/use-delete-element-callback'
import { ElementPropsFormTemplate } from './element-props-form.component'

const stylesSchema = (presetColors) => ({
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
      component: FieldComponentType.TOGGLE_BUTTON,
      condition: {
        when: 'Foo', // name of controlled field
        is: 'Bar', // condition
      },
      name: 'alignItems',
      label: 'Align Items',
      description: 'The flex box align items',
      exclusive: true,
      options: [
        {
          value: 'start',
          label: <MdiIcon path={mdiFormatHorizontalAlignRight.path} />,
        },
        {
          value: 'space-evenly',
          label: <MdiIcon path={mdiAlignHorizontalDistribute.path} />,
        },
        {
          value: 'space-between',
          label: <MdiIcon path={mdiAlignVerticalCenter.path} />,
        },
        {
          value: 'center',
          label: <MdiIcon path={mdiFormatHorizontalAlignCenter.path} />,
        },
        {
          value: 'end',
          label: <MdiIcon path={mdiFormatHorizontalAlignLeft.path} />,
        },
      ],
    },
    {
      component: FieldComponentType.COLOR_PICKER,
      name: 'color',
      label: 'Text Color',
      description: 'The text color of the element',
      presetColors,
      FormFieldGridProps: {
        xs: 12,
        sm: 6,
      },
    },
    {
      component: FieldComponentType.COLOR_PICKER,
      name: 'backgroundColor',
      label: 'Background Color',
      description: 'The background color of the element',
      presetColors,
      FormFieldGridProps: {
        xs: 12,
        sm: 6,
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
      component: FieldComponentType.TEXT_FIELD,
      name: 'paddingTop',
      label: 'Top',
      title: 'Padding top',
      FormFieldGridProps: { xs: 3 },
    },
    {
      component: FieldComponentType.TEXT_FIELD,
      name: 'paddingRight',
      label: 'Right',
      title: 'Padding right',
      FormFieldGridProps: { xs: 3 },
    },
    {
      component: FieldComponentType.TEXT_FIELD,
      name: 'paddingBottom',
      label: 'Bottom',
      title: 'Padding bottom',
      FormFieldGridProps: { xs: 3 },
    },
    {
      component: FieldComponentType.TEXT_FIELD,
      name: 'paddingLeft',
      label: 'Left',
      title: 'Padding left',
      FormFieldGridProps: { xs: 3 },
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
  ],
})

export interface ElementStylesFormProps extends FormRendererProps {
  $id?: NodeId
}

const ElementStylesForm = forwardRef<any, ElementStylesFormProps>(
  (props, ref) => {
    const { $id, ...rest } = props
    const app = useAglynAppContext()
    const deleteElementCallback = useDeleteElementCallback({ $id })
    const elemStyles = useAglynElementData($id, 'sx')
    const siteTheme = useAglynSiteTheme()

    const schema = useMemo(() => {
      const flatMap = objectFlatten(siteTheme.palette)
      const values = Object.entries(flatMap)
        .map(([name, value]) => ({ color: value, title: name }))
        .filter((i) => Boolean(String(i.color).match(/^(rgb|#)/)?.[0]))
      return stylesSchema(values)
    }, [siteTheme])

    const handleFormCancel = useCallback((e, reason) => {}, [])
    const handleElementSave = useCallback(
      (values) => {
        updateCanvasElement(app, {
          $id,
          update: (element) => {
            return { ...element, sx: { ...values } }
          },
        })
      },
      [$id, app],
    )
    const handleDeleteElement = useCallback(
      (e: ChangeEvent<unknown>) => {
        deleteElementCallback(e)
      },
      [deleteElementCallback],
    )

    return (
      <>
        <BoxStyler />

        <FormRenderer
          ref={ref}
          FormTemplate={ElementPropsFormTemplate}
          componentMapper={componentMapper}
          onCancel={handleFormCancel}
          onSubmit={handleElementSave}
          initialValues={elemStyles}
          schema={schema}
          {...rest}
        />

        <FormControl margin="none" fullWidth>
          <Button
            onClick={handleDeleteElement}
            sx={{ mt: 2, color: 'error.main' }}
            fullWidth
          >
            Delete Element
          </Button>
        </FormControl>
      </>
    )
  },
)
ElementStylesForm.displayName = 'ElementStylesForm'
ElementStylesForm.aglyn = true

export { ElementStylesForm }
export default ElementStylesForm
