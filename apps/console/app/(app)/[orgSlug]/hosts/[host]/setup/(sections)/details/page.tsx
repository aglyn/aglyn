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
import BuiltInPageLayoutCard from '../../../../../../../../components/built-in-page-layout-card.component'
import ErrorScreensCard from '../../../../../../../../components/error-screens-card.component'
import LanguagesCard from '../../../../../../../../components/languages-card.component'
import LogoCard from '../../../../../../../../components/logo-card.component'
import { useHostSettingsScope } from '../../../host-settings-scope'

/**
 * What the site presents to a visitor: its mark, the details its tokens read
 * from, its error screens and its languages.
 *
 * The site's own NAME and ADDRESS are not here. Those describe the site as an
 * object rather than as an experience, so the Basic details form lives in the
 * Admin hub's General section beside the custom domain it points at. Backup,
 * restore and publishing a template moved with them, to Admin's Backup &
 * template: a restore writes documents into the host, and a template
 * distributes the whole site.
 *
 * Delete site is NOT here either: it moved to the host Admin area's Danger
 * zone (AGL-1014), so destructive actions no longer sit in a page
 * collaborators otherwise have reason to visit. Designable auth screens moved
 * to the User Accounts plugin's per-site page (AGL-428/1014) — they designate
 * screens that exist only while that plugin is on, so they are settings OF the
 * plugin.
 */
export default function HostSetupDetailsSection() {
  const { hostId } = useHostSettingsScope()
  return (
    <>
      {/* Site brand mark (AGL-594): shown by the tenant's navigation loader. */}
      <div>
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
      {/* Next to the error pages on purpose (AGL-2513): both answer "what do
          visitors see on a page I did not design?" */}
      <div style={{ marginTop: 24 }}>
        <BuiltInPageLayoutCard hostId={hostId} />
      </div>
      <div style={{ marginTop: 24 }}>
        <LanguagesCard hostId={hostId} />
      </div>
    </>
  )
}
