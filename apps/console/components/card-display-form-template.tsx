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
import { Button, FormControl, Grid, Stack, Typography } from '@mui/material'
import { forwardRef, type FormEvent } from 'react'
import { Case, Default, Switch } from 'react-if'
import { CardDisplay, type CardDisplayProps } from '@aglyn/shared-ui-jsx'

/**
 * What a form's renderer passes its template through `FormTemplateProps`.
 */
export interface CardDisplayFormTemplateProps {
  /**
   * The seed this form was built from is not confirmed by the server yet
   * (AGL-4047): Update is held, and this sentence sits beside it while there
   * is something to save. Build it with `seedCheckingText` and decide it with
   * `isSeedChecking`, from `@aglyn/tenant-feature-instance/hooks/use-seed-edits`.
   *
   * A press then would wait on that confirmation and could end refused with
   * "We could not confirm your … with the server yet", the refusal that met
   * the first press after a page load. Held instead, it comes on the moment the
   * server answers, and the renderer's `keepDirtyOnReinitialize` keeps what
   * was typed through the new seed. Unset, the form behaves as it always has.
   */
  checkingText?: string
}

export const FormCardWrapper = forwardRef<
  any,
  CardDisplayProps & CardDisplayFormTemplateProps
>((props, ref) => {
  const { children, checkingText, ...rest } = props
  const { schema, handleSubmit } = useFormApi()
  const checking = Boolean(checkingText)

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
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Button
                  loading={validating || submitting}
                  color="primary"
                  disabled={
                    submitting || pristine || !valid || validating || checking
                  }
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
                {!pristine && checking ? (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    role="status"
                  >
                    {checkingText}
                  </Typography>
                ) : null}
              </Stack>
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
})
FormCardWrapper.displayName = 'FormCardWrapper'

/** A submit that does nothing, for the form whose Update is held. */
const holdSubmit = (event: FormEvent<HTMLFormElement>) => event.preventDefault()

export const CardDisplayFormTemplate = forwardRef<
  any,
  FormTemplateRenderProps & CardDisplayFormTemplateProps
>((props, ref) => {
  const { formFields, schema, checkingText, ...rest } = props
  const { handleSubmit } = useFormApi()
  /**
   * Enter in a field submits the form without the button, so the hold has
   * to be here as well, or a held Update is one keystroke from the refusal
   * it holds off.
   */
  return (
    <FormCardWrapper checkingText={checkingText}>
      <form
        ref={ref}
        onSubmit={checkingText ? holdSubmit : handleSubmit}
        noValidate
        {...rest}
      >
        <Grid spacing={2} container>
          {formFields}
        </Grid>
      </form>
    </FormCardWrapper>
  )
})
CardDisplayFormTemplate.displayName = 'CardDisplayFormTemplate'

export default CardDisplayFormTemplate
