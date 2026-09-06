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

import { FORMS_MAX_PER_HOST, pluginDocsHelp } from '@aglyn/aglyn'
// A deep import, NOT the plugin barrel (AGL-1151): the barrel is the entry
// point the tenant's loader dynamically imports to activate the marketing
// plugin's SITE half, so a console card named there ships to every published
// page. The component path reaches the same module without crossing it.
import { default as ConversionAttribution } from '@aglyn/plugins-marketing/components/conversion-attribution.component'
// The CRM's route builder by its leaf path, for the reason above: the barrel
// is the plugin's site entry point.
import { crmRoutes } from '@aglyn/plugins-crm/model/crm-routes'
import {
  mdiAccountArrowRight,
  mdiDeleteOutline,
  mdiEmailOpenOutline,
  mdiEmailOutline,
} from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import RowActionsMenu from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
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
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
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
  where,
} from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import {
  relativeTime,
  routingChips,
  senderHue,
  submissionSender,
} from '../model/submission-presenter'
import SubmissionListAssignment from './submission-list-assignment.component'
import SubmissionReply from './submission-reply.component'
import { useCrmHubPath } from './use-crm-hub-path'

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
  hostId: string
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

export function SubmissionsCard({ hostId, formId }: SubmissionsCardProps) {
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  /** Scoped to one form: the subject is fixed and nothing may widen it. */
  const scoped = Boolean(formId)
  /*
   * Where the sender's CONTACT is (AGL-2612). A submission that carried an
   * address updated a contact in the CRM at stage Lead; the row links to
   * it by that address, and the Contacts list — which holds the id nothing
   * here does — opens the record. The same hub path the Members & leads
   * rows use to open a lead.
   */
  const crmHubPath = useCrmHubPath()

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
      scoped
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
   * `null` is "All forms"; a form id narrows to one form's submissions.
   *
   * A PRIMITIVE, deliberately: `usePagedCollection` reopens its listener when
   * a dep changes, and an object identity would tear down and reopen on every
   * render. It also resets the reader to page 1, which is what switching
   * subjects should do.
   */
  const [formFilter, setFormFilter] = useState<string | null>(null)
  /**
   * The form the query is actually narrowed to.
   *
   * The scope wins over the picker rather than seeding it. A scoped card
   * renders no picker, so a `formFilter` that could outrank `formId` would be
   * a filter with no control — reachable only by a state change nothing on
   * screen can cause, and unclearable if one ever could.
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
        // Served by the `formId ASC, createdAt DESC` composite index in
        // `cloud/firebase-firestore.indexes.json`, which must be deployed
        // before this ships — without it Firestore refuses the query rather
        // than answering it slowly.
        ...(activeForm ? [where('formId', '==', activeForm)] : []),
        orderBy('createdAt', 'desc'),
        limit(pageLimit),
      ),
    [firestore, hostId, activeForm],
    { idField: '$id' },
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
      <CardDisplay
        header={scoped ? 'Submissions to this form' : 'Form Submissions'}
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
        {/*
          * The Inbox stays the site-wide answer to "who is waiting for a
          * reply" — that question does not decompose by form. This narrows
          * it on request; it does not turn the page into a per-form view.
          *
          * Rendered only when the site HAS forms, so a site that has not
          * adopted any sees the page exactly as it was.
          */}
        {/*
          * Withheld when the card is scoped: the subject is settled by the
          * surface this is rendered on, and a picker offering to widen it
          * would be a control that navigates away from the page it is on.
          */}
        {!scoped && forms.length > 0 ? (
          <TextField
            select
            size="small"
            label={'Form'}
            value={formFilter ?? ''}
            onChange={(event) => setFormFilter(event.target.value || null)}
            helperText={
              formsTruncated
                ? `Showing the first ${FORMS_MAX_PER_HOST.toLocaleString()} ` +
                  'forms. Narrow by form is incomplete; All forms still ' +
                  'covers every submission.'
                : undefined
            }
            sx={{ mb: 2, minWidth: 240 }}
          >
            <MenuItem value="">{'All forms'}</MenuItem>
            {forms.map((form: any) => (
              <MenuItem key={form.$id} value={form.$id}>
                {form.displayName || form.$id}
              </MenuItem>
            ))}
          </TextField>
        ) : null}
        {submissions.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {scoped
              ? 'No submissions carry this form’s id yet. Messages this ' +
                'form’s design collected before it became a form entity are ' +
                'in the Inbox, filed under the name they were sent with.'
              : activeForm
                ? 'No submissions for this form yet. Submissions sent before ' +
                  'the form was created stay under All forms.'
                : 'No form submissions yet. Add a Contact Form element to a ' +
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
                      sx={{ whiteSpace: 'nowrap', width: 56 }}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {/*
                        One overflow menu, as the Members & leads rows have:
                        two inline buttons had no room for a third, and the
                        contact link is the one a reader reaches for after
                        reading. Present but disabled for a submission with
                        no address, with the reason — a row that simply
                        lacked the item would read as the contact not
                        existing.
                      */}
                      {(() => {
                        const senderEmail = submissionSender(submission.fields).email
                        return (
                          <RowActionsMenu
                            label={String(senderEmail ?? submission.$id)}
                            items={[
                              ...(crmHubPath
                                ? [
                                    {
                                      key: 'crm',
                                      label: 'Open contact in CRM',
                                      icon: (
                                        <MdiIcon
                                          path={mdiAccountArrowRight.path}
                                          size={0.8}
                                        />
                                      ),
                                      ...(senderEmail
                                        ? {
                                            href: crmRoutes(
                                              crmHubPath,
                                            ).contactByEmail(senderEmail),
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
                                    path={
                                      submission.read
                                        ? mdiEmailOutline.path
                                        : mdiEmailOpenOutline.path
                                    }
                                    size={0.8}
                                  />
                                ),
                                onClick: handleToggleRead(submission),
                              },
                              {
                                key: 'delete',
                                label: 'Delete',
                                icon: (
                                  <MdiIcon path={mdiDeleteOutline.path} size={0.8} />
                                ),
                                destructive: true,
                                onClick: handleDelete(submission),
                              },
                            ]}
                          />
                        )
                      })()}
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
          {reader?.$id ? (
            <Box sx={{ mt: 2 }}>
              <ConversionAttribution
                hostId={hostId}
                kind="form"
                refId={String(reader.$id)}
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
          {reader ? (
            <SubmissionReply hostId={hostId} submission={reader} />
          ) : null}
          {/*
            Enrolling the sender in a marketing list — a SEPARATE act from
            answering them, and a separate card, because the person asked to
            be answered and did not ask to be marketed to. Its reads are paid
            only when a merchant presses its own button, so opening a
            submission to read it costs nothing extra.
           */}
          {reader ? (
            <SubmissionListAssignment hostId={hostId} submission={reader} />
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
