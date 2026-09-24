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
  FORMS_MAX_PER_HOST,
  INBOX_SUBMISSION_PARAM,
  pluginDocsHelp,
  type ConsolePluginOrgMount,
} from '@aglyn/aglyn'
// A deep import, NOT the plugin barrel (AGL-1151): the barrel is the entry
// point the tenant's loader dynamically imports to activate the marketing
// plugin's SITE half, so a console card named there ships to every published
// page. The component path reaches the same module without crossing it.
import { InboxRecordAttributionZone } from './inbox-attribution-zone'
// The CRM's route builder by its leaf path, for the reason above: the barrel
// is the plugin's site entry point.
import {
  pluginRecordByEmailHref,
  pluginRecordListHref,
} from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import {
  mdiAccountArrowRight,
  mdiDeleteOutline,
  mdiEmailOpenOutline,
  mdiEmailOutline,
} from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import {
  ListRowActions,
  ListTable,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import type { RowActionsMenuItem } from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import type { ListFilterField } from '@aglyn/shared-ui-jsx/const/list-filter'
import {
  inMemoryListField,
  type ListFilterClause,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { TABLE_ROW_HEIGHT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { usePagedRowsFilter } from '@aglyn/shared-ui-jsx/hooks/use-paged-rows-filter'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  useFirestoreCollection,
  usePagedCollection,
} from '@aglyn/tenant-feature-instance'
import {
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
  Tooltip,
  Typography,
} from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  limit,
  orderBy,
  query,
  updateDoc,
  where,
} from 'firebase/firestore'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  relativeTime,
  routingChips,
  senderHue,
  submissionSender,
} from '../model/submission-presenter'
import { orgSiteName } from './inbox-org-sites'
import SubmissionListAssignment from './submission-list-assignment.component'
import SubmissionReply from './submission-reply.component'
import { useRecordRouteContext } from './use-record-route-context'

/*
 * What the submissions grid's Filters panel offers (AGL-3317).
 *
 * Form is SERVED: its clause is the query's `where('formId', '==')`, so it
 * reaches every submission to that form, and the rows are not matched
 * against it again. It is offered only where a site's catalog is read — not
 * on a card scoped to one form, and not across every site. The rest match
 * over what the paged window has read, which the first filter widens
 * (`usePagedRowsFilter`): From and Message (as the columns draw them), Read
 * (`readKey`), and Site on the organization's Inbox.
 */
const FORM_FIELD: ListFilterField = {
  ...inMemoryListField('formId', 'select'),
  operators: ['equals'],
}
const SUBMISSION_BASE_FIELDS = [
  inMemoryListField('from', 'text', 'senderLabel'),
  inMemoryListField('message', 'text', 'messageText'),
  inMemoryListField('read', 'select', 'readKey'),
]
const SUBMISSION_FILTER_HEADERS: Readonly<Record<string, string>> = {
  from: 'From',
  message: 'Message',
  read: 'Read',
  formId: 'Form',
  hostId: 'Site',
}
const READ_OPTIONS = [
  { value: 'unread', label: 'Unread' },
  { value: 'read', label: 'Read' },
]
const SUBMISSION_SEARCH_FIELDS = ['senderLabel', 'formName', 'messageText'] as const
const SUBMISSION_HIDDEN_COLUMNS = { read: false, formId: false }
/** The one clause the query serves. */
const servedByQuery = (clause: ListFilterClause) => clause.field === 'formId'

/** A submission with the derived values its filters and search read. */
const withFilterValues = (submission: any) => ({
  ...submission,
  senderLabel: submissionSender(submission.fields).label,
  messageText: Object.entries(submission.fields ?? {})
    .map(([key, value]) => `${key}: ${value}`)
    .join(' · '),
  readKey: submission.read ? 'read' : 'unread',
})

/**
 * The Submissions section of the Inbox (AGL-77/104/109 → AGL-395): the form
 * messages a site collected, newest first, and the reader that opens one.
 *
 * Its own component since AGL-2501, when the Inbox's tabs became routes. The
 * split is what makes "mount only the section being read" structural: hooks
 * cannot be conditional, so a page holding every section's reads pays for all
 * of them whichever one the URL names.
 */
