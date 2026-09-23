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

import { isSameOriginPath } from '@aglyn/shared-util-http/safe-redirect'
import { useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import { NOT_FOUND_FROM_PARAM } from '../constants/console-routes'
import AuthenticatedLayout from './layouts/authenticated.layout'
import MainLayout from './layouts/main.layout'
import NotFoundContent from './not-found-content.component'

/**
 * Put the address the visitor asked for back in the address bar (AGL-3290).
 *
 * They reach `/_missing` because the address they typed cannot be served, not
 * because they asked for this one — so once they are here, the bar shows what
 * they typed, and a copy of it is the address that was wrong rather than an
 * internal route. Only a same-origin path is ever written: `from` is a query
 * parameter anyone can set, and `replaceState` onto another origin throws.
 *
 * Mounted inside the signed-in shell on purpose. A signed-out visitor is sent
 * to sign in with the CURRENT address as the `continue`, and that has to stay
 * `/_missing`: the typed address is refused every time it is requested.
 */
export function RestoreRequestedAddress() {
  const searchParams = useSearchParams()
  const from = searchParams?.get(NOT_FOUND_FROM_PARAM) ?? ''
  useEffect(() => {
    if (!isSameOriginPath(from)) return
    window.history.replaceState(null, '', from.trim())
  }, [from])
  return null
}
RestoreRequestedAddress.displayName = 'RestoreRequestedAddress'

/**
 * The console's not-found page for an address that names no workspace
 * (AGL-3290): the same chrome and body as the root not-found boundary, so a
 * signed-out visitor is sent to sign in and a signed-in one sees the page
 * inside the console.
 */
export default function MissingAddressScreen() {
  return (
    <AuthenticatedLayout>
      <MainLayout>
        <RestoreRequestedAddress />
        <NotFoundContent />
      </MainLayout>
    </AuthenticatedLayout>
  )
}
MissingAddressScreen.displayName = 'MissingAddressScreen'
