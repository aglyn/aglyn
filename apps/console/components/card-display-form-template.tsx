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

import {
  type FormSchema,
  FormSpy,
  type FormTemplateRenderProps,
  useFormApi,
} from '@aglyn/shared-ui-jsx-forms'
import { Button, FormControl, Grid } from '@mui/material'
import { forwardRef } from 'react'
import { Case, Default, Switch } from 'react-if'
import { CardDisplay, type CardDisplayProps } from '@aglyn/shared-ui-jsx'

export const FormCardWrapper = forwardRef<any, CardDisplayProps>(
  (props, ref) => {
    const { children, ...rest } = props
    const { schema, handleSubmit } = useFormApi()

    return (
      <CardDisplay
        ref={ref}
        contentGutterY
        contentGutterX
        header={schema.title}
        actions={
          <FormSpy>
            {({ submitting, pristine, valid, validating }) => (
              <FormControl margin="normal">
                <Button
                  loading={validating || submitting}
                  color="secondary"
                  disabled={submitting || pristine || !valid || validating}
                  // style={{ marginRight: 8 }}
                  type="submit"
                  onClick={handleSubmit}
                  // variant="contained"
                >
                  <Switch>
                    <Case condition={Boolean(submitting)}>
                      {'Submitting...'}
                    </Case>
                    <Case condition={Boolean(pristine)}>{'Up to date'}</Case>
                    <Case condition={Boolean(!valid)}>{'Invalid'}</Case>
                    <Case condition={Boolean(validating)}>
                      {'Validating...'}
                    </Case>
                    <Default>{'Update'}</Default>
                  </Switch>
                </Button>
              </FormControl>
            )}
          </FormSpy>
        }
        {...(schema as FormSchema).CardDisplayProps}
        {...rest}
      >
        {children}
      </CardDisplay>
    )
  },
)
FormCardWrapper.displayName = 'FormCardWrapper'

export const CardDisplayFormTemplate = forwardRef<any, FormTemplateRenderProps>(
  (props, ref) => {
    const { formFields, schema, ...rest } = props
    const { handleSubmit } = useFormApi()
    return (
      <FormCardWrapper>
        <form ref={ref} onSubmit={handleSubmit} noValidate {...rest}>
          <Grid spacing={2} container>
            {formFields}
          </Grid>
        </form>
      </FormCardWrapper>
    )
  },
)
CardDisplayFormTemplate.displayName = 'CardDisplayFormTemplate'

export default CardDisplayFormTemplate
