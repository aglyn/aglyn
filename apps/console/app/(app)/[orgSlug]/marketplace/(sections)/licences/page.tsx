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

import OrgLicencesPanel from '../../../../../../components/org-licences-panel.component'
import { useMarketplaceScope } from '../layout'

/**
 * Marketplace › Licences (AGL-2501).
 *
 * What this workspace OWNS (AGL-2331). A purchase licenses an organization, so
 * "do we already own this, or was that the other client?" was a real question
 * the console could not answer anywhere. Beside Installed rather than inside
 * it, because a licence and an install are different things: an org can hold a
 * licence nobody has installed yet, and a member can install something they
 * never bought.
 */
export default function MarketplaceLicencesSection() {
  const { orgId, orgSlug } = useMarketplaceScope()
  return <OrgLicencesPanel orgId={orgId} orgSlug={orgSlug} />
}
