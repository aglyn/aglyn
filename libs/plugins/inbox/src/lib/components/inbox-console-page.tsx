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
  type ConsolePluginOrgMount,
  type ConsolePluginPageProps,
  formSpamCaughtNotice,
  formSubmissionsPausedNotice,
  submissionMonthKey,
  visitorRecordRefusedCounterId,
  visitorRecordsPausedNotice,
} from '@aglyn/aglyn'
import { HubSections } from '@aglyn/shared-ui-next'
import { useFirestore, useFirestoreDoc } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  AlertTitle,
  Box,
  CircularProgress,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material'
import { doc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import ContactsCard from './contacts-card.component'
import { InboxCampaignsZone } from './inbox-attribution-zone'
import type { InboxConsoleSectionId } from './inbox-console-sections'
import SubmissionsCard from './submissions-card.component'
import { useInboxSitePick } from './use-inbox-site-pick'

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
      return <InboxCampaignsZone hostId={hostId} />
    default:
      return null
  }
}

/**
 * The body of one section on the ORGANIZATION's Inbox (AGL-3303): every
 * site's, with no site picked — the submissions in one collection-group
 * list, the organization's leads, every campaign — and exactly the site
 * view, through the same cards, once one is.
 *
 * Handing a picked site to the site body is the point rather than a
 * shortcut: that site's form filter, its members and its campaigns are
 * facts only a site has, and the cards that already read them are the ones
 * that read them correctly.
 */
function orgSectionBody(
  section: InboxConsoleSectionId,
  mount: ConsolePluginOrgMount,
  siteHostId: string | null,
): ReactNode {
  if (siteHostId) return sectionBody(section, siteHostId)
  switch (section) {
    case 'submissions':
      return <SubmissionsCard hostId={null} orgMount={mount} />
    case 'contacts':
      return <ContactsCard hostId={null} orgMount={mount} />
    case 'campaigns':
      return <InboxCampaignsZone hostId={null} orgMount={mount} />
    default:
      return null
  }
}

/**
 * Inbox (AGL-77/104/109 → AGL-395): form submissions reader, site members +
 * leads, and campaigns — owned by the inbox plugin and rendered by the shell's
 * generic plugin route. The Campaigns section is a zone this page hosts; the
 * plugin that sends campaigns draws its card there.
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
 *
 * The ORGANIZATION's Inbox is this page handed no site (AGL-3303): the same
 * sections over every site at once, and a site filter above the rail that
 * narrows the whole page to one site's own view.
 */
export function InboxConsolePage(props: ConsolePluginPageProps) {
  const { hostId, orgMount, section, sections, basePath } = props
  const firestore = useFirestore()
  /*
   * On the organization's Inbox, the site the page is narrowed to — `null`
   * for every site (AGL-3303). Under a site there is no mount and no pick.
   */
  const sitePick = useInboxSitePick(hostId == null ? orgMount : undefined)
  /*
   * The site whose ceilings the notices below read: this page's own, or the
   * one picked on the organization's Inbox. With every site listed there is
   * no one site to read them for, and reading every site's four counters
   * would be a listener per site on a page that promises a bounded read, so
   * the notices wait for a pick.
   */
  const noticeHostId = hostId ?? sitePick.hostId

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
    () =>
      noticeHostId
        ? doc(
            firestore,
            'hosts',
            noticeHostId,
            'counters',
            'formSubmissionsRefused',
          )
        : null,
    [firestore, noticeHostId],
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
    () =>
      noticeHostId
        ? doc(
            firestore,
            'hosts',
            noticeHostId,
            'counters',
            'formSubmissionsSpam',
          )
        : null,
    [firestore, noticeHostId],
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
      noticeHostId
        ? doc(
            firestore,
            'hosts',
            noticeHostId,
            'counters',
            visitorRecordRefusedCounterId('siteMembers'),
          )
        : null,
    [firestore, noticeHostId],
  )
  const membersPausedNotice = visitorRecordsPausedNotice({
    kind: 'siteMembers',
    refused: Number(membersRefusedCounter?.[submissionMonthKey()] ?? 0),
    ceiling: Number(membersRefusedCounter?.['ceiling']) || undefined,
  })
  const { data: leadsRefusedCounter } = useFirestoreDoc<any>(
    () =>
      noticeHostId
        ? doc(
            firestore,
            'hosts',
            noticeHostId,
            'counters',
            visitorRecordRefusedCounterId('leads'),
          )
        : null,
    [firestore, noticeHostId],
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
   * lands on. (On the organization's Inbox they run once a site is picked.)
   */
  if (!section || !sections?.length || !basePath) return null

  const notices = (
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
    </>
  )

  if (hostId == null) {
    // No site and no org to stand in for it: nothing this page can scope.
    if (!orgMount) return null
    return (
      <>
        {/*
          The site filter sits above the rail with the notices, because it
          is a fact about the whole page: every section follows it, and the
          notices it brings in are the picked site's. An organization with
          one site has nothing to choose, and gets that site's page.
         */}
        {sitePick.options.length ? (
          <TextField
            select
            size="small"
            label={'Site'}
            value={sitePick.hostId ?? ''}
            onChange={(event) => sitePick.setHostId(event.target.value || null)}
            // "All sites" is the empty value, which a select would otherwise
            // draw as a blank rather than as the choice it is — and the label
            // is shrunk with it, or it paints over that choice.
            slotProps={{
              select: { displayEmpty: true },
              inputLabel: { shrink: true },
            }}
            sx={{ mb: 2, minWidth: 240 }}
          >
            <MenuItem value="">{'All sites'}</MenuItem>
            {sitePick.options.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
        ) : null}
        {notices}
        <HubSections sections={sections}>
          {sitePick.ready ? (
            orgSectionBody(
              section as InboxConsoleSectionId,
              orgMount,
              sitePick.hostId,
            )
          ) : (
            <Box sx={{ p: 2 }}>
              <CircularProgress size={24} />
            </Box>
          )}
        </HubSections>
      </>
    )
  }

  return (
    <>
      {notices}
      <HubSections sections={sections}>
        {sectionBody(section as InboxConsoleSectionId, hostId)}
      </HubSections>
    </>
  )
}
InboxConsolePage.displayName = 'InboxConsolePage'

export default InboxConsolePage
