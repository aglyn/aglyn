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

import {
  type ConsolePluginPageProps,
  formSpamCaughtNotice,
  formSubmissionsPausedNotice,
  submissionMonthKey,
  visitorRecordRefusedCounterId,
  visitorRecordsPausedNotice,
} from '@aglyn/aglyn'
// A deep import, NOT the plugin barrel (AGL-1151): the barrel is the entry
// point the tenant's loader dynamically imports to activate the marketing
// plugin's SITE half, so a console card named there ships to every published
// page. The component path reaches the same module without crossing it.
import { default as HostCampaignsCard } from '@aglyn/plugins-marketing/components/campaigns-card'
import { HubSections } from '@aglyn/shared-ui-next'
import { useFirestore, useFirestoreDoc } from '@aglyn/tenant-feature-instance'
import { Alert, AlertTitle, Typography } from '@mui/material'
import { doc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import ContactsCard from './contacts-card.component'
import type { InboxConsoleSectionId } from './inbox-console-sections'
import SubmissionsCard from './submissions-card.component'

/**
 * The body of one inbox section, built only when that section is the one being
 * read (AGL-2501).
 *
 * A function rather than a map of nodes on purpose: a `Record<id, ReactNode>`
 * would CONSTRUCT all three every render, and each card opens its Firestore
 * listens on mount — which is the entire cost this page exists to stop paying.
 * Only the returned branch is ever built.
 */
function sectionBody(
  section: InboxConsoleSectionId,
  hostId: string,
): ReactNode {
  switch (section) {
    case 'submissions':
      return <SubmissionsCard hostId={hostId} />
    case 'contacts':
      return <ContactsCard hostId={hostId} />
    case 'campaigns':
      return <HostCampaignsCard hostId={hostId} />
    default:
      return null
  }
}

/**
 * Inbox (AGL-77/104/109 → AGL-395): form submissions reader, site members +
 * leads, and campaigns — owned by the inbox plugin and rendered by the shell's
 * generic plugin route. Depends on the marketing plugin for the borrowed
 * Campaigns section.
 *
 * Orders are NOT here. A sale is not something that arrived in an inbox, and
 * the card was nested inside the members section rather than carrying a tab of
 * its own — so the rail listed three sections while the page drew a fourth
 * subject. Commerce already owns it: `commerce-console-sections.ts` declares
 * an `orders` section that renders the same card.
 *
 * Sections are ROUTES (AGL-2501), following the hubs that migrated before it.
 * Here it IS a read saving as well as an addressing one: this page carried
 * `HubTabs lazy`, which mounts one panel but keeps every panel it has visited,
 * so a reader who looked at Members & leads and went back to Submissions held
 * both sections' listens open for the rest of the visit. A URL per section
 * makes the saving structural — the page builds one section's body and the
 * others do not exist to subscribe. What routing adds besides is that the URL
 * names the section: it is linkable, the back button walks sections, and the
 * breadcrumb says where you are.
 */
export function InboxConsolePage(props: ConsolePluginPageProps) {
  const { hostId, section, sections, basePath } = props
  const firestore = useFirestore()

  // Submissions this site's abuse ceiling refused (AGL-1655 → AGL-1666).
  //
  // Until this, the refusal existed in two places a site owner cannot see: a
  // counters document only Firestore's console renders, and one in-app
  // notification that `system.` bucket-muting can suppress at write time —
  // `notifyUsers` skips the batch entirely, so a muted owner's notification
  // is never created and cannot be recovered by unmuting. This surface is
  // the durable one, and it is a plain read of the same document the
  // dropped-contacts alert uses (AGL-891).
  const { data: refusedCounter } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId, 'counters', 'formSubmissionsRefused'),
    [firestore, hostId],
  )
  // Keyed by the month the SERVER wrote, via the shared helper — a key
  // derived differently here would read zero refusals on exactly the sites
  // being refused.
  const pausedNotice = formSubmissionsPausedNotice({
    refused: Number(refusedCounter?.[submissionMonthKey()] ?? 0),
    ceiling: Number(refusedCounter?.['ceiling']) || undefined,
  })

  // Bot submissions the honeypot caught (AGL-1831 → AGL-1836). The staff org
  // page has shown this number per host since AGL-1831; this is the same
  // count where the site's OWNER already looks, so "is my form being hit by
  // bots?" is answered by their own inbox instead of a support ticket. Same
  // client-unwritable counters document shape as the refusal counter above,
  // same host-admin read the rules already grant (AGL-1367), same shared
  // month key — and the shared sentence returns null below one catch, so a
  // quiet month renders nothing rather than a reassuring zero.
  const { data: spamCounter } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId, 'counters', 'formSubmissionsSpam'),
    [firestore, hostId],
  )
  const spamNotice = formSpamCaughtNotice({
    spam: Number(spamCounter?.[submissionMonthKey()] ?? 0),
  })

  // Sign-ups and leads this site's PLATFORM ceiling refused (AGL-1529).
  //
  // Same instrument as the form ceiling directly above and read the same way:
  // a client-unwritable counters document (AGL-1367) that host admins can
  // already read, keyed by the SERVER's month through the shared helper — a
  // key derived differently here would read zero refusals on exactly the
  // sites being refused. The counter id comes from the shared function for
  // the same reason: the writer is in `@aglyn/tenant-data-admin` and this is
  // the reader, and two spellings of one document id is a surface that
  // renders nothing forever.
  //
  // This is the surface that makes the ceiling SHIPPED rather than merely
  // implemented. Without it a refusal exists in two places a site owner
  // cannot see: a Firestore document only our console renders, and one
  // notification that `system.` bucket-muting can suppress at write time.
  const { data: membersRefusedCounter } = useFirestoreDoc<any>(
    () =>
      doc(
        firestore,
        'hosts',
        hostId,
        'counters',
        visitorRecordRefusedCounterId('siteMembers'),
      ),
    [firestore, hostId],
  )
  const membersPausedNotice = visitorRecordsPausedNotice({
    kind: 'siteMembers',
    refused: Number(membersRefusedCounter?.[submissionMonthKey()] ?? 0),
    ceiling: Number(membersRefusedCounter?.['ceiling']) || undefined,
  })
  const { data: leadsRefusedCounter } = useFirestoreDoc<any>(
    () =>
      doc(
        firestore,
        'hosts',
        hostId,
        'counters',
        visitorRecordRefusedCounterId('leads'),
      ),
    [firestore, hostId],
  )
  const leadsPausedNotice = visitorRecordsPausedNotice({
    kind: 'leads',
    refused: Number(leadsRefusedCounter?.[submissionMonthKey()] ?? 0),
    ceiling: Number(leadsRefusedCounter?.['ceiling']) || undefined,
  })

  /*
   * Nothing until the URL names a section. The shell redirects a bare hub URL
   * to the landing section and holds a spinner while it does, so this state is
   * transient — and rendering a default section here instead would pay for its
   * listens on a URL that is already being replaced.
   *
   * The four counter reads above run either way, and that is deliberate: they
   * are four single-document listens, and hoisting them behind this guard
   * would make a ceiling notice appear a frame late on the section a reader
   * lands on.
   */
  if (!section || !sections?.length || !basePath) return null

  return (
    <>
      {/* Above the RAIL on purpose (AGL-1666). A paused form is not a fact
          about the Submissions section — it is why the whole inbox stopped
          filling — and the notification that brings an owner here links to
          the surface, not to a section. Inside one section's body it would be
          invisible to anyone who followed a link into another. */}
      {pausedNotice ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <AlertTitle>{pausedNotice.title}</AlertTitle>
          <Typography component="div" variant="body2">
            {pausedNotice.message}
          </Typography>
          <Typography
            component="div"
            variant="body2"
            color="text.secondary"
            sx={{ mt: 0.5 }}
          >
            {pausedNotice.until}
          </Typography>
        </Alert>
      ) : null}
      {/* Beside the paused notice, and info rather than warning on purpose
          (AGL-1836): the honeypot count reports protection WORKING — those
          submissions were caught, dropped, and never stored or billed. An
          owner whose inbox went quiet checks here; bots absorbed silently is
          the answer that stops the support ticket. */}
      {spamNotice ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          {spamNotice}
        </Alert>
      ) : null}
      {/* Above the rail for the same reason the form notice is (AGL-1529):
          the Members and Leads lists are one section of several, and an owner
          who followed a link into another would never see a notice hidden
          inside that one. Two notices rather than one because the two ceilings
          are independent — a site can be refusing leads while sign-ups still
          land — and a merged sentence could only be true of both. Neither
          carries an `until` line: unlike the monthly form ceiling, these
          count LIVE DOCUMENTS and no date lifts them. */}
      {[membersPausedNotice, leadsPausedNotice].map((notice) =>
        notice ? (
          <Alert key={notice.title} severity="warning" sx={{ mb: 2 }}>
            <AlertTitle>{notice.title}</AlertTitle>
            <Typography component="div" variant="body2">
              {notice.message}
            </Typography>
          </Alert>
        ) : null,
      )}
      <HubSections sections={sections}>
        {sectionBody(section as InboxConsoleSectionId, hostId)}
      </HubSections>
    </>
  )
}
InboxConsolePage.displayName = 'InboxConsolePage'

export default InboxConsolePage
