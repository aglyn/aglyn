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

import {type ElementId, updateCanvasElement} from '@aglyn/core-data-framework'
import {useAglynAppContext, useAglynElementData} from '@aglyn/core-feature-renderer'
import {
  FormRenderer,
  type FormRendererProps,
  FormSpy,
  type FormTemplateRenderProps,
  simpleComponentMapper,
  useFormApi,
} from '@aglyn/shared-ui-jsx-forms'
import {mdiContentSave, MdiIcon} from '@aglyn/shared-ui-mdi-jsx'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControl from '@mui/material/FormControl'
import Grid from '@mui/material/Grid'
import {type ChangeEvent, forwardRef, useCallback} from 'react'
import useComponentFormSchema from '../hooks/use-component-form-schema'
import useDeleteElementCallback from '../hooks/use-delete-element-callback'


const FormTemplate = forwardRef<any, FormTemplateRenderProps>(
  function RefRenderFn(props, ref) {
    const {formFields, schema, ...rest} = props
    const {handleSubmit} = useFormApi()
    return (
      <form ref={ref} onSubmit={handleSubmit} noValidate {...rest}>
        {schema.title}
        <Grid spacing={2} container>
          {formFields}
        </Grid>
        <FormSpy>
          {({submitting, pristine, valid}) => (
            <Box mt={2}>
              <FormControl margin="normal" fullWidth>
                <Button
                  color="secondary"
                  disabled={submitting || !valid || pristine}
                  startIcon={<MdiIcon path={mdiContentSave.path} />}
                  style={{marginRight: 8}}
                  type="submit"
                  variant="contained"
                  fullWidth
                >
                  Save Element
                </Button>
              </FormControl>
            </Box>
          )}
        </FormSpy>
      </form>
    )
  },
)
FormTemplate.displayName = 'FormTemplate'
FormTemplate.aglyn = true

export interface ElementPropsFormProps extends FormRendererProps {
  $id?: ElementId
}

const ElementPropsForm = forwardRef<any, ElementPropsFormProps>(
  function RefRenderFn(props, ref) {
    const {$id, ...rest} = props
    const {getApp} = useAglynAppContext()
    const deleteElementCallback = useDeleteElementCallback({$id})
    const componentId = useAglynElementData($id, 'componentId')
    const bundleId = useAglynElementData($id, 'bundleId')
    const elemProps = useAglynElementData($id, 'props')
    const formSchema = useComponentFormSchema({componentId, bundleId})

    const handleFormCancel = useCallback((e, reason) => {}, [])
    const handleElementSave = useCallback((values) => {
      updateCanvasElement(getApp(), {element: {$id, props: {...values}}})
    }, [$id, getApp])
    const handleDeleteElement = useCallback((e: ChangeEvent<unknown>) => {
      deleteElementCallback(e)
    }, [deleteElementCallback])

    return (
      <>
        <FormRenderer
          ref={ref}
          FormTemplate={FormTemplate}
          componentMapper={simpleComponentMapper}
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
ElementPropsForm.aglyn = true

export {ElementPropsForm}
export default ElementPropsForm
