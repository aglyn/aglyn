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
  pluginDocsHelp,
  submissionMonthKey,
  visitorRecordRefusedCounterId,
  visitorRecordsPausedNotice,
} from '@aglyn/aglyn'
// Deep imports, NOT the plugin barrels (AGL-1151): those barrels are the entry
// point the tenant's loader dynamically imports to activate each plugin's SITE
// half, so a console card named there ships to every published page. The
// component path reaches the same module without crossing that entry point.
import { default as HostCampaignsCard } from '@aglyn/plugins-email/components/campaigns-card'
import { default as HostOrdersCard } from '@aglyn/plugins-commerce/components/console/host-orders-card.component'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { HubTabs } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  useFirestoreCollection,
  useFirestoreDoc,
  usePagedCollection,
} from '@aglyn/tenant-feature-instance'
import {
  Alert,
  AlertTitle,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  collection,
  deleteDoc,
  doc,
  limit,
  orderBy,
  query,
  updateDoc,
} from 'firebase/firestore'
import {
  relativeTime,
  routingChips,
  senderHue,
  submissionSender,
} from '../model/submission-presenter'
import { useCallback, useMemo, useState } from 'react'

/**
 * How many members and how many leads the contacts table reads.
 *
 * A ceiling rather than a page size — see the two queries, which explain why
 * this one table cannot be paged by the server without breaking the dedupe
 * between them.
 */
const CONTACT_CEILING = 200

/**
 * Inbox (AGL-77/104/109 → AGL-395): form submissions reader, site members +
 * leads, orders, and campaigns — owned by the inbox plugin and rendered by
 * the shell's generic plugin route. Depends on the commerce + email plugins
 * for the borrowed Orders and Campaigns tabs.
 */
