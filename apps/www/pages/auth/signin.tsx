/**
 * @license
 * Copyright 2024 Aglyn LLC
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
'use client'

import { AppLink } from '@aglyn/shared-ui-jsx'
import { objectRemap } from '@aglyn/shared-util-tools'
import { Box, Button, Typography } from '@mui/material'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import FieldSet from '../../components/FieldSet'
import { withAppContext } from '../../contexts/app-context'
import { Fields, formIsValid, validateField } from '../../forms'
import AuthLayout from '../../layouts/AuthLayout'

interface Props {}

export default withAppContext<Props>(function SignIn(props) {
  const { app } = props
  const currentUser = app?.getCurrentUser?.()
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

  const handleUpdate = (name: string) => (e) => {
    const value = e.target?.value
    setFields((prev) => ({ ...prev, [name]: validateField(prev[name], value) }))
  }
  const clearForm = () => {
    setFields((prev) => {
      return objectRemap(prev, (value) => {
        value.value = ''
        return value
      })
    })
  }
  const onSubmit = useCallback(
    async (e) => {
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
    },
    [fields],
  )

  return (
    <AuthLayout text="Sign In to your Account">
      <form autoComplete="on" onSubmit={onSubmit}>
        <div>
          <Typography
            children="Enter your credentials"
            variant="h5"
            gutterBottom
            sx={{ textTransform: 'uppercase' }}
          />
          <FieldSet
            fields={fields}
            loading={submitting}
            onUpdate={handleUpdate}
          />
          <AppLink
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
                <b>{'Error: '}</b>
                {formError}
              </Typography>
            </Box>
          )}
          <Button
            children={submitting ? 'Please wait...' : 'Continue'}
            color="secondary"
            disabled={Boolean(submitting)}
            size="large"
            type="submit"
            variant="contained"
            fullWidth
            sx={{ my: 2 }}
          />
        </div>
      </form>
      <Typography
        align="center"
        color="primary"
        component="div"
        variant="overline"
        sx={{ lineHeight: 1.5, marginTop: 4 }}
      >
        <b children={"Don't have an account?"} />
        <br />
        <AppLink
          children="Create an account"
          color="secondary"
          href="/auth/signup"
        />
      </Typography>
    </AuthLayout>
  )
})
