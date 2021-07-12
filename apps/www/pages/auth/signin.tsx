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

import { mapObject } from '@aglyn/shared/util/helpers'
import React, { useCallback, useState } from 'react'
import { makeStyles, Theme, createStyles, withStyles, WithStyles } from '@material-ui/core/styles'
import { Button, Typography, Box } from '@material-ui/core'
import AuthLayout from '../../layouts/AuthLayout'
import Link from '../../components/Link'
import { withAppContext } from '../../contexts/app-context'
import { Fields, validateField, formIsValid, fieldHasError } from '../../forms'
import FieldSet from '../../components/FieldSet'
import { useRouter } from 'next/router'


const styles = (theme: Theme) => createStyles({
  form: { '& .MuiTextField-root': {} },
  uppercase: { textTransform: 'uppercase' },
  button: {
    marginTop: theme.spacing(2),
    marginBottom: theme.spacing(2),
  },
  bottom: {
    lineHeight: 1.5,
    marginTop: theme.spacing(4),
  },
})

export default withStyles(styles, { name: 'Page:SignIn' })(
  withAppContext<WithStyles<typeof styles>>(
    function SignIn(props) {
      const { app, classes } = props
      const currentUser = app?.getCurrentUser()
      // console.log('app?.getCurrentUser()', currentUser)
      const router = useRouter()
      if (currentUser) {
        router.push('/')
      }

      const [submitting, setSubmitting] = useState(false)
      const [formError, setFormError] = useState(null)
      const [fields, setFields] = useState<Fields.FieldGroup>({
        [Fields.emailField.id]: Fields.emailField,
        [Fields.passwordField.id]: Fields.passwordField,
      })

      const handleUpdate = (name: string) => e => {
        const value = e.target?.value
        setFields(prev => ({ ...prev, [name]: validateField(prev[name], value) }))
      }
      const clearForm = () => {
        setFields(prev => {
          return mapObject(prev, (value) => {
            value.value = ''
            return value
          }, { copy: true }) as any
        })
      }
      const onSubmit = useCallback(async (e) => {
        e.preventDefault()
        setSubmitting(true)
        setFormError(null)
        const isValid = formIsValid(fields)

        if (!isValid) {
          setFormError('Form is invalid')
          setSubmitting(false)
          return
        }

        await app?.signInUser(
          fields.email.value,
          fields.password.value,
          (user) => {
            console.debug('Sign In: ', user)
            clearForm()
            setSubmitting(false)
          },
          (error) => {
            console.error('Form Error: ', error)
            const { code, message } = error
            setFormError(`(Code: ${code}) ${message}`)
            clearForm()
            setSubmitting(false)
          },
        )
      }, [fields])

      return (
        <AuthLayout text="Sign In to your Account">
          <form autoComplete="on" className={classes.form} onSubmit={onSubmit}>
            <div>
              <Typography
                children="Enter your credentials"
                className={classes.uppercase}
                variant="h5"
                gutterBottom
              />
              <FieldSet fields={fields} loading={submitting} onUpdate={handleUpdate} />
              <Link
                children="Forgot password?"
                color="primary"
                href="/auth/recovery"
              />
              {formError && (
                <Box
                  bgcolor={'error.light'}
                  border={2}
                  borderColor={'error.main'}
                  borderRadius={3}
                  color={'error.contrastText'}
                  my={2}
                  px={2}
                  py={2}
                >
                  <Typography>
                    <b>{'Error: '}</b>{formError}
                  </Typography>
                </Box>
              )}
              <Button
                children={submitting ? 'Please wait...' : 'Continue'}
                className={classes.button}
                color="secondary"
                disabled={Boolean(submitting)}
                size="large"
                type="submit"
                variant="contained"
                fullWidth
              />
            </div>
          </form>
          <Typography
            align="center"
            className={classes.bottom}
            color="primary"
            component="div"
            variant="overline"
          >
            <b children={'Don\'t have an account?'} />
            <br />
            <Link
              children="Create an account"
              color="secondary"
              href="/auth/signup"
            />
          </Typography>
        </AuthLayout>
      )
    }
  )
)