export interface SubmissionsCardProps {
  /**
   * The site whose submissions are listed, or `null` on the organization's
   * Inbox, where the card lists every site's at once (AGL-3303) and each row
   * is acted on as the site it was sent to.
   */
  hostId: string | null
  /** The organization and its sites — present exactly when `hostId` is `null`. */
  orgMount?: ConsolePluginOrgMount
  /**
   * Narrow this card to ONE form, permanently.
   *
   * What the forms plugin's detail surface renders instead of a second
   * submissions table. The reader has already chosen the subject by being on
   * that page, so scoping here does three things a copy would have had to
   * re-derive: the form picker is not rendered (there is nothing to pick),
   * the site's `forms` collection is not read at all (the picker was its only
   * consumer), and the empty state names the form rather than the site.
   *
   * Everything else — the paged walk, the reader dialog, read/unread,
   * delete, reply, list assignment, attribution — is the same code answering
   * a narrower query. That is the reason this is a prop rather than a second
   * component: a per-form table written separately would be a second reader
   * to keep in step, and it would have been the one to reintroduce the
   * unordered `limit()` this card's own comment exists to warn about.
   */
  formId?: string
}

export function SubmissionsCard({
  hostId,
  formId,
  orgMount,
}: SubmissionsCardProps) {
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  /** Scoped to one form: the subject is fixed and nothing may widen it. */
  const scoped = Boolean(formId)
  /** Every site of this organization at once, when no site is named. */
  const orgId = hostId == null ? (orgMount?.orgId ?? null) : null
  /*
   * The site a row lives on, which is where every act on it is addressed:
   * this card's own site, or — across every site — the `hostId` the submit
   * route stamps on the row. That stamp is frozen against a client update and
   * written from the row's own path, so it names the document's real parent;
   * the rules check the host role on that site either way.
   */
  const siteOf = useCallback(
    (submission: any): string | null =>
      hostId ??
      (typeof submission?.hostId === 'string' && submission.hostId
        ? submission.hostId
        : null),
    [hostId],
  )
  /*
   * Where the sender's CONTACT is (AGL-2612). A submission that carried an
   * address updated a contact in the CRM at stage Lead; the row links to
   * it by that address, and the Contacts list — which holds the id nothing
   * here does — opens the record. The same hub path the Members & leads
   * rows use to open a lead.
   */
  const routeContext = useRecordRouteContext()

  /*
   * The site's forms, for the Submissions filter.
   *
   * `FORMS_MAX_PER_HOST` is a read WINDOW, not a cap on the collection — how
   * many forms a site may hold is `formsPerHost`, enforced at the create in
   * `/api/hosts/resources`, and a staff-set per-org override can raise it
   * past this window. So the window can be smaller than the catalog, and one
   * more document than fits is read on purpose: a filter that quietly listed
   * the first N would report "this form does not exist" and "this form is
   * past the window" as the same empty answer.
   *
   * Ordered by `__name__`. `displayName` would be the nicer order and is the
   * wrong instrument: `orderBy` on a data field DROPS every document missing
   * it, invisibly, so a form saved without a name would vanish from its own
   * filter. The list is sorted for display below, where a missing name is
   * merely ugly.
   */
  const { data: formDocs } = useFirestoreCollection<any>(
    () =>
      // Forms are one site's catalog. Across every site there is no single
      // catalog to filter by, and picking a site is how a reader gets one.
      scoped || !hostId
        ? null
        : query(
            collection(firestore, 'hosts', hostId, 'forms'),
            orderBy('__name__'),
            limit(FORMS_MAX_PER_HOST + 1),
          ),
    [firestore, hostId, scoped],
    { idField: '$id' },
  )
  /** More forms exist than the window shows; the filter has to say so. */
  const formsTruncated = (formDocs?.length ?? 0) > FORMS_MAX_PER_HOST
  const forms = useMemo(
    () =>
      [...(formDocs ?? [])]
        .slice(0, FORMS_MAX_PER_HOST)
        .sort((left: any, right: any) =>
          String(left.displayName ?? left.$id).localeCompare(
            String(right.displayName ?? right.$id),
          ),
        ),
    [formDocs],
  )
  /*
   * The panel's clauses, held here because the Form clause is the query's.
   * No clause is "All forms"; a Form clause narrows to one form's
   * submissions.
   *
   * `formFilter` is a PRIMITIVE, deliberately: `usePagedCollection` reopens
   * its listener when a dep changes, and an object identity would tear down
   * and reopen on every render. It also resets the reader to page 1, which
   * is what switching subjects should do.
   */
  const [clauses, setClauses] = useState<ListFilterClause[]>([])
  const formFilter =
    clauses.find((clause) => clause.field === 'formId' && clause.op === 'equals')
      ?.value || null
  /**
   * The form the query is actually narrowed to.
   *
   * The scope wins over the panel rather than seeding it. A scoped card
   * offers no Form filter, so a `formFilter` that could outrank `formId`
   * would be a filter with no control — reachable only by a state change
   * nothing on screen can cause, and unclearable if one ever could.
   */
  const activeForm = formId ?? formFilter

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
    data: submissionData,
    rows: submissionRows,
    hasMore: hasMoreSubmissions,
    page: submissionPage,
    setPage: setSubmissionPage,
    pageSize: submissionPageSize,
    setPageSize: setSubmissionPageSize,
  } = usePagedCollection<any>(
    (pageLimit) =>
      hostId
        ? query(
            collection(firestore, 'hosts', hostId, 'formSubmissions'),
            // Served by the `formId ASC, createdAt DESC` composite index in
            // `cloud/firebase-firestore.indexes.json`, which must be deployed
            // before this ships — without it Firestore refuses the query
            // rather than answering it slowly.
            ...(activeForm ? [where('formId', '==', activeForm)] : []),
            orderBy('createdAt', 'desc'),
            limit(pageLimit),
          )
        : orgId
          ? query(
              /*
               * EVERY SITE'S SUBMISSIONS IN ONE BOUNDED QUERY (AGL-3303), not
               * a listener per site: the same page-plus-probe window, over
               * the collection group, newest first.
               *
               * The `orgId` clause is not a filter this card could drop. The
               * rules admit a group read only when it is narrowed to an org
               * the reader spans, so an unfiltered group query is refused
               * outright. Served by the `orgId ASC, createdAt DESC`
               * COLLECTION_GROUP index. Every submission carries `orgId`: the
               * submit route stamps it, and the rows written before it did
               * were stamped once (AGL-3303). A row without one would be in no
               * organization's list, though its own site's Inbox lists it
               * either way.
               */
              collectionGroup(firestore, 'formSubmissions'),
              where('orgId', '==', orgId),
              orderBy('createdAt', 'desc'),
              limit(pageLimit),
            )
          : null,
    [firestore, hostId, orgId, activeForm],
    { idField: '$id' },
  )
  /** Form is offered where the site's catalog is read. */
  const offersForm = !scoped && Boolean(hostId) && forms.length > 0
  const submissionFields = useMemo(
    () => [
      ...SUBMISSION_BASE_FIELDS,
      ...(offersForm ? [FORM_FIELD] : []),
      ...(hostId == null ? [inMemoryListField('hostId', 'select')] : []),
    ],
    [offersForm, hostId],
  )
  const submissionOptions = useMemo(
    () => ({
      read: READ_OPTIONS,
      ...(offersForm
        ? {
            formId: forms.map((form: any) => ({
              value: String(form.$id),
              label: String(form.displayName || form.$id),
            })),
          }
        : {}),
      ...(hostId == null
        ? {
            hostId: (orgMount?.hosts ?? []).map((host) => ({
              value: host.id,
              label: host.name || host.id,
            })),
          }
        : {}),
    }),
    [offersForm, forms, hostId, orgMount],
  )
  const submissionWindow = useMemo(
    () => submissionData?.map(withFilterValues),
    [submissionData],
  )
  const submissionPageRows = useMemo(
    () => submissionRows.map(withFilterValues),
    [submissionRows],
  )
  const submissionFilter = usePagedRowsFilter<any>(
    {
      data: submissionWindow,
      rows: submissionPageRows,
      hasMore: hasMoreSubmissions,
      page: submissionPage,
      setPage: setSubmissionPage,
      pageSize: submissionPageSize,
      setPageSize: setSubmissionPageSize,
    },
    {
      fields: submissionFields,
      options: submissionOptions,
      headers: SUBMISSION_FILTER_HEADERS,
      search: SUBMISSION_SEARCH_FIELDS,
      served: servedByQuery,
      clauses,
      onChange: setClauses,
    },
  )
  // The rows on screen: the page, or the page of the matches.
  const submissions = submissionFilter.rows
  /** Narrowed by nothing but the served Form clause. */
  const onlyForm =
    Boolean(formFilter) &&
    clauses.every(servedByQuery) &&
    submissionFilter.gridFilter.searchWords.length === 0

  // Mail reader (AGL-104): opening a submission shows the full message and
  // marks it read.
  const [reader, setReader] = useState<any | null>(null)
  const handleOpenReader = useCallback(
    (submission: any) => () => {
      setReader(submission)
      const site = siteOf(submission)
      if (!submission.read && site) {
        void updateDoc(
          doc(firestore, 'hosts', site, 'formSubmissions', submission.$id),
          { read: true },
        )
      }
    },
    [firestore, siteOf],
  )

  const handleToggleRead = useCallback(
    (submission: any) => () => {
      const site = siteOf(submission)
      if (!site) return
      void updateDoc(
        doc(firestore, 'hosts', site, 'formSubmissions', submission.$id),
        { read: !submission.read },
      )
    },
    [firestore, siteOf],
  )

  /*
   * A submission named in the URL opens in the reader on arrival (AGL-2622).
   *
   * A contact's timeline names the submission that captured the person, and
   * the address it links to is this tab with `?submission={id}`. The
   * document is read once, by id, rather than looked for in the paged
   * window: the window is the newest page of a walk that may not reach a
   * submission from months back, and one document read is what the URL
   * asked for. Opening it marks it read, as a click on the row would. A
   * submission that is gone says so, because a reader that silently stays
   * shut reads as the link having done nothing.
   *
   * Once per id: the ref keeps a re-render — and the same URL re-settling —
   * from reopening a reader the person has since closed. The landing read
   * is judged against that ref rather than an effect cleanup: a listener
   * settling while the read is in flight re-renders this card, and a
   * cleanup keyed on any dep would cancel the answer to the question the
   * URL just asked.
   */
  const searchParams = useSearchParams()
  const seededSubmissionId = searchParams?.get(INBOX_SUBMISSION_PARAM) ?? null
  const seededOpened = useRef<string | null>(null)
  useEffect(() => {
    // A submission link names one site's Inbox; the org's has no site to read
    // the id under.
    if (!hostId) return
    if (!seededSubmissionId || seededOpened.current === seededSubmissionId) return
    seededOpened.current = seededSubmissionId
    void getDoc(doc(firestore, 'hosts', hostId, 'formSubmissions', seededSubmissionId))
      .then((snapshot) => {
        if (seededOpened.current !== snapshot.id) return
        if (!snapshot.exists()) {
          enqueueSnackbar('That submission is no longer in the Inbox.', {
            variant: 'warning',
            persist: false,
          })
          return
        }
        handleOpenReader({ ...snapshot.data(), $id: snapshot.id })()
      })
      .catch(() => undefined)
  }, [seededSubmissionId, firestore, hostId, handleOpenReader, enqueueSnackbar])

  const handleDelete = useCallback(
    (submission: any) => async () => {
      const site = siteOf(submission)
      if (!site) return
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
        doc(firestore, 'hosts', site, 'formSubmissions', submission.$id),
      )
      enqueueSnackbar('Submission deleted', {
        variant: 'success',
        persist: false,
      })
    },
    [confirm, firestore, siteOf, enqueueSnackbar],
  )

  /*
   * One row per submission, newest first: who sent it, what it said and how
   * long ago. The row opens the reader, which also marks it read.
   */
  const submissionActions = (submission: any): RowActionsMenuItem[] => {
    const senderEmail = submissionSender(submission.fields).email
    // Where the sender's contact is read, asked of whichever plugin keeps
    // people; with none loaded there is no such page, and no menu item.
    const contactsHref = routeContext
      ? pluginRecordListHref('contact', routeContext)
      : null
    return [
      ...(routeContext && contactsHref
        ? [
            {
              key: 'crm',
              label: 'Open contact in CRM',
              icon: <MdiIcon path={mdiAccountArrowRight.path} size={0.8} />,
              ...(senderEmail
                ? {
                    href:
                      pluginRecordByEmailHref(
                        'contact',
                        routeContext,
                        senderEmail,
                      ) ?? contactsHref,
                  }
                : {
                    disabled: true,
                    disabledReason:
                      'This submission carried no email address, so no contact was updated.',
                  }),
            },
          ]
        : []),
      {
        key: 'read',
        label: submission.read ? 'Mark unread' : 'Mark read',
        icon: (
          <MdiIcon
            path={submission.read ? mdiEmailOutline.path : mdiEmailOpenOutline.path}
            size={0.8}
          />
        ),
        onClick: handleToggleRead(submission),
      },
      {
        key: 'delete',
        label: 'Delete',
        icon: <MdiIcon path={mdiDeleteOutline.path} size={0.8} />,
        destructive: true,
        onClick: handleDelete(submission),
      },
    ]
  }
  const submissionColumns: GridColDef[] = [
    {
      /*
        The mockup's list is people, not forms (AGL-2168): an initials avatar,
        the sender, and the form name beneath it. The unread DOT replaces the
        `New` chip — the row is already bold, and a chip that says "New" beside
        bold text is the same fact twice.
       */
      field: 'from',
      headerName: 'From',
      flex: 1,
      minWidth: 220,
      valueGetter: (_value, submission) => submission.senderLabel,
      renderCell: ({ row: submission }) => {
        const sender = submissionSender(submission.fields)
        const hue = senderHue(sender.label)
        return (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
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
              <Typography variant="caption" color="text.secondary" noWrap>
                {submission.formName ?? 'Form'}
              </Typography>
            </Stack>
          </Stack>
        )
      },
    },
    /*
      Which site it was sent to, on the organization's Inbox only — under a
      site every row is that site's, and a column saying so would be noise.
     */
    ...(hostId == null
      ? [
          {
            field: 'hostId',
            headerName: 'Site',
            flex: 1,
            minWidth: 140,
            // Sorted and drawn by name; the filter matches the id.
            valueGetter: (_value: unknown, submission: any) =>
              orgSiteName(orgMount, submission.hostId),
            renderCell: ({ row: submission }: { row: any }) =>
              orgSiteName(orgMount, submission.hostId),
          } satisfies GridColDef,
        ]
      : []),
    {
      field: 'message',
      headerName: 'Message',
      flex: 2,
      minWidth: 260,
      valueGetter: (_value, submission) => submission.messageText,
      renderCell: ({ value }) => (
        <Typography variant="body2" noWrap>
          {value}
        </Typography>
      ),
    },
    {
      /*
        Relative, as the mockup shows it — an inbox is scanned for recency and a
        locale timestamp makes the reader do the subtraction. The absolute time
        stays on the detail dialog, where it is the fact you actually want.
       */
      field: 'createdAt',
      headerName: 'Received',
      width: 130,
      valueGetter: (_value, submission) =>
        submission.createdAt?.toDate?.()?.getTime?.() ?? 0,
      renderCell: ({ row: submission }) => (
        <Tooltip title={submission.createdAt?.toDate?.().toLocaleString() ?? ''}>
          <span>{relativeTime(submission.createdAt?.toDate?.().getTime())}</span>
        </Tooltip>
      ),
    },
    /*
      One overflow menu, as the Members & leads rows have: two inline buttons
      had no room for a third, and the contact link is the one a reader
      reaches for after reading. Present but disabled for a submission with no
      address, with the reason — a row that simply lacked the item would read
      as the contact not existing.
     */
    listActionsColumn(
      (submission) => (
        <ListRowActions
          label={String(submissionSender(submission.fields).email ?? submission.$id)}
          items={submissionActions(submission)}
        />
      ),
      { width: 72 },
    ),
  ]

  /** The site the open submission was sent to, which its reader acts as. */
  const readerSite = reader ? siteOf(reader) : null

  return (
    <>
      <CardDisplay
        header={scoped ? 'Submissions to this form' : 'Form Submissions'}
        help={pluginDocsHelp(
          'forms',
          hostId == null
            ? {
                anchor: '#every-sites-inbox-at-once',
                excerpt:
                  'Every site’s form messages in one list, newest first, ' +
                  'each under the site it was sent to.',
              }
            : {
                anchor: '#the-inbox',
                excerpt:
                  'Messages your forms collected, newest first, showing who ' +
                  'sent each one and where it was routed.',
              },
        )}
        contentGutterX
        contentGutterY
        contentBordered="all"
      >
        {/*
          * The Inbox stays the site-wide answer to "who is waiting for a
          * reply" — that question does not decompose by form. The panel's
          * Form filter narrows it on request; it does not turn the page into
          * a per-form view. It is offered only when the site HAS forms, and
          * never on a card already scoped to one.
          */}
        {offersForm && formsTruncated ? (
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
            {`The Form filter offers the first ${FORMS_MAX_PER_HOST.toLocaleString()} ` +
              'forms. Narrow by form is incomplete; with no Form filter the ' +
              'list still covers every submission.'}
          </Typography>
        ) : null}
        {hostId == null ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mb: submissions.length ? 2 : 1 }}
          >
            {'Every site’s submissions, newest first. Choose a site to ' +
              'narrow them by form.'}
          </Typography>
        ) : null}
        {submissionRows.length === 0 &&
        !hasMoreSubmissions &&
        !submissionFilter.filtering ? (
          <Typography variant="body2" color="text.secondary">
            {scoped
              ? 'No submissions carry this form’s id yet. Messages this ' +
                'form’s design collected before it became a form entity are ' +
                'in the Inbox, filed under the name they were sent with.'
              : hostId == null
                  ? 'No form submissions on any site yet.'
                  : 'No form submissions yet. Add a Contact Form element to a ' +
                    'screen — visitor messages arrive here.'}
          </Typography>
        ) : (
          <>
            <ListFilterChips {...submissionFilter.chipsProps} servedField="formId" />
            {submissionFilter.filtering && hasMoreSubmissions ? (
              <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
                {`Filtering the ${submissionFilter.read} submissions read so far — the next page reads more.`}
              </Typography>
            ) : null}
            <ListTable
              aria-label={scoped ? 'Submissions to this form' : 'Form submissions'}
              rows={submissions}
              columns={submissionFilter.filterColumns(submissionColumns)}
              initialState={{ columns: { columnVisibilityModel: SUBMISSION_HIDDEN_COLUMNS } }}
              noRowsLabel={
                onlyForm
                  ? 'No submissions for this form yet. Submissions sent before ' +
                    'the form was created are listed with no Form filter.'
                  : 'No submissions match these filters'
              }
              rowHeight={TABLE_ROW_HEIGHT}
              onOpen={(_id, submission) => handleOpenReader(submission)()}
              // An unread submission reads bold across its row, which is why
              // the list needs no `New` chip.
              getRowClassName={({ row }) => (row.read ? '' : 'submission-unread')}
              sx={{
                '& .submission-unread .MuiDataGrid-cell, & .submission-unread .MuiTypography-root':
                  { fontWeight: 'fontWeightBold' },
              }}
              // Paged by the footer below, so the grid must not also slice.
              hideFooter
              // The panel and the search are the grid's: Form is the query's
              // clause, the rest are answered over what the window read.
              {...submissionFilter.gridProps}
            />
            <ListPagination {...submissionFilter.pagination} />
          </>
        )}
      </CardDisplay>
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
              // The site it was sent to, where the list spans every site.
              (hostId == null && readerSite
                ? ` · ${orgSiteName(orgMount, readerSite)}`
                : '') +
              (reader?.screenId ? ` · screen ${reader.screenId}` : '')}
            {/*
              THE PAGE THE FORM WAS ON. Stored by the submit route since the
              form existed and rendered by nothing, which is also the field
              the marketing console's landing-page grouping joins on — a
              reader who wants to check one row against that grouping has to
              be able to see the row's own page.
             */}
            {reader?.path ? ` · ${String(reader.path)}` : ''}
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
          {/*
            WHERE THIS SUBMISSION CAME FROM.

            One keyed document read — the attribution's id is `form:{id}` and
            the submission's id is that `{id}` — paid when a merchant opens a
            submission rather than once per row of the list. A submission that
            was credited to nobody renders the sentence saying so; it never
            renders a campaign with a zero beside it.
           */}
          {reader?.$id && readerSite ? (
            <Box sx={{ mt: 2 }}>
              <InboxRecordAttributionZone
                hostId={readerSite}
                recordKind="form"
                recordId={String(reader.$id)}
              />
            </Box>
          ) : null}
          {/*
            Answering the person is the act the Inbox exists for, and it is
            inside the reader rather than on the row because a reply written
            without the message in front of you is the reply that answers the
            wrong question. Mounted with the dialog, so its reads — the site
            name and the replies already sent — are paid when a merchant opens
            a submission and not once per visit to this page.
           */}
          {reader && readerSite ? (
            <SubmissionReply hostId={readerSite} submission={reader} />
          ) : null}
          {/*
            Enrolling the sender in a marketing list — a SEPARATE act from
            answering them, and a separate card, because the person asked to
            be answered and did not ask to be marketed to. Its reads are paid
            only when a merchant presses its own button, so opening a
            submission to read it costs nothing extra.
           */}
          {reader && readerSite ? (
            <SubmissionListAssignment hostId={readerSite} submission={reader} />
          ) : null}
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
SubmissionsCard.displayName = 'SubmissionsCard'

export default SubmissionsCard
