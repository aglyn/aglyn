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

import {mdiContentSave, MdiIcon} from '@aglyn/shared-ui-mdi-jsx'
import {type FormTemplateRenderProps} from '@data-driven-forms/react-form-renderer'

import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControl from '@mui/material/FormControl'
import Grid from '@mui/material/Grid'
import React, {forwardRef} from 'react'

import {FormSpy, useFormApi} from './ddf-reexports'


export interface GridFormTemplateProps extends FormTemplateRenderProps {}

export const GridFormTemplate = forwardRef<any, GridFormTemplateProps>(
  function RefRenderFn(props, ref) {
    const {formFields, schema, ...rest} = props
    const {handleSubmit, onReset, onCancel, getState} = useFormApi()
    const {submitting, valid, pristine} = getState()
    return (
      <form ref={ref} onSubmit={handleSubmit} noValidate>
        {schema.title}
        <Grid spacing={2} container>
          {formFields}
        </Grid>
        <FormSpy>
          {({submitting, validating, pristine, valid}) => (
            <Box mt={2}>
              <FormControl margin="normal" fullWidth>
                <Button
                  variant="outlined"
                  onClick={onReset}
                  disabled={submitting || validating}
                  fullWidth
                >
                  Cancel
                </Button>
              </FormControl>
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
GridFormTemplate.displayName = 'GridFormTemplate'
export default GridFormTemplate
