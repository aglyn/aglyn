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

import { Stack } from '@mui/material'
import ApprovedImageHostsCard from './approved-image-hosts-card.component'

export interface SiteSecurityCardsProps {
  hostId: string
}

/**
 * The six lists an owner can widen the site's Content-Security-Policy with
 *.
 *
 * Lifted out of the Setup page so it can live on ADMIN, where the permission
 * already was: every one of these fields is `hostMemberRole(hostId) ==
 * 'admin'` in the Firestore rules, so an editor opening this on Setup saw a
 * page of controls they could not write. A surface whose permission and whose
 * placement disagree teaches people that refusals are arbitrary.
 *
 * Each card stores its own `host` array and the tenant reads the same names
 * off the lockdown verdict — a control whose field the middleware does not
 * read is a switch wired to nothing.
 */
export function SiteSecurityCards(props: SiteSecurityCardsProps) {
  const { hostId } = props
  return (
    <Stack spacing={3}>
      <ApprovedImageHostsCard hostId={hostId} />
      <ApprovedImageHostsCard
        hostId={hostId}
        field="approvedMediaHosts"
        header="Approved media hosts"
        description="Video and audio your pages play from somewhere other than this site. Your own uploads always work — this is only for media you point at by URL."
        emptyHint="No external hosts approved. Pages can still play every file you upload here."
        placeholder="videos.example.com"
        privacyNote="Every host here can see the IP address of anyone who visits your site, because their browser fetches the media directly."
      />
      <ApprovedImageHostsCard
        hostId={hostId}
        field="approvedFontHosts"
        header="Approved font hosts"
        description="Web fonts your pages load from somewhere other than this site. Fonts you upload always work — this is only for fonts served by another host."
        emptyHint="No external hosts approved. Pages can still use every font you upload here."
        placeholder="fonts.gstatic.com"
        privacyNote="Every host here can see the IP address of anyone who visits your site, because their browser fetches the font directly — which is why a self-hosted font is the private option."
      />
      <ApprovedImageHostsCard
        hostId={hostId}
        field="approvedFormActions"
        header="Approved form destinations"
        description="Where your forms may submit to. Forms handled by this site always work — this is only for forms that post to another service."
        emptyHint="No external destinations approved. Forms can still post to this site."
        placeholder="forms.example.com"
        privacyNote="A form posts whatever the visitor typed. Approving a destination sends that data to it directly, so add one only if you intend it to receive submissions."
      />
      {/* Embeds and connections. These two govern the
          Custom HTML block as well as the site's own
          runtime: a browser applies the page's policy
          inside a `srcdoc` iframe too, so a pasted widget
          that calls out to its own service needs its host
          approved under Connections. */}
      <ApprovedImageHostsCard
        hostId={hostId}
        field="approvedFrameHosts"
        header="Approved embeds"
        description="Other sites your pages may embed in a frame — a map, a booking widget, a player we don't build in. YouTube, Vimeo and checkout already work without being listed."
        emptyHint="No external embeds approved. The built-in video, plugin and checkout embeds still work."
        placeholder="calendar.example.com"
        privacyNote="An embedded page sees the IP address of everyone who visits yours, and can set its own cookies in their browser."
      />
      <ApprovedImageHostsCard
        hostId={hostId}
        field="approvedConnectHosts"
        header="Approved connections"
        description="Services your pages may send requests to in the background — an embedded widget calling its own API, for example. Your own forms, analytics and checkout already work without being listed."
        emptyHint="No external connections approved. Everything this site does on its own still works."
        placeholder="api.example.com"
        privacyNote="A connection can carry anything the page has, including what a visitor typed. Approve a host only if you meant to send it data."
      />
    </Stack>
  )
}
SiteSecurityCards.displayName = 'SiteSecurityCards'

export default SiteSecurityCards
