/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import type {ElementId} from '@aglyn/core-data-framework'
import {useAglynCanvasApiEvents, useAglynElementData} from '@aglyn/core-feature-renderer'
import {
  componentMapper,
  FormRenderer,
  type FormRendererProps,
  GridFormTemplate,
} from '@aglyn/shared-ui-jsx'
import Button from '@mui/material/Button'
import FormControl from '@mui/material/FormControl'
import {forwardRef, useCallback} from 'react'
import useComponentFormSchema from '../hooks/use-component-form-schema'


export interface ElementPropsFormProps extends FormRendererProps {
  $id?: ElementId
}

const ElementPropsForm = forwardRef<any, ElementPropsFormProps>(
  function RefRenderFn(props, ref) {
    const {$id, ...rest} = props
    const {updateElement, deleteElement} = useAglynCanvasApiEvents()
    const {props: elemProps, componentId, bundleId} = useAglynElementData($id) || {}
    const formSchema = useComponentFormSchema({componentId, bundleId})

    const handleFormCancel = useCallback((e, reason) => {}, [])
    const handleElementSave = useCallback((values) => {
      updateElement({element: {$id, props: {...values}}})
    }, [$id])
    const handleDeleteElement = useCallback((e) => {
      deleteElement({$id})
    }, [$id])

    return (
      <>
        <FormRenderer
          ref={ref}
          FormTemplate={GridFormTemplate}
          componentMapper={componentMapper}
          onCancel={handleFormCancel}
          onSubmit={handleElementSave}
          initialValues={elemProps}
          schema={formSchema}
          clearOnUnmount
          subscription={{values: true}}
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
ElementPropsForm.displayName = 'ElementPropsForm'

export {ElementPropsForm}
export default ElementPropsForm
