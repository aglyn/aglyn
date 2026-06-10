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

import {
  BackgroundImageComponent,
  type BackgroundImageComponentProps,
} from '@aglyn/shared-ui-jsx'
import { mergeSxProps } from '@aglyn/shared-ui-theme'
import { useContinueUrl } from '@aglyn/shared-util-next'
import { Stack } from '@mui/material'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useSigninCheck } from 'reactfire'

export interface AuthenticatingLayoutProps
  extends Partial<BackgroundImageComponentProps> {
  requireEmailVerification?: boolean
  signingOut?: boolean
}

function AuthenticatingLayout(props: AuthenticatingLayoutProps) {
  const { children, sx, requireEmailVerification, signingOut, ...rest } = props
  const router = useRouter()
  const { status, data: signInCheckResult } = useSigninCheck()
  const authLoading = status === 'loading'
  const signedIn = signInCheckResult?.signedIn === true
  const emailVerified = signInCheckResult?.user?.emailVerified
  const [, , pushContinued] = useContinueUrl()

  useEffect(() => {
    if (authLoading) return void 0
    if (signedIn && signingOut) return void 0
    if (!signedIn && !signingOut) return void 0
    if (signingOut) return void router.push('/signin')
    if (requireEmailVerification && !emailVerified)
      return void router.push('/validate-email')

    return void pushContinued('/')
  }, [
    authLoading,
    emailVerified,
    signingOut,
    pushContinued,
    requireEmailVerification,
    router,
    signedIn,
  ])

  return (
    <BackgroundImageComponent
      url="/_static/images/backgrounds/patterns/abstract-wave-lines.svg"
      sx={mergeSxProps(
        {
          minHeight: '100vh',
          bgcolor: 'background.default',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          p: { xs: 2, md: 3 },
          color: 'text.primary',
        },
        sx,
      )}
      {...rest}
    >
      <Stack
        direction="column"
        spacing={2}
        sx={{
          justifyContent: "center",
          alignItems: "center",
          maxWidth: 1,
          width: 440
        }}>
        {children}
      </Stack>
    </BackgroundImageComponent>
  );
}
AuthenticatingLayout.displayName = 'AuthenticatingLayout'
AuthenticatingLayout.aglyn = true

export { AuthenticatingLayout }
export default AuthenticatingLayout
