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

import {type ElementId, FieldComponentType, updateCanvasElement} from '@aglyn/core-data-framework'
import {
  useAglynAppContext,
  useAglynElementData,
  useAglynSiteTheme,
} from '@aglyn/core-feature-renderer'
import {componentMapper, FormRenderer, type FormRendererProps} from '@aglyn/shared-ui-jsx-forms'
import {objectFlatten} from '@aglyn/shared-util-vendor'
import Button from '@mui/material/Button'
import FormControl from '@mui/material/FormControl'
import {type ChangeEvent, forwardRef, useCallback, useMemo} from 'react'
import useDeleteElementCallback from '../hooks/use-delete-element-callback'
import {ElementPropsFormTemplate} from './element-props-form.component'


const stylesSchema = (presetColors) => ({
  fields: [
    {
      component: FieldComponentType.SELECT,
      name: 'display',
      label: 'Display Variant',
      description: 'The display property specifies the display behavior (the type of rendering box) of an element.',
      options: [
        {value: '', label: 'Default'},
        {value: 'block', label: 'Block'},
        {value: 'inline', label: 'Inline'},
        {value: 'content', label: 'Contents'},
        {value: 'list-item', label: 'List Item'},
        {value: 'inline-block', label: 'Inline Block'},
        {value: 'flex', label: 'Flex'},
        {value: 'inline-flex', label: 'Inline Flex'},
        {value: 'grid', label: 'Grid'},
        {value: 'inline-grid', label: 'Inline Grid'},
        {value: 'table', label: 'Table'},
        {value: 'inline-table', label: 'Inline Table'},
        {value: 'table-caption', label: 'Table Caption'},
        {value: 'table-column', label: 'Table Column'},
        {value: 'table-column-group', label: 'Table Column Group'},
        {value: 'table-cell', label: 'Table Cell'},
        {value: 'table-row', label: 'Table Row'},
        {value: 'table-row-group', label: 'Table Row Group'},
        {value: 'table-header-group', label: 'Table Header Group'},
        {value: 'table-footer-group', label: 'Table Footer Group'},
        {value: 'none', label: 'None'},
        {value: 'initial', label: 'Initial'},
        {value: 'unset', label: 'Unset'},
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
      description: 'The float property is used for positioning and formatting content e.g. let an image float left to the text in a container.',
      options: [
        {
          value: '', label: 'Default',
        },
        {
          value: 'inherit', label: 'Inherit',
          description: 'The element inherits the float value of its parent',
        },
        {
          value: 'none', label: 'None',
          description: 'The element does not float (will be displayed just where it occurs in the text)',
        },
        {
          value: 'left', label: 'Left',
          description: 'The element floats to the left of its container',
        },
        {
          value: 'right', label: 'Right',
          description: 'The element floats to the right of its container',
        },
      ],
    },
    {
      component: FieldComponentType.TEXT_FIELD,
      name: 'paddingTop',
      label: 'Top',
      title: 'Padding top',
      FormFieldGridProps: {xs: 3},
    },
    {
      component: FieldComponentType.TEXT_FIELD,
      name: 'paddingRight',
      label: 'Right',
      title: 'Padding right',
      FormFieldGridProps: {xs: 3},
    },
    {
      component: FieldComponentType.TEXT_FIELD,
      name: 'paddingBottom',
      label: 'Bottom',
      title: 'Padding bottom',
      FormFieldGridProps: {xs: 3},
    },
    {
      component: FieldComponentType.TEXT_FIELD,
      name: 'paddingLeft',
      label: 'Left',
      title: 'Padding left',
      FormFieldGridProps: {xs: 3},
    },
  ],
})

export interface ElementStylesFormProps extends FormRendererProps {
  $id?: ElementId
}

const ElementStylesForm = forwardRef<any, ElementStylesFormProps>(
  function RefRenderFn(props, ref) {
    const {$id, ...rest} = props
    const app = useAglynAppContext()
    const deleteElementCallback = useDeleteElementCallback({$id})
    const elemStyles = useAglynElementData($id, 'sx')
    const siteTheme = useAglynSiteTheme()

    const schema = useMemo(() => {
      const flatMap = objectFlatten(siteTheme.palette)
      const values = Object.entries(flatMap)
        .map(([name, value]) => ({color: value, title: name}))
        .filter((i) => Boolean(String(i.color).match(/^(rgb|#)/)?.[0]))
      return stylesSchema(values)
    }, [siteTheme])

    const handleFormCancel = useCallback((e, reason) => {}, [])
    const handleElementSave = useCallback((values) => {
      updateCanvasElement(app, {
        $id, update: (element) => {
          return ({...element, sx: {...values}})
        },
      })
    }, [$id, app])
    const handleDeleteElement = useCallback((e: ChangeEvent<unknown>) => {
      deleteElementCallback(e)
    }, [deleteElementCallback])

    return (
      <>
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
          <Button onClick={handleDeleteElement} sx={{mt: 2, color: 'error.main'}} fullWidth>
            Delete Element
          </Button>
        </FormControl>
      </>
    )
  },
)
ElementStylesForm.displayName = 'ElementStylesForm'
ElementStylesForm.aglyn = true

export {ElementStylesForm}
export default ElementStylesForm
