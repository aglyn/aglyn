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

import * as Aglyn from '@aglyn/aglyn'
import { CONTACT_LIFECYCLE_STAGE_LABELS, pluginDocsHelp } from '@aglyn/aglyn'
import { mdiDeleteOutline } from '@aglyn/shared-data-mdi'
import { AppLink, MdiIcon, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import type { RowActionsMenuItem } from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  useFirestoreDoc,
  useHostActivityLogger,
  useOrgDataScope,
} from '@aglyn/tenant-feature-instance'
import { Stack, Tooltip, Typography } from '@mui/material'
import {
  arrayRemove,
  deleteDoc,
  deleteField,
  doc,
  updateDoc,
} from 'firebase/firestore'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useMemo } from 'react'
import { contactRecordFromDoc } from '../model/contact-record'
import { type CrmDetailPageProps, crmRoutes } from '../model/crm-routes'
import ContactAssociationsCard from './contact-associations-card'
import ContactCustomFieldsCard from './contact-custom-fields-card'
import ContactPropertiesCard from './contact-properties-card'
import ContactTimelineCard from './contact-timeline-card'
import { AddToListButton } from './add-to-list-button'
import { CrmSendEmailButton } from './crm-send-email-button'
import { ContactDealsCard } from './contact-deals-card'
import { CrmRecordChip, CrmRecordHeader } from './crm-record-header'
import { RecordTasksCard } from './record-tasks-card'
import { useEmailsHubPath } from './use-emails-hub-path'
import { useOrgMembers } from './use-org-members'

const contactDocsHelp = pluginDocsHelp('contacts', {
  anchor: '#the-contacts-page',
  excerpt:
    "One person's record: the profile your team keeps on them, where they " +
    'came from, what they are filed under, and what the site recorded.',
})

/**
 * `/crm/contacts/{contactId}` — one person (AGL-2596).
 *
 * A ROUTE rather than the v1 drawer, because a person is the thing every
 * other CRM record points at: a deal, a task and an activity all name a
 * contact, and a link that opens a drawer on top of a list is not a link
 * anybody can paste.
 *
 * ## What this page reads
 *
 * ONE document, by id, through the scoped rules — a single-document get is
 * judged on that document's own `visibleTo`, so no `array-contains-any`
 * filter is needed here the way it is on the list. The row is then flattened
 * through the viewing group's facet ONCE (`contactRecordFromDoc`) and the
 * cards below read the flat record: none of them reaches into
 * `facets.{groupId}` for itself, which is what keeps a card from ever
 * showing another holder's notes.
 *
 * Beyond the document: the team roster (one request, for the owner picker)
 * and the site's campaigns (one listen, for the filing picker) — both paid
 * here because opening a record IS the ask for them, and neither is paid by
 * the list.
 *
 * ## The cards
 *
 * Each in its own file, so a card can grow without this page growing:
 * properties (the editable profile), the relationship (sources, attribution,
 * consent, campaign filing) and the timeline. Other CRM sections add a card
 * here by inserting one import and one line.
 *
 * ## Delete is a detach
 *
 * The row is shared by every site that has captured this person, so the
 * action in the overflow menu drops THIS group's facet, consent, attribution
 * and scope tokens, and deletes the document only when nobody else is left
 * holding it — `planContactDetach` does the counting off `visibleTo`, which
 * is what both enforcement layers evaluate, and the rules refuse a delete by
 * a caller who is not the sole holder. Not the erasure path: a privacy
 * erasure removes the person regardless of who else holds them.
 */
