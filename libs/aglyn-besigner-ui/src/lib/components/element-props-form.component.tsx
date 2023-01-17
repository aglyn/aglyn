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

import * as Aglyn from '@aglyn/aglyn'
import {
  FormRenderer,
  type FormRendererProps,
  FormSpy,
  type FormTemplateRenderProps,
  simpleComponentMapper,
  useFormApi,
} from '@aglyn/shared-ui-jsx-forms'
import { mdiContentSave, MdiIcon } from '@aglyn/shared-ui-mdi-jsx'
import { NoSsr } from '@mui/material'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControl from '@mui/material/FormControl'
import Grid from '@mui/material/Grid'
import { observer } from 'mobx-react-lite'
import { forwardRef, useCallback } from 'react'
import useDeleteElementCallback from '../hooks/use-delete-element-callback'

/**
 * @TODO ⚠️ remove and reimplement following PR merge
 *   https://github.com/data-driven-forms/react-forms/pull/1218
 */
export const ElementPropsFormTemplate = forwardRef<
  any,
  FormTemplateRenderProps
>((props, ref) => {
  const { formFields, schema, ...rest } = props
  const { handleSubmit } = useFormApi()
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
        {formFields as unknown as JSX.Node}
      </Grid>
      <FormSpy>
        {({ submitting, pristine, valid }) => (
          <Box mt={2}>
            <FormControl margin="normal" fullWidth>
              <Button
                color="secondary"
                disabled={submitting || !valid || pristine}
                startIcon={<MdiIcon path={mdiContentSave.path} />}
                style={{ marginRight: 8 }}
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
})
ElementPropsFormTemplate.displayName = 'ElementPropsFormTemplate'
ElementPropsFormTemplate.aglyn = true

export interface ElementPropsFormProps extends FormRendererProps {
  node?: Aglyn.NodeSchema<any>
}

const ElementPropsFormRaw = forwardRef<any, ElementPropsFormProps>(
  (props, ref) => {
    const { node, ...rest } = props
    const schema = node?.componentSchema
    const nodeProps = node?.props
    const deleteElementCallback = useDeleteElementCallback()
    const attributes = schema?.attributes || []

    const handleFormCancel = useCallback((e, reason) => {}, [])
    const handleElementSave = useCallback(
      (values) => {
        console.log('Update node props', { ...node?.props }, values)
        Aglyn.canvas.updateNodeProps(node, values)
      },
      [node],
    )

    console.log('attributes', attributes)

    return (
      <>
        <NoSsr>
          <FormRenderer
            ref={ref}
            componentMapper={simpleComponentMapper}
            onCancel={handleFormCancel}
            onSubmit={handleElementSave}
            initialValues={nodeProps}
            schema={{ fields: attributes }}
            {...rest}
          >
            {({ formFields, schema, ...rest }) => (
              <>
                <ElementPropsFormTemplate
                  formFields={formFields}
                  schema={schema}
                  {...rest}
                />

                <FormControl margin="none" fullWidth>
                  <Button
                    onClick={() => deleteElementCallback(node)}
                    sx={{ mt: 2, color: 'error.main' }}
                    fullWidth
                  >
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
ElementPropsFormRaw.displayName = 'ElementPropsForm'
ElementPropsFormRaw.aglyn = true

export const ElementPropsForm = observer(ElementPropsFormRaw)
export default ElementPropsForm
