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

import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import AccountSecurityCard from '../../../../../../components/account/account-security-card.component'
import { DEFAULT_ACCOUNT_SECTION_HREF } from '../../../../../../constants/account-sections'
import useAccountSignInMethods from '../../../../../../hooks/use-account-sign-in-methods'

/**
 * Password, passkeys and recent sign-ins — for the accounts they apply to.
 *
 * As a panel this section simply was not built for an SSO-governed account
 * with no password: there is no password to change, passkeys are project-pool
 * only, and the customer's IdP owns the credentials. As a route it can be
 * reached directly — a bookmark, the security-alert email's `?tab=security`
 * link, or a typed URL — so it has to answer for itself rather than render an
 * empty shell with a heading and nothing under it.
 *
 * The rail hides the section for the same accounts, off the same answer. This
 * is the half that survives someone arriving without using the rail.
 *
 * `replace`, not `push`: bouncing off a section that does not apply must not
 * leave a history entry that sends Back straight into it again.
 */
const AccountSecurity: NextPageWithLayout<Record<string, never>> = () => {
  const router = useRouter()
  const { securityApplies } = useAccountSignInMethods()
  useEffect(() => {
    if (securityApplies) return
    router.replace(DEFAULT_ACCOUNT_SECTION_HREF)
  }, [router, securityApplies])
  return securityApplies ? <AccountSecurityCard /> : null
}
AccountSecurity.displayName = 'Page:AccountSecurity'

export default AccountSecurity
