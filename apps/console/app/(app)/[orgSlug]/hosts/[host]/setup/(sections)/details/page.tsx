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

import BusinessDetailsCard from '../../../../../../../../components/business-details-card.component'
import ErrorScreensCard from '../../../../../../../../components/error-screens-card.component'
import LanguagesCard from '../../../../../../../../components/languages-card.component'
import LogoCard from '../../../../../../../../components/logo-card.component'
import SiteBackupCard from '../../../../../../../../components/site-backup-card.component'
import SiteTemplateCard from '../../../../../../../../components/site-template-card.component'
import { SetupForm, useSetupScope } from '../layout'

/**
 * Basic details — the site's name and address, and the cards that belong with
 * them (AGL-2501).
 *
 * Delete site is NOT here: it moved to the host Admin area's Danger zone
 * (AGL-1014), so destructive actions no longer sit in a page collaborators
 * otherwise have reason to visit. Designable auth screens moved to the User
 * Accounts plugin's per-site page (AGL-428/1014) — they designate screens that
 * exist only while that plugin is on, so they are settings OF the plugin.
 */
export default function HostSetupDetailsSection() {
  const { hostId } = useSetupScope()
  return (
    <>
      <SetupForm schemaId="hostDetails" />
      {/* Site brand mark (AGL-594): shown by the tenant's navigation loader. */}
      <div style={{ marginTop: 24 }}>
        <LogoCard hostId={hostId} />
      </div>
      {/* Contact details `host.*` tokens read from (AGL-1022) — without these
          the tokens resolve empty forever and teach people the feature does
          not work. */}
      <div style={{ marginTop: 24 }}>
        <BusinessDetailsCard hostId={hostId} />
      </div>
      <div style={{ marginTop: 24 }}>
        <ErrorScreensCard hostId={hostId} />
      </div>
      <div style={{ marginTop: 24 }}>
        <LanguagesCard hostId={hostId} />
      </div>
      <div style={{ marginTop: 24 }}>
        <SiteBackupCard hostId={hostId} />
      </div>
      <div style={{ marginTop: 24 }}>
        <SiteTemplateCard hostId={hostId} />
      </div>
    </>
  )
}
