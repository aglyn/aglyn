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

import { useCallback, useEffect, useState } from 'react'
import BusinessDetailsCard from '../../../../../../../../components/business-details-card.component'
import BuiltInPageLayoutCard from '../../../../../../../../components/built-in-page-layout-card.component'
import { useHostSubdomain } from '../../../../../../../../components/host-id-provider'
import LanguagesCard from '../../../../../../../../components/languages-card.component'
import LogoCard from '../../../../../../../../components/logo-card.component'
import PluginWidgetSlot from '../../../../../../../../components/plugin-widget-slot.component'
import useCurrentOrg from '../../../../../../../../hooks/use-current-org'
import { useOrgSlug } from '../../../../../../../../hooks/use-org-scope'
import {
  hostIsBlankSite,
  hostStartedBlank,
  rememberHostStartedBlank,
} from '../../../../../../../../utils/host-first-run'
import { useHostSettingsScope } from '../../../host-settings-scope'

/**
 * What the site presents to a visitor: its mark, the details its tokens read
 * from, the layout behind its built-in pages, and its languages.
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
 *
 * ERROR PAGES are the newest absence (AGL-3178). The card that assigns a
 * screen per status code also carries maintenance mode, which replaces every
 * page for every visitor — site-wide in the way Delete site is final, and
 * squarely in the tier this page is not. It lives in the Admin hub's Error
 * pages section, beside Security.
 *
 * It is also where a site created a minute ago LANDS, which is why the
 * `hostFirstRun` zone is drawn at the top of it (AGL-2918). A widget there
 * offers to start the site from a few questions; taking `startBlank` leaves
 * this page exactly as it is below, which is the blank site the person
 * already has.
 *
 * ⚠️ LANDING HERE IS NOT THE SAME AS BELONGING HERE. A new site lands on this
 * page, but this page is the setup page of EVERY site, and for a while the
 * zone read the first fact as if it were the second: its only condition was
 * whether this browser had dismissed the offer, so opening Basic details on a
 * long-established site drew the guided start over the top of it. The zone
 * therefore asks two things now, and needs both — `hostIsBlankSite`, which is
 * about the SITE and is true for as long as it publishes nothing, and
 * `hostStartedBlank`, which is about this BROWSER and is true once somebody
 * here has said no. Neither one implies the other, and a condition on the
 * reader is never a condition on the site.
 */
export default function HostSetupDetailsSection() {
  const { hostId, data, hostHasEmitted } = useHostSettingsScope()
  const { orgId } = useCurrentOrg()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  /*
   * Starts closed and opens once the browser has been asked, so a reader who
   * skipped never sees the offer flash back on a reload. `localStorage` is not
   * readable while the page renders on the server.
   */
  const [unasked, setUnasked] = useState(false)
  useEffect(() => {
    setUnasked(Boolean(hostId) && !hostStartedBlank(hostId))
  }, [hostId])
  const startBlank = useCallback(() => {
    rememberHostStartedBlank(hostId)
    setUnasked(false)
  }, [hostId])
  /*
   * `hostHasEmitted` before `hostIsBlankSite`, because an unread document has
   * no `screens` either and would read as blank. Waiting for the snapshot the
   * layout is already subscribed to is what keeps an established site from
   * mounting the zone for the moment before its document lands — which on a
   * widget that takes the whole screen is the difference between not offering
   * and offering-then-snatching-away.
   */
  const offerStart = unasked && hostHasEmitted && hostIsBlankSite(data)
  return (
    <>
      {offerStart && (
        /* The zone carries its own gap from the cards below and takes no room
           at all when its widget drew nothing here — a widget that draws in a
           portal, or none at all. A wrapper with a margin of its own would
           leave that gap behind as a band above the first card. */
        <PluginWidgetSlot
          slot="hostFirstRun"
          hostId={hostId}
          orgId={orgId}
          orgSlug={orgSlug}
          host={host ?? null}
          startBlank={startBlank}
        />
      )}
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
      {/* The chrome around the pages the platform composes — search results,
          and a collection entry with no template of its own (AGL-2513). It
          answers "what do visitors see on a page I did not design?", which is
          the question Error pages answers for the status codes; it stays on
          Setup because a layout pick changes no address and takes nothing
          down. */}
      <div style={{ marginTop: 24 }}>
        <BuiltInPageLayoutCard hostId={hostId} />
      </div>
      <div style={{ marginTop: 24 }}>
        <LanguagesCard hostId={hostId} />
      </div>
    </>
  )
}
