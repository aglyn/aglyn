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
import {mergeSxProps} from '@aglyn/shared-feature-themes'
import {BackgroundImageComponent, type BackgroundImageComponentProps} from '@aglyn/shared-ui-jsx'
import {useContinueQueryDecoded} from '@aglyn/shared-util-next'
import {useRouter} from 'next/router'
import {useEffect, useState} from 'react'
import {useAuthState} from 'react-firebase-hooks/auth'


const firebaseAuth = getFirebaseAuth()

export interface LayoutRequestAuthenticationProps extends Partial<BackgroundImageComponentProps> {
  requireEmailVerification?: boolean
}

function LayoutUnauthenticatedComponent(props: LayoutRequestAuthenticationProps) {
  const {
    children,
    sx,
    requireEmailVerification,
    ...rest
  } = props
  const router = useRouter()
  const [user, userAuthLoading] = useAuthState(firebaseAuth)
  const [, pushContinue] = useContinueQueryDecoded()
  const [redirecting, setRedirecting] = useState(false)

  useEffect(() => {
    if (!user || userAuthLoading || redirecting) return void 0

    if (!requireEmailVerification || user.emailVerified) {
      return void pushContinueOrHome()
    }

    return void 0

    async function pushContinueOrHome() {
      setRedirecting(true)
      await pushContinue('/')
        .then((success) => {
          if (!success) {
            console.warn('Redirecting following user identity confirmed')
          }
        })
        .catch((error) => {
          console.error(error)
        })
        .finally(() => {
          setRedirecting(false)
        })
    }
  }, [user, userAuthLoading, redirecting, pushContinue, requireEmailVerification])

  return (
    <BackgroundImageComponent
      url="/_static/images/backgrounds/patterns/abstract-wave-lines.svg"
      sx={mergeSxProps({
        minHeight: '100vh',
        bgcolor: 'background.default',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        p: {p: 2, md: 3},
        color: 'text.primary',
      }, sx)}
      {...rest}
    >

      {children}

    </BackgroundImageComponent>
  )
}
LayoutUnauthenticatedComponent.displayName = 'LayoutUnauthenticatedComponent'

export {LayoutUnauthenticatedComponent}
export default LayoutUnauthenticatedComponent
