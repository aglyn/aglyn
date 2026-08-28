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

import OrgSellerPanel from '../../../../../../components/org-seller-panel.component'
import { useMarketplaceScope } from '../layout'

/**
 * Marketplace › Sales (AGL-2501).
 *
 * The seller ledger. Reads the org's REVENUE, so the sections layout
 * refuses the route outright for a member without publish permission.
 */
export default function MarketplaceSalesSection() {
  const { orgId } = useMarketplaceScope()
  if (!orgId) return null
  return <OrgSellerPanel orgId={orgId} section="sales" />
}
