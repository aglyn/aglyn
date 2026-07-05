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
  FormRenderer,
  type FormRendererProps,
  FormSpy,
  type FormTemplateRenderProps,
  simpleComponentMapper,
  useFormApi,
} from '@aglyn/shared-ui-jsx-forms'
import {
  mdiContentSave,
} from '@aglyn/shared-data-mdi'
import {
  MdiIcon,
} from '@aglyn/shared-ui-jsx'
import { NoSsr } from '@mui/material'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControl from '@mui/material/FormControl'
import { Grid } from '@mui/material'
import { observer } from 'mobx-react-lite'
import { forwardRef, memo, type SyntheticEvent, useCallback, useEffect, useRef } from 'react'
import useDeleteElementCallback from '../hooks/use-delete-element-callback'

// Subscribes to form value changes via FormSpy and auto-submits when dirty.
// This is needed because MUI Select uses a Portal, so its onChange never
// bubbles through the <form> element as a DOM event.
const AutoSaveOnChange = memo(function AutoSaveOnChange({
  values,
  pristine,
  valid,
  onSubmit,
}: {
  values: unknown
  pristine: boolean
  valid: boolean
  onSubmit: () => void
}) {
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    if (!pristine && valid) {
      onSubmit()
    }
  }, [values]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
})

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
      noValidate
      {...rest}
    >
      {schema.title}
      <Grid spacing={2} container>
        {formFields as unknown as JSX.Node}
      </Grid>
      <FormSpy subscription={{ values: true, pristine: true, valid: true }}>
        {({ values, pristine, valid }) => (
          <AutoSaveOnChange
            values={values}
            pristine={pristine}
            valid={valid}
            onSubmit={handleSubmit}
          />
        )}
      </FormSpy>
      <FormSpy>
        {({ submitting, pristine, valid }) => (
          <Box sx={{ mt: 2 }}>
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
  );
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

    const handleFormCancel = useCallback((e: SyntheticEvent, reason?: string) => {}, [])
    const handleElementSave = useCallback(
      (values: Record<string, unknown>) => {
        Aglyn.canvas.updateNodeProps(node, values)
      },
      [node],
    )

    return (
      <>
        <NoSsr>
          <FormRenderer
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
