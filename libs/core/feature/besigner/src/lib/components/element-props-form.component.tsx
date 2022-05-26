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
import {NoSsr} from '@mui/material'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControl from '@mui/material/FormControl'
import Grid from '@mui/material/Grid'
import {type ChangeEvent, forwardRef, type ReactNode, useCallback} from 'react'
import useComponentFormSchema from '../hooks/use-component-form-schema'
import useDeleteElementCallback from '../hooks/use-delete-element-callback'


/**
 * @TODO ⚠️ remove and reimplement following PR merge
 *   https://github.com/data-driven-forms/react-forms/pull/1218
 */
export const ElementPropsFormTemplate = forwardRef<any, FormTemplateRenderProps>(
  function RefRenderFn(props, ref) {
    const {formFields, schema, ...rest} = props
    const {handleSubmit} = useFormApi()
    return (
      <form
        ref={ref}
        onSubmit={handleSubmit}
        onChange={handleSubmit}
        onBlur={handleSubmit}
        noValidate
        {...rest}
      >
        {schema.title}
        <Grid spacing={2} container>
          {/*{Children.map(formFields as any, (child) => {*/}
          {/*  console.log('child', child, child?.props)*/}
          {/*  const originalOnChange = child.props.onChange?.bind(undefined)*/}
          {/*  child.props.onChange = (...args) => {*/}
          {/*    handleSubmit()*/}
          {/*    originalOnChange(...args)*/}
          {/*  }*/}
          {/*  return child*/}
          {/*})}*/}
          {formFields as unknown as ReactNode}
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
ElementPropsFormTemplate.displayName = 'ElementPropsFormTemplate'
ElementPropsFormTemplate.aglyn = true

export interface ElementPropsFormProps extends FormRendererProps {
  $id?: ElementId
}

const ElementPropsForm = forwardRef<any, ElementPropsFormProps>(
  function RefRenderFn(props, ref) {
    const {$id, ...rest} = props
    const app = useAglynAppContext()
    const deleteElementCallback = useDeleteElementCallback({$id})
    const componentId = useAglynElementData($id, 'componentId')
    const bundleId = useAglynElementData($id, 'bundleId')
    const elemProps = useAglynElementData($id, 'props')
    const formSchema = useComponentFormSchema({componentId, bundleId})

    const handleFormCancel = useCallback((e, reason) => {}, [])
    const handleElementSave = useCallback((values) => {
      updateCanvasElement(app, {
        $id, update: (element) => {
          return ({...element, props: {...values}})
        },
      })
    }, [$id, app])
    const handleDeleteElement = useCallback((e: ChangeEvent<unknown>) => {
      deleteElementCallback(e)
    }, [deleteElementCallback])

    return (
      <>
        <NoSsr>

          <FormRenderer
            ref={ref}
            componentMapper={simpleComponentMapper}
            onCancel={handleFormCancel}
            onSubmit={handleElementSave}
            initialValues={elemProps}
            schema={formSchema}
            {...rest}
          >
            {({formFields, schema, ...rest}) => (
              <>
                <ElementPropsFormTemplate
                  formFields={formFields}
                  schema={schema}
                  {...rest}
                />

                <FormControl margin="none" fullWidth>
                  <Button onClick={handleDeleteElement} sx={{mt: 2, color: 'error.main'}} fullWidth>
                    Delete Element
                  </Button>
                </FormControl>
              </>
            )}
          </FormRenderer>
        </NoSsr>
      </>
    )
  },
)
ElementPropsForm.displayName = 'ElementPropsForm'
ElementPropsForm.aglyn = true

export {ElementPropsForm}
export default ElementPropsForm
