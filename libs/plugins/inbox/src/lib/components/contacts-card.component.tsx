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
  normalizeContactEmail,
  pluginDocsHelp,
  type ConsolePluginOrgMount,
} from '@aglyn/aglyn'
// A deep import, NOT the plugin barrel (AGL-1151): the barrel is the entry
// point the tenant's loader dynamically imports to activate the marketing
// plugin's SITE half, so a console card named there ships to every published
// page. The component path reaches the same module without crossing it.
import { InboxRecordAttributionZone } from './inbox-attribution-zone'
// The CRM's route builder by its leaf path, not the plugin barrel: the barrel
// carries the plugin registration, and a link needs only the address grammar.
import { pluginRecordHref } from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import {
  mdiAccountArrowRight,
  mdiAccountRemoveOutline,
  mdiBullhornOutline,
} from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import {
  ListRowActions,
  ListTable,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import type { RowActionsMenuItem } from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { TABLE_ROW_HEIGHT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  useFirestore,
  useFirestoreCollection,
  useOrgDataScope,
  useUser,
} from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { collection, limit, orderBy, query, where } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { useRecordRouteContext } from './use-record-route-context'
import { scopeTokensForHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import { orgSiteNames } from './inbox-org-sites'

/**
 * How many members and how many leads the contacts table reads.
 *
 * A ceiling rather than a page size — see the two queries, which explain why
 * this one table cannot be paged by the server without breaking the dedupe
 * between them.
 */
const CONTACT_CEILING = 200

/**
 * The Members & leads section of the Inbox (AGL-109): everybody a site
 * collected, in one list.
 *
 * Its own component since AGL-2501, when the Inbox's tabs became routes. The
 * split is what makes "mount only the section being read" structural: hooks
 * cannot be conditional, so a page holding every section's reads pays for all
 * of them whichever one the URL names.
 *
 * On the organization's Inbox (`hostId: null`, AGL-3303) it lists the
 * organization's leads with the sites each was captured by. A member signs up
 * to ONE site and lives under it, so members are listed once a site is
 * picked, which is the page handing this card that site.
 */
export function ContactsCard({
  hostId,
  orgMount,
}: {
  hostId: string | null
  /** The organization and its sites — present exactly when `hostId` is `null`. */
  orgMount?: ConsolePluginOrgMount
}) {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  // Where a lead is WORKED (AGL-2608). This card lists leads; the CRM's
  // Leads section gives each one a status, an owner and a conversion.
  const routeContext = useRecordRouteContext()
  const leadHref = (contact: { $id?: unknown }): string | null =>
    routeContext
      ? pluginRecordHref('lead', routeContext, String(contact.$id))
      : null

  /*==========================================
   * SITE MEMBERS + LEADS (AGL-109): ORDERED AND CEILINGED, NOT PAGED BY QUERY.
   *
   * Both reads were `limit(200)` with no `orderBy` and a client sort on top —
   * the same document-id sample the submissions list used to take, and both
   * now name the order the rows are rendered in. `createdAt` is safe on both:
   * `membership-register.ts` is the only writer that CREATES a site member
   * and stamps it inside its transaction (every other membership path
   * updates an existing document), `recordVisitorLead` is the only writer
   * that creates a lead and stamps it on every `tx.create`, and neither
   * collection is in `IMPORTABLE_FIELDS`.
   *
   * What they must NOT do is page the query, and the reason is the dedupe
   * below: a lead is hidden when a MEMBER already exists on the same address.
   * That test is only correct while both windows are whole. On a ten-row
   * server page it would compare a page of leads against a page of members, so
   * somebody who signed up after leaving their address would render as a
   * Member on one page and again as a Lead on another — one person counted
   * twice, in a list a site owner uses to count people.
   *
   * So the CEILING stays and the page is a slice of the assembled rows. The
   * probe row makes "there are more contacts than these" a fact rather than a
   * guess from `length === CONTACT_CEILING`, which is wrong at exactly the
   * count that equals the ceiling.
   *=========================================*/
  const { data: memberDocs } = useFirestoreCollection<any>(
    () =>
      hostId
        ? query(
            collection(firestore, 'hosts', hostId, 'siteMembers'),
            orderBy('createdAt', 'desc'),
            limit(CONTACT_CEILING + 1),
          )
        : null,
    [firestore, hostId],
    { idField: '$id' },
  )
  /*
   * The lead silo is the org's (AGL-3275), narrowed to this site by
   * `visibleTo`. Reading `hosts/{hostId}/leads` showed a site its
   * pre-migration rows and nothing captured since.
   */
  const { orgId } = useOrgDataScope({
    hostId: hostId ?? undefined,
    orgId: hostId == null ? orgMount?.orgId : undefined,
  })
  const siteMembers = (memberDocs ?? []).slice(0, CONTACT_CEILING)
  const { data: leadDocs } = useFirestoreCollection<any>(
    () =>
      orgId
        ? query(
            collection(firestore, 'orgs', orgId, 'leads'),
            /*
             * Every site's, on the organization's Inbox: an org-wide member
             * reads the collection unscoped — the rules short-circuit on
             * their reach, as for the CRM's own org list — so a clause here
             * would only narrow what they may already read.
             */
            ...(hostId
              ? [
                  where(
                    'visibleTo',
                    'array-contains-any',
                    scopeTokensForHost(hostId),
                  ),
                ]
              : []),
            orderBy('createdAt', 'desc'),
            limit(CONTACT_CEILING + 1),
          )
        : null,
    [firestore, orgId, hostId],
    { idField: '$id' },
  )
  const leads = (leadDocs ?? []).slice(0, CONTACT_CEILING)
  const contactsTruncated =
    (memberDocs?.length ?? 0) > CONTACT_CEILING ||
    (leadDocs?.length ?? 0) > CONTACT_CEILING
  /*
   * One person renders once, whichever way they came in.
   *
   * Raw `===` made `Bob@x.com` and `bob@x.com` two different people, so
   * somebody could appear as a Member on one row and a Lead on another. The
   * comparison is now the same NORMALIZATION a lead document is keyed by —
   * `personKey` is `sha256(normalizeContactEmail(email))`, and hashing an
   * already-normalized address cannot merge or split anything the normalizer
   * did not, so the two agree by construction.
   *
   * `personKey` itself cannot run here: it needs `node:crypto` and this is a
   * client component. That is why the shared half is the normalizer rather
   * than the digest.
   */
  const dedupedLeads = useMemo(() => {
    const memberKeys = new Set(
      siteMembers
        .map((member: any) => normalizeContactEmail(member.email))
        .filter(Boolean),
    )
    return leads.filter(
      (lead: any) => !memberKeys.has(normalizeContactEmail(lead.email)),
    )
  }, [leads, siteMembers])
  /*
   * ONE list of two collections — members first, then the leads that are not
   * already members — so the grid pages the concatenation rather than either
   * read, and a page stays whole across the seam between them. Both reads are
   * ceilinged and complete below the ceiling, so the grid's count is the whole
   * deduped list.
   */
  const contacts = useMemo(
    () => [
      ...siteMembers.map((member: any) => ({ ...member, contactKind: 'member' })),
      ...dedupedLeads.map((lead: any) => ({ ...lead, contactKind: 'lead' })),
    ],
    [siteMembers, dedupedLeads],
  )
  /*
   * REMOVED BY THE ROUTE THAT OWNS MEMBER ACCOUNTS (AGL-3308), not by a
   * client delete. A member's password hash lives in a document no client can
   * reach, so deleting the profile from here would leave it behind: the route
   * deletes both, and the rules refuse a client delete of any member that
   * has one.
   */
  const handleDeleteMember = useCallback(
    (member: any) => async () => {
      // Members are listed only under a site, so there is one to delete from.
      if (!hostId) return
      const confirmed = await confirm({
        title: 'Remove this member?',
        description: `"${member.email}" can no longer sign in to your site.`,
        confirmationText: 'Remove',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      try {
        const response = await authorizedFetch(user, '/api/membership/admin-remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostId, memberId: member.$id }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          return void enqueueSnackbar(payload?.error ?? 'The member was not removed', {
            variant: 'warning',
            allowDuplicate: true,
          })
        }
        enqueueSnackbar('Member removed', { variant: 'success', persist: false })
      } catch {
        enqueueSnackbar('The member was not removed', {
          variant: 'warning',
          allowDuplicate: true,
        })
      }
    },
    [confirm, user, hostId, enqueueSnackbar],
  )

  /*
   * WHERE A LEAD CAME FROM, on request.
   *
   * A lead is a table row with no page of its own, and the attribution is one
   * keyed document read — cheap on its own, and the page size times cheap in
   * a column. So it is an overflow action that opens a dialog: the reader who
   * wants the answer pays for it, and the reader who came to scan the list
   * does not.
   */
  const [leadOrigin, setLeadOrigin] = useState<any | null>(null)
  /*
   * The site a lead's attribution is asked of. Under a site it is that site;
   * across every site a lead is one org row that several sites may have met,
   * and the credit is filed by the site whose capture made it — the first in
   * `capturedByHostIds`, the site the CRM's own lead page asks as well.
   */
  const originSite = (contact: any): string | null => {
    if (hostId) return hostId
    const first = Array.isArray(contact?.capturedByHostIds)
      ? contact.capturedByHostIds[0]
      : null
    return typeof first === 'string' && first ? first : null
  }
  const leadOriginSite = leadOrigin ? originSite(leadOrigin) : null

  const contactActions = (contact: any): RowActionsMenuItem[] =>
    contact.contactKind === 'member'
      ? [
          {
            key: 'remove',
            label: 'Remove member',
            icon: <MdiIcon path={mdiAccountRemoveOutline.path} size={0.8} />,
            destructive: true,
            onClick: () => void handleDeleteMember(contact)(),
          },
        ]
      : [
          // Offered only where a plugin publishes a lead's address: text-less
          // rather than a link to a page this workspace cannot open.
          ...(leadHref(contact)
            ? [
                {
                  key: 'crm',
                  label: 'Open in CRM',
                  icon: <MdiIcon path={mdiAccountArrowRight.path} size={0.8} />,
                  href: leadHref(contact) as string,
                },
              ]
            : []),
          // A lead no site captured has no site to ask for its campaign.
          ...(originSite(contact)
            ? [
                {
                  key: 'origin',
                  label: 'Where this came from',
                  icon: <MdiIcon path={mdiBullhornOutline.path} size={0.8} />,
                  onClick: () => setLeadOrigin(contact),
                },
              ]
            : []),
        ]
  const contactColumns: GridColDef[] = [
    {
      field: 'email',
      headerName: 'Email',
      flex: 1,
      minWidth: 240,
      /*
        The name beside the address — a member's `displayName`, and the name
        the lead writer stores (AGL-2303) — because a list of bare addresses is
        a list nobody recognizes anyone in.
       */
      renderCell: ({ row: contact }) => {
        const name =
          contact.contactKind === 'member' ? contact.displayName : contact.name
        return (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', minWidth: 0 }}>
            <Typography variant="body2" noWrap>
              {contact.email}
            </Typography>
            {name ? (
              <Typography variant="caption" color="text.secondary" noWrap>
                {name}
              </Typography>
            ) : null}
          </Stack>
        )
      },
    },
    {
      /*
        WHERE A LEAD CAME FROM (AGL-2338). `source` has been written by both
        lead writers — `'signup'` and `'booking'` — since AGL-109, so a site
        owner can tell a membership sign-up from a booking. Falls back to the
        bare label for a row written before the field, or by a future writer
        that omits it.
       */
      field: 'contactKind',
      headerName: 'Type',
      width: 170,
      valueGetter: (_value, contact) =>
        contact.contactKind === 'member'
          ? 'Member'
          : contact.source
            ? `Lead · ${contact.source}`
            : 'Lead',
      renderCell: ({ row: contact, value }) =>
        contact.contactKind === 'member' ? (
          <Chip label={value} color="primary" size="small" />
        ) : (
          <Chip label={value} size="small" variant="outlined" />
        ),
    },
    /*
      KNOWN BY, on the organization's Inbox: every site that captured the
      person, as the CRM's organization Leads list names them. A lead is one
      org row, so "which site" is a set, never one answer.
     */
    ...(hostId == null
      ? [
          {
            field: 'capturedByHostIds',
            headerName: 'Site',
            flex: 1,
            minWidth: 160,
            valueGetter: (_value: unknown, contact: any) =>
              orgSiteNames(orgMount, contact.capturedByHostIds),
          } satisfies GridColDef,
        ]
      : []),
    {
      field: 'createdAt',
      headerName: 'Joined',
      width: 200,
      // Sorted on the instant, drawn as a local string.
      valueGetter: (_value, contact) => contact.createdAt?.toDate?.()?.getTime?.() ?? 0,
      renderCell: ({ row: contact }) =>
        contact.createdAt?.toDate?.().toLocaleString() ?? '--',
    },
    listActionsColumn(
      (contact) => (
        <ListRowActions
          label={String(contact.email ?? contact.$id)}
          items={contactActions(contact)}
        />
      ),
      { width: 72 },
    ),
  ]

  return (
    <>
      <CardDisplay
        header={hostId == null ? 'Leads' : 'Site Members & Leads'}
        help={pluginDocsHelp('membersOnly', {
          anchor: '#manage-your-members',
        })}
        contentGutterX
        contentGutterY
        contentBordered="all"
      >
        {hostId == null ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mb: leads.length ? 2 : 1 }}
          >
            {'Every site’s leads, newest first. Members sign up to one site ' +
              'each — choose a site to list its members beside its leads.'}
          </Typography>
        ) : null}
        {siteMembers.length === 0 && leads.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {hostId == null
              ? 'No leads on any site yet.'
              : 'No members yet — visitors can join at /signup on your ' +
                'site; sign-ups also appear here as leads.'}
          </Typography>
        ) : (
          <>
            <ListTable
              aria-label="Site members and leads"
              rows={contacts}
              columns={contactColumns}
              // A member and a lead are two collections, so an id alone could
              // name one of each.
              getRowId={(contact: any) => `${contact.contactKind}:${contact.$id}`}
              rowHeight={TABLE_ROW_HEIGHT}
            />
            {contactsTruncated ? (
              <Alert severity="info" sx={{ mt: 1 }}>
                {hostId == null
                  ? `Paging the ${CONTACT_CEILING} newest leads. Your ` +
                    'sites hold more than that — the CRM’s Leads list ' +
                    'reaches every one of them.'
                  : `Paging the ${CONTACT_CEILING} newest members and the ` +
                    `${CONTACT_CEILING} newest leads. This site has more ` +
                    'than that — the campaign audiences still reach ' +
                    'everyone, whether or not they are listed here.'}
              </Alert>
            ) : null}
          </>
        )}
      </CardDisplay>
      {/*
        WHERE A LEAD CAME FROM.

        Its own dialog rather than a column, for the reason the state above
        gives: one keyed read, paid by the reader who asked the question. A
        lead has no page of its own to put this on, and giving it one to carry
        a single line would be a new record surface rather than attribution.
       */}
      <Dialog
        open={Boolean(leadOrigin)}
        onClose={() => setLeadOrigin(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{leadOrigin?.email ?? 'Lead'}</DialogTitle>
        <DialogContent>
          {leadOrigin?.$id && leadOriginSite ? (
            <InboxRecordAttributionZone
              hostId={leadOriginSite}
              recordKind="lead"
              recordId={String(leadOrigin.$id)}
            />
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={() => setLeadOrigin(null)}>
            {'Close'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
ContactsCard.displayName = 'ContactsCard'

export default ContactsCard
