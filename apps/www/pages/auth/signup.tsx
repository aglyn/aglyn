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

import { AppLink } from '@aglyn/shared/ui/react'
import { createStyles, Theme, WithStyles, withStyles } from '@aglyn/shared/ui/themes'
import { remap } from '@aglyn/shared/util/tools'
import { Box, Button, Typography } from '@mui/material'
import { useRouter } from 'next/router'
import React from 'react'
import FieldSet from '../../components/FieldSet'
import { withAppContext } from '../../contexts/app-context'
import { Fields, formIsValid, validateField } from '../../forms'
import AuthLayout from '../../layouts/AuthLayout'


const styles = (theme: Theme) => createStyles({
  form: {'& .MuiTextField-root': {}},
  uppercase: {textTransform: 'uppercase'},
  button: {
    marginTop: theme.spacing(2),
    marginBottom: theme.spacing(2),
  },
  bottom: {
    lineHeight: 1.5,
    marginTop: theme.spacing(4),
  },
})

type Props = {}

export default withStyles(styles, {name: 'Page:SignUp'})(
  withAppContext<Props & WithStyles<typeof styles>>(
    function SignUp(props) {
      const {app, classes} = props
      const currentUser = app?.getCurrentUser()
      // console.log('app?.getCurrentUser()', currentUser)
      const router = useRouter()
      if (currentUser) {
        router.push('/')
      }

      const [submitting, setSubmitting] = React.useState(false)
      const [formError, setFormError] = React.useState(null)
      const [fields, setFields] = React.useState<Fields.FieldGroup>({
        [Fields.firstNameField.id]: Fields.firstNameField,
        [Fields.lastNameField.id]: Fields.lastNameField,
        [Fields.emailField.id]: Fields.emailField,
        [Fields.passwordField.id]: Fields.passwordField,
      })

      const handleUpdate = (name: string) => e => {
        const value = e.target?.value
        setFields(prev => ({...prev, [name]: validateField(prev[name], value)}))
      }
      const clearForm = () => {
        setFields(prev => {
          return remap(prev, (value) => {
            value.value = ''
            return value
          })
        })
      }

      const onSubmit = React.useCallback(async (e) => {
        e.preventDefault()
        setSubmitting(true)
        setFormError(null)
        const isValid = formIsValid(fields)

        if (!isValid) {
          setFormError('Form is invalid')
          setSubmitting(false)
          return
        }

        await app?.signUpUser(
          fields.email.value,
          fields.password.value,
          (user) => {
            console.debug('Sign Up: ', user)
            clearForm()
            setSubmitting(false)
          },
          (error) => {
            console.error('Form Error: ', error)
            const {code, message} = error
            setFormError(`(Code: ${code}) ${message}`)
            clearForm()
            setSubmitting(false)
          },
        )
      }, [fields])

      return (
        <AuthLayout text="Create a New Account">
          <form autoComplete="on" className={classes.form} onSubmit={onSubmit}>
            <div>
              <Typography
                children="Fill in your details"
                className={classes.uppercase}
                variant="h5"
                gutterBottom
              />
              <FieldSet fields={fields} loading={submitting} onUpdate={handleUpdate}/>
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
            <b children={'Already have an account?'}/>
            <br/>
            <AppLink
              children="Sign in instead"
              color="secondary"
              href="/auth/signin"
            />
          </Typography>
        </AuthLayout>
      )
    },
  ),
)
