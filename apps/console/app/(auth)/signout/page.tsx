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

'use client'

import { APP_CONSOLE } from '@aglyn/shared-data-enums'
import { LoadingTextComponent } from '@aglyn/shared-ui-jsx'
import { useNextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import { CircularProgress } from '@mui/material'
import { signOut } from 'firebase/auth'
import { useEffect } from 'react'
import { useAuth } from '@aglyn/tenant-feature-instance'
import AuthFormComponent from '../../../components/auth-form.component'
import AuthenticatingLayout from '../../../components/layouts/authenticating.layout'
import { markInteractiveSignOut } from '../../../utils/interactive-signin'

function SignOut() {
  useNextPageTitle({
    screen: 'Sign out',
    suffix: APP_CONSOLE.AFFIX,
    separator: ` ${APP_CONSOLE.SEP} `,
  })

  const firebaseAuth = useAuth()

  useEffect(() => {
    void (async () => {
      // This sign-out is intentional — mark it so useSessionCookie's
      // auth-null handler propagates it instead of treating it as an
      // SDK hiccup to recover from (AGL-543).
      markInteractiveSignOut()
      // The shared workspace cookie dies FIRST (AGL-236): waiting on the
      // DELETE before signOut means neither a hard navigation nor an
      // in-flight mint can strand a live cookie that would silently
      // re-sign-in every subdomain.
      await fetch('/api/auth/session', { method: 'DELETE' }).catch(
        () => undefined,
      )
      await signOut(firebaseAuth)
    })()
  }, [firebaseAuth])

  return (
    <AuthFormComponent
      headingTop={'Signing out'}
      headingBottom={'Please wait'}
      headingBottomProps={{
        sx: { pb: 4 },
        component: LoadingTextComponent,
      }}
      headingAfter={<CircularProgress color="secondary" />}
    />
  )
}
SignOut.displayName = 'Page:SignOut'

export default SignOut
