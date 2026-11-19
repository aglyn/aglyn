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

import { Suspense } from 'react'
import ConnectAppConsent from '../../../components/connect-app-consent.component'
import AuthenticatedLayout from '../../../components/layouts/authenticated.layout'

/**
 * `/oauth/authorize` — where an app such as Claude sends a person to connect
 * one of their workspaces (AGL-4225).
 *
 * Behind the normal console session: a signed-out visitor is sent through
 * sign-in by `AuthenticatedLayout`, which carries the whole address — path
 * AND query — as the continue URL (`continuePathFor`), so they come back here
 * with the app's request intact. An unverified email is sent to verify first,
 * exactly as for any console page.
 */
export default function ConnectAppPage() {
  return (
    <AuthenticatedLayout requireEmailVerification>
      <Suspense fallback={null}>
        <ConnectAppConsent />
      </Suspense>
    </AuthenticatedLayout>
  )
}
