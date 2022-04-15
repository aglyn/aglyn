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

import {LoadingTextComponent} from '@aglyn/shared-ui-jsx'
import {useNextPageTitle} from '@aglyn/shared-ui-next'
import {CircularProgress} from '@mui/material'
import {signOut} from 'firebase/auth'
import {useEffect} from 'react'
import {useAuth} from 'reactfire'
import AuthFormComponent from '../../components/auth-form.component'
import UnauthenticatedLayout from '../../components/layouts/unauthenticated.layout'


function SignOut() {
  useNextPageTitle({screen: 'Sign out'})

  const firebaseAuth = useAuth()

  useEffect(() => {
    void signOut(firebaseAuth)
  }, [firebaseAuth])

  return (
    <AuthFormComponent
      headingTop={'Signing out'}
      headingBottom={'Please wait'}
      headingBottomProps={{
        sx: {pb: 4},
        component: LoadingTextComponent,
      }}
      headingAfter={
        <CircularProgress color="secondary" />
      }
    />
  )
}
SignOut.displayName = 'Page:SignOut'
SignOut.layouts = [UnauthenticatedLayout]
SignOut.layoutProps = {
  UnauthenticatedLayout: {
    isSignOut: true,
  },
}

export default SignOut