export function ContactDetailPage(props: CrmDetailPageProps) {
  const { hostId, org, id, basePath } = props
  const routes = crmRoutes(basePath)
  const router = useRouter()
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const logActivity = useHostActivityLogger(hostId)
  const { scope, orgId } = useOrgDataScope({ hostId })

  // The controller this page is showing — the sites declared to be one
  // sender, or this site alone — resolved from the org document the shell
  // already passed, so it costs no read.
  const consentGroup = useMemo(
    () => Aglyn.consentGroupForHost(org as Record<string, unknown>, hostId),
    [org, hostId],
  )

  const {
    data: row,
    status,
    fromCache,
  } = useFirestoreDoc<Record<string, any>>(
    () => (scope ? doc(firestore, scope[0], scope[1], 'contacts', id) : null),
    [firestore, scope, id],
    { idField: '$id' },
  )
  const record = useMemo(
    () => (row ? contactRecordFromDoc(row, consentGroup) : null),
    [row, consentGroup],
  )
  const notFound = Boolean(scope) && status !== 'loading' && !row

  // The roster, for the owner picker and the owner's name — read because a
  // record page is the one place both are shown.
  const members = useOrgMembers(orgId, { enabled: Boolean(record) })
  /*
   * Where this person's ORDERS are read (AGL-2622): the site's orders list,
   * narrowed to their address. The count on the header is the number; the
   * list is the rows. Built from the route params already in the URL, so
   * no document is read to draw a link, and absent off a site — the
   * org-level mount has no orders list to point at.
   */
  const params = useParams<{ orgSlug?: string; host?: string }>()
  const ordersHref =
    params?.orgSlug && params?.host && record?.email
      ? Aglyn.siteRecordLinks({
          orgSlug: String(params.orgSlug),
          host: String(params.host),
        }).ordersByCustomer(record.email)
      : null

  /*
   * Where a campaign entry on the timeline links to: the email's own report
   * on this site's Emails hub (AGL-2616). Only a campaign THIS site sent can
   * be addressed — a sibling site in the same consent group has an Emails
   * hub of its own under a subdomain this page does not know — so the
   * builder answers `null` for those and the entry draws unlinked.
   */
  const emailsHub = useEmailsHubPath()
  const campaignHref = useCallback(
    (email: Aglyn.ContactCampaignEmail) =>
      emailsHub && email.hostId === hostId
        ? `${emailsHub}/messages/${encodeURIComponent(email.campaignId)}`
        : null,
    [emailsHub, hostId],
  )

  const handleRemove = useCallback(async () => {
    if (!row || !scope) return
    const confirmed = await confirm({
      title: 'Delete this contact?',
      description:
        `"${record?.email ?? id}" is removed from this site's ` +
        'Contacts, along with its notes, tags and timeline. Other sites ' +
        'that captured the same person keep their own records. Their form ' +
        'submissions, orders, bookings, and membership records are ' +
        'separate — delete those from their own pages if the request ' +
        'covers them.',
      confirmationText: 'Delete contact',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    try {
      const ref = doc(firestore, scope[0], scope[1], 'contacts', id)
      const plan = Aglyn.planContactDetach(row, consentGroup)
      if (plan.action === 'delete') {
        await deleteDoc(ref)
      } else {
        await updateDoc(ref, {
          ...Object.fromEntries(plan.remove.map((path) => [path, deleteField()])),
          visibleTo: arrayRemove(...plan.removeTokens),
          capturedByHostIds: arrayRemove(...plan.removeHostIds),
          updatedAt: new Date(),
        })
      }
      logActivity('Removed contact from this site', {
        type: 'contact',
        id,
        name: record?.name || record?.email,
      })
      enqueueSnackbar(
        plan.action === 'delete'
          ? 'Contact deleted'
          : 'Contact removed from this site',
        { variant: 'success', persist: false },
      )
      router.push(routes.section('contacts'))
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [
    confirm,
    consentGroup,
    enqueueSnackbar,
    firestore,
    id,
    logActivity,
    record,
    router,
    routes,
    row,
    scope,
  ])

  const overflowItems: RowActionsMenuItem[] = [
    {
      key: 'remove',
      label: 'Delete contact',
      icon: <MdiIcon path={mdiDeleteOutline.path} size={0.8} />,
      destructive: true,
      disabled: !row,
      disabledReason: 'The contact has not loaded',
      onClick: () => void handleRemove(),
    },
  ]

  if (notFound) {
    return (
      <CrmRecordHeader
        kind="Contact"
        title={undefined}
        help={contactDocsHelp}
        backHref={routes.section('contacts')}
        backLabel="Back to contacts"
      >
        {/*
         * Not "no data". A contact that cannot be read is a different
         * situation from one with an empty profile — it may have been
         * removed from this site, or be held only by a site this reader
         * cannot see.
         */}
        <Typography variant="body2" color="text.secondary">
          {'This contact could not be loaded. It may have been removed from this site.'}
        </Typography>
      </CrmRecordHeader>
    )
  }

  return (
    <Stack spacing={3}>
      <CrmRecordHeader
        kind="Contact"
        title={record ? record.name || record.email : undefined}
        subtitle={record?.email}
        help={contactDocsHelp}
        backHref={routes.section('contacts')}
        backLabel="Back to contacts"
        actions={
          record ? (
            <>
              <AddToListButton hostId={hostId} org={org} contactId={id} email={record.email} />
              <CrmSendEmailButton
                hostId={hostId}
                org={org}
                contactId={id}
                email={record.email}
                name={record.name}
              />
            </>
          ) : null
        }
        menuItems={overflowItems}
        loading={!record}
        chips={
          record ? (
            <>
              <CrmRecordChip
                label="Stage"
                value={
                  record.lifecycleStage
                    ? CONTACT_LIFECYCLE_STAGE_LABELS[record.lifecycleStage]
                    : undefined
                }
              />
              <CrmRecordChip
                label="Owner"
                value={record.ownerUid ? members.memberName(record.ownerUid) : undefined}
              />
              {/*
                The last time they opened or clicked one of this site's
                campaigns (AGL-2616) — the relationship's pulse, beside the
                owner who keeps it.
              */}
              <CrmRecordChip
                label="Last engaged"
                value={
                  record.lastEmailEngagementAtMs ? (
                    <Tooltip title={new Date(record.lastEmailEngagementAtMs).toLocaleString()}>
                      <span>
                        {Aglyn.activityTimeLabel(record.lastEmailEngagementAtMs, Date.now())}
                      </span>
                    </Tooltip>
                  ) : undefined
                }
              />
              <CrmRecordChip
                label="Orders"
                value={
                  record.ordersCount > 0 ? (
                    ordersHref ? (
                      <AppLink href={ordersHref} color="inherit" underline="hover">
                        {`${record.ordersCount.toLocaleString()} · $${(record.ltvCents / 100).toFixed(2)} lifetime`}
                      </AppLink>
                    ) : (
                      `${record.ordersCount.toLocaleString()} · $${(record.ltvCents / 100).toFixed(2)} lifetime`
                    )
                  ) : undefined
                }
              />
            </>
          ) : null
        }
      />
      {record && row && scope ? (
        <>
          <ContactPropertiesCard
            hostId={hostId}
            org={org}
            record={record}
            consentGroup={consentGroup}
            scope={scope}
            seed={{ status, fromCache }}
            members={members}
          />
          <ContactAssociationsCard
            hostId={hostId}
            record={record}
            row={row}
            consentGroup={consentGroup}
            scope={scope}
            seed={{ status, fromCache }}
            basePath={basePath}
          />
          <ContactCustomFieldsCard hostId={hostId} org={org} contactId={id} basePath={basePath} />
          <ContactTimelineCard
            hostId={hostId}
            org={org}
            contactId={id}
            contact={row}
            campaignHref={campaignHref}
          />
          <ContactDealsCard
            hostId={hostId}
            org={org}
            basePath={basePath}
            contactId={id}
            contactName={record.name || record.email}
          />
          <RecordTasksCard hostId={hostId} org={org} basePath={basePath} contactId={id} />
        </>
      ) : null}
    </Stack>
  )
}
ContactDetailPage.displayName = 'ContactDetailPage'

export default ContactDetailPage