export function InboxConsolePage(props: ConsolePluginPageProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()

  /*
   * The inbox WALKS its submissions instead of sampling them (AGL-2501,
   * AGL-2292).
   *
   * `limit(200)` carried no `orderBy`, so Firestore answered it in
   * DOCUMENT-ID order over ids `add()` generates — an arbitrary two hundred
   * of the site's messages, which the client sort then arranged newest-first
   * so the result looked like a feed. A site past two hundred submissions
   * could not reach the rest, and the messages missing left no gap: the row
   * dates on screen simply skipped, which reads as a quiet week rather than
   * as an unreachable inbox.
   *
   * `createdAt` is safe to order on, checked against the writer rather than
   * assumed: `apps/tenant/app/api/forms/submit/route.ts` is the only path
   * that creates one and stamps `createdAt: serverTimestamp()` on every add,
   * the v1 API only ever reads and deletes, and `formSubmissions` is absent
   * from `IMPORTABLE_FIELDS`, so no restore path can make one without it.
   */
  const {
    rows: submissions,
    hasMore: hasMoreSubmissions,
    page: submissionPage,
    setPage: setSubmissionPage,
    pageSize: submissionPageSize,
    setPageSize: setSubmissionPageSize,
  } = usePagedCollection<any>(
    (pageLimit) =>
      query(
        collection(firestore, 'hosts', hostId, 'formSubmissions'),
        orderBy('createdAt', 'desc'),
        limit(pageLimit),
      ),
    [firestore, hostId],
    { idField: '$id' },
  )

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

  /*==========================================
   * SITE MEMBERS + LEADS (AGL-109): ORDERED AND CEILINGED, NOT PAGED BY QUERY.
   *
   * Both reads were `limit(200)` with no `orderBy` and a client sort on top —
   * the same document-id sample as the submissions above, and both now name
   * the order the rows are rendered in. `createdAt` is safe on both:
   * `membership-register.ts` is the only writer that CREATES a site member
   * and stamps it inside its transaction (every other membership path
   * updates an existing document), `recordVisitorLead` is the only writer
   * that creates a lead and stamps it on every `tx.create`, and neither
   * collection is in `IMPORTABLE_FIELDS`.
   *
   * What they must NOT do is page the query, and the reason is the dedupe two
   * hundred lines below: a lead is hidden when a MEMBER already exists on the
   * same address. That test is only correct while both windows are whole. On a
   * ten-row server page it would compare a page of leads against a page of
   * members, so somebody who signed up after leaving their address would
   * render as a Member on one page and again as a Lead on another — one person
   * counted twice, in a list a site owner uses to count people.
   *
   * So the CEILING stays and the page is a slice of the assembled rows. The
   * probe row makes "there are more contacts than these" a fact rather than a
   * guess from `length === CONTACT_CEILING`, which is wrong at exactly the
   * count that equals the ceiling.
   *=========================================*/
  const { data: memberDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'siteMembers'),
        orderBy('createdAt', 'desc'),
        limit(CONTACT_CEILING + 1),
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const siteMembers = (memberDocs ?? []).slice(0, CONTACT_CEILING)
  const { data: leadDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'leads'),
        orderBy('createdAt', 'desc'),
        limit(CONTACT_CEILING + 1),
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const leads = (leadDocs ?? []).slice(0, CONTACT_CEILING)
  const contactsTruncated =
    (memberDocs?.length ?? 0) > CONTACT_CEILING ||
    (leadDocs?.length ?? 0) > CONTACT_CEILING
  /*
   * The contacts table is ONE list of two collections — members first, then
   * the leads that are not already members — so the page is a window over the
   * concatenation rather than over either read. Slicing each half by the same
   * global offsets is what keeps a page exactly `pageSize` rows across the
   * seam between them.
   */
  const dedupedLeads = useMemo(
    () =>
      leads.filter(
        (lead: any) =>
          !siteMembers.some((member: any) => member.email === lead.email),
      ),
    [leads, siteMembers],
  )
  const [contactPage, setContactPage] = useState(0)
  const [contactPageSize, setContactPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const contactCount = siteMembers.length + dedupedLeads.length
  const contactStart = contactPage * contactPageSize
  const contactEnd = contactStart + contactPageSize
  const visibleMembers = siteMembers.slice(contactStart, contactEnd)
  const visibleLeads = dedupedLeads.slice(
    Math.max(0, contactStart - siteMembers.length),
    Math.max(0, contactEnd - siteMembers.length),
  )
  const handleDeleteMember = useCallback(
    (member: any) => async () => {
      const confirmed = await confirm({
        title: 'Remove this member?',
        description: `"${member.email}" can no longer sign in to your site.`,
        confirmationText: 'Remove',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      await deleteDoc(doc(firestore, 'hosts', hostId, 'siteMembers', member.$id))
      enqueueSnackbar('Member removed', { variant: 'success', persist: false })
    },
    [confirm, firestore, hostId, enqueueSnackbar],
  )

  // Mail reader (AGL-104): opening a submission shows the full message and
  // marks it read.
  const [reader, setReader] = useState<any | null>(null)
  const handleOpenReader = useCallback(
    (submission: any) => () => {
      setReader(submission)
      if (!submission.read) {
        void updateDoc(
          doc(firestore, 'hosts', hostId, 'formSubmissions', submission.$id),
          { read: true },
        )
      }
    },
    [firestore, hostId],
  )

  const handleToggleRead = useCallback(
    (submission: any) => () => {
      void updateDoc(
        doc(firestore, 'hosts', hostId, 'formSubmissions', submission.$id),
        { read: !submission.read },
      )
    },
    [firestore, hostId],
  )

  const handleDelete = useCallback(
    (submission: any) => async () => {
      const confirmed = await confirm({
        title: 'Delete this submission?',
        description: 'The submission is removed permanently.',
        confirmationText: 'Delete',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      await deleteDoc(
        doc(firestore, 'hosts', hostId, 'formSubmissions', submission.$id),
      )
      enqueueSnackbar('Submission deleted', {
        variant: 'success',
        persist: false,
      })
    },
    [confirm, firestore, hostId, enqueueSnackbar],
  )

  return (
    <>
      {/* Above the tabs on purpose (AGL-1666). A paused form is not a fact
          about the Submissions tab — it is why the whole inbox stopped
          filling — and the notification that brings an owner here links to
          the page, not to a tab. Inside a tab panel it would be invisible to
          anyone who last left the page on Orders. */}
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
      {/* Above the tabs for the same reason the form notice is (AGL-1529):
          the Members and Leads lists are on the Contacts tab, and an owner
          who last left this page on Orders would never see a notice hidden
          inside one. Two notices rather than one because the two ceilings are
          independent — a site can be refusing leads while sign-ups still
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
      <HubTabs
        /*
         * Mount the section being read, and no others (AGL-2501).
         *
         * `HubTabs` keeps every panel mounted unless told otherwise, so
         * opening one section also subscribed the Firestore listeners behind
         * all the rest and paid for every document their `limit()` allows.
         * The reader sees one section; without this the page reads them all.
         *
         * Sections as ROUTES make this structural rather than a flag somebody
         * has to remember, and plugin pages can carry them now: the shell's
         * route is a catch-all and a nav item's `sections` are resolved by
         * longest-prefix match. This page has not been converted yet, so the
         * flag stays until it is.
         */
        lazy
            tabs={[
              {
                id: 'submissions',
                label: 'Submissions',
                content: (
                  <CardDisplay
                    header={'Form Submissions'}
                    help={pluginDocsHelp('forms', {
                      anchor: '#the-inbox',
                      excerpt:
                        'Messages your forms collected, newest first, showing who sent ' +
                        'each one and where it was routed.',
                    })}
                    contentGutterX
                    contentGutterY
                    contentBordered="all"
                  >
          {submissions.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {'No form submissions yet. Add a Contact Form element to a ' +
                'screen — visitor messages arrive here.'}
            </Typography>
          ) : (
            <>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{'From'}</TableCell>
                  <TableCell>{'Message'}</TableCell>
                  <TableCell>{'Received'}</TableCell>
                  <TableCell align="right">{'Actions'}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {submissions.map((submission) => (
                  <TableRow
                    key={submission.$id}
                    hover
                    onClick={handleOpenReader(submission)}
                    sx={{
                      cursor: 'pointer',
                      '& td': {
                        fontWeight: submission.read ? undefined : 600,
                      },
                    }}
                  >
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {/*
                        The mockup's list is people, not forms (AGL-2168):
                        an initials avatar, the sender, and the form name
                        beneath it. The unread DOT replaces the `New` chip
                        — the row is already bold, and a chip that says
                        "New" beside bold text is the same fact twice.
                       */}
                      {(() => {
                        const sender = submissionSender(submission.fields)
                        const hue = senderHue(sender.label)
                        return (
                          <Stack
                            direction="row"
                            spacing={1}
                            sx={{ alignItems: 'center' }}
                          >
                            {!submission.read ? (
                              <Box
                                aria-label="Unread"
                                sx={{
                                  width: 8,
                                  height: 8,
                                  borderRadius: '50%',
                                  bgcolor: 'primary.main',
                                  flexShrink: 0,
                                }}
                              />
                            ) : (
                              <Box sx={{ width: 8, flexShrink: 0 }} />
                            )}
                            <Avatar
                              sx={{
                                width: 28,
                                height: 28,
                                fontSize: 13,
                                bgcolor: `hsl(${hue} 55% 45%)`,
                              }}
                            >
                              {sender.initials}
                            </Avatar>
                            <Stack sx={{ minWidth: 0 }}>
                              <Typography variant="body2" noWrap>
                                {sender.label}
                              </Typography>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                noWrap
                              >
                                {submission.formName ?? 'Form'}
                              </Typography>
                            </Stack>
                          </Stack>
                        )
                      })()}
                    </TableCell>
                    <TableCell>
                      <Typography
                        variant="body2"
                        component="div"
                        sx={{
                          maxWidth: 480,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {Object.entries(submission.fields ?? {})
                          .map(([key, value]) => `${key}: ${value}`)
                          .join(' · ')}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {/*
                        Relative, as the mockup shows it — an inbox is
                        scanned for recency and a locale timestamp makes
                        the reader do the subtraction. The absolute time
                        stays on the detail dialog, where it is the fact
                        you actually want.
                       */}
                      <Tooltip
                        title={
                          submission.createdAt?.toDate?.().toLocaleString() ??
                          ''
                        }
                      >
                        <span>
                          {relativeTime(
                            submission.createdAt?.toDate?.().getTime(),
                          )}
                        </span>
                      </Tooltip>
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{ whiteSpace: 'nowrap' }}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Button size="small" onClick={handleToggleRead(submission)}>
                        {submission.read ? 'Mark unread' : 'Mark read'}
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        onClick={handleDelete(submission)}
                      >
                        {'Delete'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <ListPagination
              page={submissionPage}
              pageSize={submissionPageSize}
              rowCount={submissions.length}
              hasMore={hasMoreSubmissions}
              onPageChange={setSubmissionPage}
              onPageSizeChange={setSubmissionPageSize}
            />
            </>
          )}
                  </CardDisplay>
                ),
              },
              {
                id: 'contacts',
                label: 'Members & leads',
                content: (
                  <Stack spacing={3}>
                    <CardDisplay
                      header={'Site Members & Leads'}
                      help={pluginDocsHelp('membersOnly', {
                        anchor: '#manage-your-members',
                      })}
                      contentGutterX
                      contentGutterY
                      contentBordered="all"
                    >
              {siteMembers.length === 0 && leads.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {'No members yet — visitors can join at /signup on your ' +
                    'site; sign-ups also appear here as leads.'}
                </Typography>
              ) : (
                <>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{'Email'}</TableCell>
                      <TableCell>{'Type'}</TableCell>
                      <TableCell>{'Joined'}</TableCell>
                      <TableCell align="right">{'Actions'}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {visibleMembers.map((member: any) => (
                      <TableRow key={member.$id} hover>
                        <TableCell>
                          {member.email}
                          {member.displayName ? (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ ml: 1 }}
                              component="span"
                            >
                              {member.displayName}
                            </Typography>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Chip label="Member" color="primary" size="small" />
                        </TableCell>
                        <TableCell>
                          {member.createdAt?.toDate?.().toLocaleString() ??
                            '--'}
                        </TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            color="error"
                            onClick={handleDeleteMember(member)}
                          >
                            {'Remove'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {visibleLeads.map((lead: any) => (
                        <TableRow key={lead.$id} hover>
                          <TableCell>
                            {lead.email}
                            {/*
                              The name the lead writer now stores (AGL-2303),
                              same treatment as a member's `displayName` above
                              — a list of bare addresses is a list nobody
                              recognises anyone in.
                            */}
                            {lead.name ? (
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ ml: 1 }}
                                component="span"
                              >
                                {lead.name}
                              </Typography>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            {/*
                              WHERE THE LEAD CAME FROM (AGL-2338).
                              `source` has been written by both lead writers —
                              `'signup'` and `'booking'` — since AGL-109, and
                              nothing read it: every row rendered the same flat
                              "Lead" chip, so a site owner could not tell a
                              membership sign-up from a booking, and the
                              campaign audience selector treated them alike.
                              Attribution collected and invisible.

                              Falls back to the bare label rather than printing
                              an empty suffix for a row written before the
                              field, or by a future writer that omits it.
                            */}
                            <Chip
                              label={
                                lead.source ? `Lead · ${lead.source}` : 'Lead'
                              }
                              size="small"
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell>
                            {lead.createdAt?.toDate?.().toLocaleString() ??
                              '--'}
                          </TableCell>
                          <TableCell align="right">{'--'}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
                <ListPagination
                  page={contactPage}
                  pageSize={contactPageSize}
                  rowCount={visibleMembers.length + visibleLeads.length}
                  // The whole deduped list, which this card genuinely holds —
                  // both reads are ceilinged and complete below the ceiling.
                  count={contactCount}
                  onPageChange={setContactPage}
                  onPageSizeChange={setContactPageSize}
                />
                {contactsTruncated ? (
                  <Alert severity="info" sx={{ mt: 1 }}>
                    {`Paging the ${CONTACT_CEILING} newest members and the ` +
                      `${CONTACT_CEILING} newest leads. This site has more ` +
                      'than that — the campaign audiences still reach ' +
                      'everyone, whether or not they are listed here.'}
                  </Alert>
                ) : null}
                </>
              )}
                    </CardDisplay>
                    <HostOrdersCard hostId={hostId} />
                  </Stack>
                ),
              },
              {
                id: 'campaigns',
                label: 'Campaigns',
                content: <HostCampaignsCard hostId={hostId} />,
              },
            ]}
          />
      <Dialog
        open={Boolean(reader)}
        onClose={() => setReader(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{reader?.formName ?? 'Form submission'}</DialogTitle>
        <DialogContent>
          <Typography variant="caption" color="text.secondary">
            {`Received ${reader?.createdAt?.toDate?.().toLocaleString() ?? ''}` +
              (reader?.screenId ? ` · screen ${reader.screenId}` : '')}
          </Typography>
          <Divider sx={{ my: 1.5 }} />
          <Stack spacing={1.5}>
            {Object.entries(reader?.fields ?? {}).map(([key, value]) => (
              <Stack key={key} spacing={0.25}>
                <Typography variant="caption" color="text.secondary">
                  {key}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                >
                  {String(value)}
                </Typography>
              </Stack>
            ))}
          </Stack>
          {/*
            What happened to this submission (AGL-2168). The mockup puts
            these under the fields: `Saved to Inbox` and `Added to "Leads"
            dataset`. The second is stamped by the submit route only when a
            record was really appended — a form bound to a deleted dataset,
            or one whose record quota is full, shows no chip rather than a
            chip for a row that does not exist. Both are failures the route
            already swallows silently, and a chip that lied about them
            would be worse than the silence.
           */}
          <Stack
            direction="row"
            spacing={1}
            sx={{ mt: 2, flexWrap: 'wrap', rowGap: 1 }}
          >
            {routingChips(reader?.routing).map((chip) => (
              <Chip
                key={chip.label}
                size="small"
                label={chip.label}
                color={chip.color}
                variant="outlined"
              />
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            color="error"
            onClick={async () => {
              const target = reader
              setReader(null)
              if (target) await handleDelete(target)()
            }}
          >
            {'Delete'}
          </Button>
          <Button
            onClick={() => {
              if (reader) void handleToggleRead({ ...reader, read: true })()
              setReader(null)
            }}
          >
            {'Mark unread'}
          </Button>
          <Button variant="contained" onClick={() => setReader(null)}>
            {'Close'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
InboxConsolePage.displayName = 'InboxConsolePage'

export default InboxConsolePage
