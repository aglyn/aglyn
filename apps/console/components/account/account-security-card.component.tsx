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

'use client'

import {
  FIELD_SCHEMA_PASSWORD,
  FIELD_SCHEMA_PASSWORD_CONFIRM,
  FIELD_SCHEMA_PASSWORD_OLD,
} from '@aglyn/shared-data-forms'
import { useLoading } from '@aglyn/shared-ui-jsx'
import {
  FormRenderer,
  FormSchema,
  simpleComponentMapper,
} from '@aglyn/shared-ui-jsx-forms'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useAuth, useUser } from '@aglyn/tenant-feature-instance'
import { Stack } from '@mui/material'
import { signInWithEmailAndPassword, updatePassword } from 'firebase/auth'
import { useCallback } from 'react'
import CardDisplayFormTemplate from '../card-display-form-template'
import PasskeysCard from '../passkeys-card.component'
import RecentSignInsCard from '../recent-sign-ins-card.component'
import { docsHelp } from '../../constants/docs-links'
import useAccountSignInMethods from '../../hooks/use-account-sign-in-methods'

const securitySchema: FormSchema = {
  id: 'security',
  title: 'Security',
  CardDisplayProps: {
    help: docsHelp('account', {
      anchor: '#resetting-your-password',
      excerpt:
        'Change your console password by confirming the current one first.',
    }),
  },
  fields: [
    FIELD_SCHEMA_PASSWORD_OLD,
    FIELD_SCHEMA_PASSWORD,
    FIELD_SCHEMA_PASSWORD_CONFIRM,
  ],
}

/**
 * Password, passkeys and recent sign-ins (AGL-662, AGL-2318).
 *
 * The Security section of Manage Account, its own component since the sections
 * became routes (AGL-2501). The password form appears only when there is a
 * password to change — `updatePassword` throws on an account that signs in
 * some other way — while passkeys and the sign-in history apply to every
 * project-pool account. Which accounts reach this at all is
 * `useAccountSignInMethods().securityApplies`, and the route guards on it.
 */
export function AccountSecurityCard() {
  const { data: user } = useUser()
  const firebaseAuth = useAuth()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const { hasPassword } = useAccountSignInMethods()

  const handleSecuritySave = useCallback(
    async (fields: any) => {
      const dequeueLoading = queueLoading()
      await signInWithEmailAndPassword(
        firebaseAuth,
        user.email,
        fields[FIELD_SCHEMA_PASSWORD_OLD.name],
      )
        .then(() => {
          return updatePassword(user, fields[FIELD_SCHEMA_PASSWORD.name])
        })
        .catch((e) => {
          enqueueSnackbar(`Error: ${JSON.stringify(e)}`, { variant: 'error' })
        })
        .finally(() => {
          dequeueLoading()
        })
    },
    [enqueueSnackbar, firebaseAuth, queueLoading, user],
  )

  return (
    <Stack spacing={3}>
      {hasPassword ? (
        <FormRenderer
          FormTemplate={CardDisplayFormTemplate}
          componentMapper={simpleComponentMapper}
          onSubmit={handleSecuritySave}
          schema={securitySchema}
          subscription={{ values: true }}
        />
      ) : null}
      <PasskeysCard />
      {/* The other half of the new-device email (AGL-2318). Below passkeys
          because that is the ACTION someone takes after reading a sign-in they
          do not recognise. */}
      <RecentSignInsCard />
    </Stack>
  )
}
AccountSecurityCard.displayName = 'AccountSecurityCard'

export default AccountSecurityCard
