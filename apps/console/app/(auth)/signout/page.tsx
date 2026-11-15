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

import { LoadingTextComponent } from '@aglyn/shared-ui-jsx/components/loading-text.component'
import { CircularProgress } from '@mui/material'
import { useEffect } from 'react'
import { useAuth } from '@aglyn/tenant-feature-instance'
import AuthFormComponent from '../../../components/auth-form.component'
import AuthenticatingLayout from '../../../components/layouts/authenticating.layout'
import { editHintClearUrl } from '../../../components/edit-hint-bounce.component'
import { endConsoleSession } from '../../../utils/end-console-session'

function SignOut() {
  const firebaseAuth = useAuth()

  useEffect(() => {
    // Read BEFORE signing out: the signed-out state removes the bounce stamp
    // this decision rests on. Comes back to /signin, where the layout would
    // have sent this page anyway, with the same query (`continue` included).
    const clearUrl = editHintClearUrl(
      `${window.location.origin}/signin${window.location.search}`,
    )
    // Marked as intentional (AGL-543), and the shared workspace cookie dies
    // FIRST (AGL-236), so neither a hard navigation nor an in-flight mint can
    // strand a live cookie that would silently re-sign-in every subdomain.
    // The same DELETE ends this browser's site edit bar server-side; the
    // trip through the tenant's clear route then expires its `.aglyn.app`
    // cookies (AGL-1842 follow-on).
    void endConsoleSession(firebaseAuth).then(() => {
      if (clearUrl) window.location.assign(clearUrl)
    })
  }, [firebaseAuth])

  return (
    <AuthFormComponent
      headingTop={'Signing out'}
      headingBottom={'Please wait'}
      headingBottomProps={{
        sx: { pb: 4 },
        component: LoadingTextComponent,
      }}
      headingAfter={<CircularProgress color="primary" />}
    />
  )
}
SignOut.displayName = 'Page:SignOut'

export default SignOut
