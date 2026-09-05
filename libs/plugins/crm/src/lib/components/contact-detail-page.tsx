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
import {
  CONTACT_LIFECYCLE_STAGE_LABELS,
  PageHeaderRecord,
  pluginDocsHelp,
} from '@aglyn/aglyn'
import { mdiDeleteOutline } from '@aglyn/shared-data-mdi'
import {
  AppLink,
  CardDisplay,
  MdiIcon,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import RowActionsMenu, {
  type RowActionsMenuItem,
} from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  useFirestoreDoc,
  useHostActivityLogger,
  useOrgDataScope,
} from '@aglyn/tenant-feature-instance'
import { Button, Chip, Stack, Typography } from '@mui/material'
import {
  arrayRemove,
  deleteDoc,
  deleteField,
  doc,
  updateDoc,
} from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo } from 'react'
import { contactRecordFromDoc } from '../model/contact-record'
import { type CrmDetailPageProps, crmRoutes } from '../model/crm-routes'
import ContactAssociationsCard from './contact-associations-card'
import ContactCustomFieldsCard from './contact-custom-fields-card'
import ContactPropertiesCard from './contact-properties-card'
import ContactTimelineCard from './contact-timeline-card'
import { AddToListButton } from './add-to-list-button'
import { ContactDealsCard } from './contact-deals-card'
import { RecordTasksCard } from './record-tasks-card'
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

  const headerActions = (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Button
        component={AppLink as any}
        {...({ componentVariant: 'naked', nativeButton: false } as any)}
        href={routes.section('contacts')}
        size="small"
        color="primary"
      >
        {'Back to contacts'}
      </Button>
      {record ? (
        <AddToListButton hostId={hostId} org={org} contactId={id} email={record.email} />
      ) : null}
      <RowActionsMenu label={record?.name || record?.email || 'Contact'} items={overflowItems} />
    </Stack>
  )

  if (notFound) {
    return (
      <CardDisplay
        header={'Contact'}
        help={contactDocsHelp}
        contentGutterX
        contentGutterY
        HeaderProps={{ action: headerActions }}
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
      </CardDisplay>
    )
  }

  return (
    <Stack spacing={3}>
      {/* The page heading and the trail name the person; the card is then
          free to say what it holds rather than repeating the title. */}
      <PageHeaderRecord
        title={record ? record.name || record.email : undefined}
      />
      <CardDisplay
        header={'Contact'}
        subheader={record?.email}
        help={contactDocsHelp}
        contentGutterX
        contentGutterY
        HeaderProps={{ action: headerActions }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          {record?.lifecycleStage ? (
            <Chip
              size="small"
              variant="outlined"
              label={CONTACT_LIFECYCLE_STAGE_LABELS[record.lifecycleStage]}
            />
          ) : null}
          {record?.ownerUid ? (
            <Typography variant="body2" color="text.secondary">
              {`Owner: ${members.memberName(record.ownerUid)}`}
            </Typography>
          ) : null}
          {record && record.ordersCount > 0 ? (
            <Typography variant="body2" color="text.secondary">
              {`${record.ordersCount.toLocaleString()} order${
                record.ordersCount === 1 ? '' : 's'
              } · $${(record.ltvCents / 100).toFixed(2)} lifetime`}
            </Typography>
          ) : null}
          {!record ? (
            <Typography variant="body2" color="text.secondary">
              {'Loading…'}
            </Typography>
          ) : null}
        </Stack>
      </CardDisplay>
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
          />
          <ContactCustomFieldsCard hostId={hostId} org={org} contactId={id} />
          <ContactTimelineCard hostId={hostId} org={org} contactId={id} contact={row} />
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
