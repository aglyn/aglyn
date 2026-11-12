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
import {
  type HeldSave,
  useHeldSave,
} from '@aglyn/tenant-feature-instance/hooks/use-seed-edits'

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
   *
   * A press during the hold is KEPT (`useHeldSave`): Update says "Saving…" at
   * once and submits when the seed is confirmed, with the re-initialized
   * values. If no confirmation comes in the guard's wait, the guard's refusal
   * shows beside the button and nothing is submitted.
   */
  checkingText?: string
  /**
   * What the form saves, as its guard names it ("business profile"), for the
   * refusal a kept press can end in. Unset, the refusal names "your changes".
   */
  checkingSubject?: string
}

interface HeldProps {
  /** The template's kept press, shared by the button and Enter. */
  held?: HeldSave
}

export const FormCardWrapper = forwardRef<
  any,
  CardDisplayProps & CardDisplayFormTemplateProps & HeldProps
>((props, ref) => {
  const { children, checkingText, checkingSubject, held, ...rest } = props
  const { schema, handleSubmit } = useFormApi()
  const checking = Boolean(checkingText)
  // The wrapper on its own (not under the template) keeps its own press.
  const own = useHeldSave(handleSubmit, {
    checking,
    subject: checkingSubject,
  })
  const save = held ?? own

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
                  // Not `loading` for a kept press: a loading Button hides its
                  // label, and the press is answered by the words "Saving…".
                  loading={validating || submitting}
                  color="primary"
                  disabled={
                    submitting ||
                    pristine ||
                    !valid ||
                    validating ||
                    save.saving
                  }
                  // style={{ marginRight: 8 }}
                  type="submit"
                  onClick={(event) => {
                    // The press is the template's, kept through a hold; the
                    // form's own submit would bypass it.
                    event.preventDefault()
                    save.press()
                  }}
                  // variant="contained"
                >
                  <Switch>
                    <Case condition={save.saving && !submitting}>
                      {'Saving…'}
                    </Case>
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
                {!pristine && save.refusal ? (
                  <Typography variant="body2" color="warning.main" role="alert">
                    {save.refusal}
                  </Typography>
                ) : !pristine && checking ? (
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

export const CardDisplayFormTemplate = forwardRef<
  any,
  FormTemplateRenderProps & CardDisplayFormTemplateProps
>((props, ref) => {
  const { formFields, schema, checkingText, checkingSubject, ...rest } = props
  const { handleSubmit } = useFormApi()
  const held = useHeldSave(handleSubmit, {
    checking: Boolean(checkingText),
    subject: checkingSubject,
  })
  /**
   * Enter in a field submits the form without the button, so it goes through
   * the same kept press, or a held Update would be one keystroke from the
   * refusal the hold exists to avoid.
   */
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    held.press()
  }
  return (
    <FormCardWrapper
      checkingText={checkingText}
      checkingSubject={checkingSubject}
      held={held}
    >
      <form ref={ref} onSubmit={onSubmit} noValidate {...rest}>
        <Grid spacing={2} container>
          {formFields}
        </Grid>
      </form>
    </FormCardWrapper>
  )
})
CardDisplayFormTemplate.displayName = 'CardDisplayFormTemplate'

export default CardDisplayFormTemplate
