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

import {mergeSxProps} from '@aglyn/shared-feature-themes'
import {BackgroundImageComponent, type BackgroundImageComponentProps} from '@aglyn/shared-ui-jsx'
import {useContinueQueryDecoded} from '@aglyn/shared-util-next'
import {Stack} from '@mui/material'
import {useRouter} from 'next/router'
import {useEffect} from 'react'
import {useSigninCheck} from 'reactfire'
import LayoutFirebaseAppComponent from './layout-firebase-app.component'


export interface LayoutRequestAuthenticationProps extends Partial<BackgroundImageComponentProps> {
  requireEmailVerification?: boolean
  isSignOut?: boolean
}

function LayoutUnauthenticatedComponent(props: LayoutRequestAuthenticationProps) {
  const {
    children,
    sx,
    requireEmailVerification,
    isSignOut,
    ...rest
  } = props
  const router = useRouter()
  const {status, data: signInCheckResult} = useSigninCheck()
  const authLoading = status === 'loading'
  const signedIn = signInCheckResult?.signedIn === true
  const emailVerified = signInCheckResult?.user?.emailVerified
  const [, pushContinue] = useContinueQueryDecoded()

  useEffect(() => {
    if (authLoading) return void 0
    if (isSignOut && signedIn) return void 0
    if (!signedIn && !isSignOut) return void 0
    if (isSignOut) return void router.push('/signin')
    if (requireEmailVerification && !emailVerified) return void router.push('/validate-email')

    return void pushContinue('/')
  }, [
    authLoading,
    emailVerified,
    isSignOut,
    pushContinue,
    requireEmailVerification,
    router,
    signedIn,
  ])

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
        p: {xs: 2, md: 3},
        color: 'text.primary',
      }, sx)}
      {...rest}
    >
      <Stack
        direction="column"
        justifyContent="center"
        alignItems="center"
        spacing={2}
        maxWidth={1}
        width={440}
      >
        {children}
      </Stack>
    </BackgroundImageComponent>
  )
}
LayoutUnauthenticatedComponent.displayName = 'AglynLayoutUnauthenticated'
LayoutUnauthenticatedComponent.layoutComponent = LayoutFirebaseAppComponent

export {LayoutUnauthenticatedComponent}
export default LayoutUnauthenticatedComponent
