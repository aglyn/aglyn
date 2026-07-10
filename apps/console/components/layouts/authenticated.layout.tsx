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

import { SplashScreen, useLoading } from '@aglyn/shared-ui-jsx'
import { continueParam, useContinueUrl } from '@aglyn/shared-util-next'
import { useRouter } from 'next/navigation'
import { Fragment, useEffect } from 'react'
import { useSigninCheck } from '@aglyn/tenant-feature-instance'

export interface AuthenticatedLayoutProps {
  children?: JSX.Children
  requireEmailVerification?: boolean
}

function AuthenticatedLayout(props: AuthenticatedLayoutProps) {
  const { children, requireEmailVerification } = props
  const { queueLoading } = useLoading()
  const router = useRouter()
  const [next] = useContinueUrl()
  const { status, data: signInCheckResult } = useSigninCheck()
  const authLoading = status === 'loading'
  const signedIn = signInCheckResult?.signedIn === true
  const emailVerified = signInCheckResult?.user?.emailVerified
  const invalidAuth =
    authLoading || !signedIn || (requireEmailVerification && !emailVerified)

  useEffect(() => {
    if (authLoading) return void 0
    if (!signedIn) return void pushToRequestAuth(`/signin`)
    if (requireEmailVerification && !emailVerified)
      return void pushToRequestAuth(`/verify-email`)

    return void 0

    function pushToRequestAuth(path: string) {
      return void router.push(`${path}?${continueParam(next)}`)
    }
  }, [
    authLoading,
    next,
    emailVerified,
    queueLoading,
    requireEmailVerification,
    router,
    signedIn,
  ])

  return <Fragment>{!invalidAuth ? children : <SplashScreen />}</Fragment>
}
AuthenticatedLayout.displayName = 'AuthenticatedLayout'
AuthenticatedLayout.aglyn = true

export { AuthenticatedLayout }
export default AuthenticatedLayout
