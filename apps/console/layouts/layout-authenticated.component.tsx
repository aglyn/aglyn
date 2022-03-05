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

import {getFirebaseAuth} from '@aglyn/shared-feature-fbclient'
import {useLoading} from '@aglyn/shared-ui-jsx'
import {useContinueQueryEncoded} from '@aglyn/shared-util-next'
import {useRouter} from 'next/router'
import {type ReactNode, useEffect, useState} from 'react'
import {useAuthState} from 'react-firebase-hooks/auth'
import SecureLoadingOverlayComponent from '../components/secure-loading-overlay.component'


const firebaseAuth = getFirebaseAuth()

export interface LayoutAuthenticatedComponentProps {
  children?: ReactNode
  requireEmailVerification?: boolean
}

function LayoutAuthenticatedComponent(props: LayoutAuthenticatedComponentProps) {
  const {children, requireEmailVerification, ...rest} = props
  const [user, authLoading, error] = useAuthState(firebaseAuth)
  const {queueLoading} = useLoading()
  const router = useRouter()
  const [redirecting, setRedirecting] = useState(false)
  const continueRoute = useContinueQueryEncoded()

  console.log('LayoutAuthenticatedComponent', continueRoute)

  useEffect(() => {
    if (authLoading || redirecting) return void 0
    if (user && (!requireEmailVerification || user.emailVerified)) return void 0
    if (requireEmailVerification && !user.emailVerified) {
      return void pushToRequestAuth(`/verify-email`)
    }

    void pushToRequestAuth('/signin')

    return void 0

    async function pushToRequestAuth(path: string) {
      setRedirecting(true)
      await router.push(`${path}?continue=${continueRoute}`)
        .then((success) => {
          if (!success) {
            console.warn('Redirecting following user identity incomplete')
          }
        })
        .catch((error) => {
          console.error(error)
        })
        .finally(() => {
          setRedirecting(false)
        })
    }
  }, [user, authLoading, continueRoute, queueLoading, router, redirecting, requireEmailVerification])


  return (
    <>
      {authLoading || !user
        ? (<SecureLoadingOverlayComponent />)
        : children}
    </>
  )
}
LayoutAuthenticatedComponent.displayName = 'LayoutAuthenticatedComponent'

export {LayoutAuthenticatedComponent}
export default LayoutAuthenticatedComponent
