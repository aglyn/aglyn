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

import { SvgPathIcon } from '@aglyn/shared/ui/react'
import { FormTemplateRenderProps } from '@data-driven-forms/react-form-renderer/common-types/form-template-render-props'

import FormSpy from '@data-driven-forms/react-form-renderer/form-spy'
import useFormApi from '@data-driven-forms/react-form-renderer/use-form-api'

import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControl from '@mui/material/FormControl'
import Grid from '@mui/material/Grid'
import { forwardRef } from 'react'


export interface GridFormTemplateProps extends FormTemplateRenderProps {

}

export const GridFormTemplate = forwardRef<any, GridFormTemplateProps>(
  function RefRenderFn(props, ref) {
    const {formFields, schema} = props
    const {handleSubmit, onReset, onCancel, getState} = useFormApi()
    const {submitting, valid, pristine} = getState()
    return (
      <form ref={ref} onSubmit={handleSubmit} noValidate>
        {schema.title}
        <Grid spacing={2} container>
          {formFields}
        </Grid>
        <FormSpy>
          {({}) => (
            <Box mt={2}>
              <FormControl margin="normal" fullWidth>
                <Button
                  color="secondary"
                  disabled={submitting || !valid}
                  startIcon={<SvgPathIcon iconId="content-save"/>}
                  style={{marginRight: 8}}
                  type="submit"
                  variant="contained"
                  fullWidth
                >
                  Save Element
                </Button>
              </FormControl>
              <FormControl margin="normal" fullWidth>
                <Button
                  onClick={onCancel}
                  variant="text"
                  fullWidth
                >
                  Cancel
                </Button>
              </FormControl>
            </Box>
          )}
        </FormSpy>
      </form>
    )
  },
)
GridFormTemplate.displayName = 'GridFormTemplate'
export default GridFormTemplate
