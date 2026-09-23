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
import { forwardRef, type ReactNode } from 'react'
import { useSigninCheck } from '@aglyn/tenant-feature-instance'
import AuthErrorAlertComponent from './auth-error-alert.component'

export interface AuthFormTemplateComponentProps
  extends FormTemplateRenderProps {
  /**
   * What the page puts between its fields and the submit button, handed down
   * through `FormRenderer`'s `FormTemplateProps` (AGL-3291).
   *
   * Anything a page renders beside the form lands after the button, and the
   * sign-up page's terms box is what the button checks — so the person met
   * it only after pressing Next and being refused. It belongs above.
   */
  beforeSubmit?: ReactNode
}

const AuthFormTemplateComponent = forwardRef<any, AuthFormTemplateComponentProps>(
  (props, ref) => {
    const { formFields, schema, beforeSubmit, ...rest } = props
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
        {beforeSubmit ? <Box sx={{ mt: 2 }}>{beforeSubmit}</Box> : null}
        <FormSpy>
          {({ submitting, pristine, valid }) => (
            // Tighter under a before-submit block, which brings its own
            // top margin: the block and the button read as one group.
            <Box sx={{
              mt: beforeSubmit ? 1 : 2
            }}>
              <FormControl margin="normal" fullWidth>
                <Button
                  color="primary"
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
