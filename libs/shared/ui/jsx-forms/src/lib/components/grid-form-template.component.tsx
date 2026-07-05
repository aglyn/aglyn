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

import { mdiContentSave } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'

import { Box, Button, FormControl, Grid } from '@mui/material'
import { forwardRef } from 'react'

import {
  FormSpy,
  type FormTemplateRenderProps,
  useFormApi,
} from '../vendor/data-driven-forms'

export interface GridFormTemplateProps extends FormTemplateRenderProps {}

export const GridFormTemplateComponent = forwardRef<any, GridFormTemplateProps>(
  (props, ref) => {
    const { formFields, schema } = props
    const { handleSubmit, onCancel } = useFormApi()
    return (
      <form ref={ref} onSubmit={handleSubmit} noValidate>
        {schema.title}
        <Grid spacing={2} container>
          {formFields as any}
        </Grid>
        <FormSpy>
          {({ submitting, validating, pristine, valid }) => (
            <Box sx={{
              mt: 2
            }}>
              <FormControl margin="normal" fullWidth>
                <Button
                  variant="outlined"
                  onClick={onCancel}
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
                  style={{ marginRight: 8 }}
                  type="submit"
                  variant="contained"
                  fullWidth
                >
                  Continue
                </Button>
              </FormControl>
            </Box>
          )}
        </FormSpy>
      </form>
    );
  },
)
GridFormTemplateComponent.displayName = 'GridFormTemplateComponent'
GridFormTemplateComponent.aglyn = true
export default GridFormTemplateComponent
