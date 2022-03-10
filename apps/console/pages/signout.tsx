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
import CircularProgress from '@mui/material/CircularProgress'
import {signOut} from 'firebase/auth'
import {useEffect} from 'react'
import {useAuth} from 'reactfire'
import LayoutAuthFormComponent from '../layouts/layout-auth-form.component'
import LayoutUnauthenticatedComponent from '../layouts/layout-unauthenticated.component'


function SignOut() {

  const firebaseAuth = useAuth()

  useEffect(() => {
    void signOut(firebaseAuth)
  }, [firebaseAuth])

  return (
    <LayoutAuthFormComponent
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
SignOut.layoutComponent = LayoutUnauthenticatedComponent
SignOut.layoutProps = {
  LayoutUnauthenticatedComponent: {
    isSignOut: true,
  },
}

export default SignOut
