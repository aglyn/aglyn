/**
 * @license
 * Copyright 2026 Aglyn LLC
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

import { usePathname, useSearchParams } from 'next/navigation'
import type { ReactNode } from 'react'
import AuthenticatingLayout from '../../components/layouts/authenticating.layout'

/**
 * The signed-out shell (App Router route group, AGL-401): signin/signup/
 * signout all used `[AuthenticatingLayout]` in their Pages Router `.layouts`.
 * The Pages Router signout page passed `signingOut` as a layout prop; the
 * route group has no per-page props, so derive it from the pathname —
 * without it the layout treats a still-signed-in /signout visit as a
 * completed login and bounces it to the continue URL before signOut runs.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const verifyEmailPage = pathname?.startsWith('/verify-email')
  return (
    <AuthenticatingLayout
      signingOut={pathname?.startsWith('/signout')}
      // On /verify-email, keep a signed-in-but-unverified user put instead of
      // bouncing them into the app; a verified user still falls through to the
      // continue URL (AGL-479).
      requireEmailVerification={verifyEmailPage}
      // A one-shot code from an emailed link is being redeemed by the page
      // (AGL-1524). The layout must not navigate AT ALL while it is on the
      // URL: its continue-URL bounce for a verified session is a hard-ish
      // exit that can abort the apply mid-flight, and its bare
      // `/verify-email` push strips the code. The page owns every exit from
      // this state — success navigates itself, failure stays to show why.
      holdRedirects={verifyEmailPage && Boolean(searchParams?.get('oobCode'))}
    >
      {children}
    </AuthenticatingLayout>
  )
}
