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
import { Stack } from '@mui/material'
import AccountEmailsCard from '../../../../../../components/account-emails-card.component'
import ProductUpdatesCard from '../../../../../../components/account/product-updates-card.component'

/**
 * Every address on the account, which one is primary — and what the platform
 * may send to it (AGL-3185). The product-updates switch sits under the
 * addresses because the two are one question from the reader's side: where
 * mail goes, and whether it should.
 */
const AccountEmails: NextPageWithLayout<Record<string, never>> = () => (
  <Stack spacing={3}>
    <AccountEmailsCard />
    <ProductUpdatesCard />
  </Stack>
)
AccountEmails.displayName = 'Page:AccountEmails'

export default AccountEmails
