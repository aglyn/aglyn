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

import type { AuthResultError } from '@aglyn/shared-data-enums'
import {
  FormSpy,
  type FormTemplateRenderProps,
  useFormApi,
} from '@aglyn/shared-ui-jsx-forms'
import { Box, Button, FormControl, Grid } from '@mui/material'
import { forwardRef } from 'react'
import { useSigninCheck } from '@aglyn/tenant-feature-instance'
import AuthErrorAlertComponent from './auth-error-alert.component'

export interface AuthFormTemplateComponentProps
  extends FormTemplateRenderProps {}

const AuthFormTemplateComponent = forwardRef<any, FormTemplateRenderProps>(
  (props, ref) => {
    const { formFields, schema, ...rest } = props
    const { handleSubmit } = useFormApi()
    const { status, error } = useSigninCheck()
    const isLoading = status === 'loading'
    return (
      <form ref={ref} onSubmit={handleSubmit} noValidate {...rest}>
        {schema.title}
        <Grid spacing={2} container>
          {formFields}
        </Grid>
        <AuthErrorAlertComponent error={error as AuthResultError} sx={{ mt: 2, mb: 1 }} />
        <FormSpy>
          {({ submitting, pristine, valid }) => (
            <Box sx={{
              mt: 2
            }}>
              <FormControl margin="normal" fullWidth>
                <Button
                  color="secondary"
                  disabled={submitting /* || !valid || pristine*/ || isLoading}
                  style={{ marginRight: 8 }}
                  type="submit"
                  variant="contained"
                  fullWidth
                >
                  {(schema as { submitLabel?: string }).submitLabel ?? 'Next'}
                </Button>
              </FormControl>
            </Box>
          )}
        </FormSpy>
      </form>
    );
  },
)
AuthFormTemplateComponent.displayName = 'AuthFormTemplateComponent'
AuthFormTemplateComponent.aglyn = true

export { AuthFormTemplateComponent }
export default AuthFormTemplateComponent
