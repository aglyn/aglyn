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

import OrgPublishPanel from '../../../../../../components/org-publish-panel.component'
import { useMarketplaceScope } from '../layout'

/**
 * Marketplace › Upload / Publish (AGL-693).
 *
 * Seller-gated in the sections layout, which refuses the route rather than
 * only hiding the rail entry — a route can be typed whether or not a tab was
 * ever offered. The publish API enforces the same permission server-side.
 */
export default function MarketplaceUploadSection() {
  const { orgId, hostList } = useMarketplaceScope()
  if (!orgId) return null
  return <OrgPublishPanel orgId={orgId} hosts={hostList} />
}
