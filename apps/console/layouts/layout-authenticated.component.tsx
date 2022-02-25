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
import {type ReactNode, useEffect} from 'react'
import {useAuthState} from 'react-firebase-hooks/auth'
import SecureLoadingOverlayComponent from '../components/secure-loading-overlay.component'


const firebaseAuth = getFirebaseAuth()

export interface LayoutAuthenticatedComponentProps {
  children?: ReactNode
}

function LayoutAuthenticatedComponent(props: LayoutAuthenticatedComponentProps) {
  const {children, ...rest} = props
  const [user, authLoading, error] = useAuthState(firebaseAuth)
  const {queueLoading} = useLoading()
  const router = useRouter()
  const continueRoute = useContinueQueryEncoded()

  useEffect(() => {
    // const dequeueLoading = authLoading ? queueLoading() : null
    return () => {
      // dequeueLoading && dequeueLoading()
    }
  }, [authLoading, queueLoading])

  useEffect(() => {
    console.log('loc', location)
    console.log('base64', continueRoute)
    if (!user && !authLoading) {
      const dequeueLoading = queueLoading()
      router
        .push(`/signin?continue=${continueRoute}`)
        .finally(() => {
          dequeueLoading && dequeueLoading()
        })
    }
  }, [user, authLoading, continueRoute, queueLoading, router])


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
