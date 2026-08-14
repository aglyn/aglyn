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
  formSubmissionsPausedNotice,
  submissionMonthKey,
} from '@aglyn/aglyn'
import { CampaignsCard as HostCampaignsCard } from '@aglyn/plugins-email'
import { HostOrdersCard } from '@aglyn/plugins-commerce'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { HubTabs } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  useFirestoreCollection,
  useFirestoreDoc,
} from '@aglyn/tenant-feature-instance'
import {
  Alert,
  AlertTitle,
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
  Typography,
} from '@mui/material'
import {
  collection,
  deleteDoc,
  doc,
  limit,
  query,
  updateDoc,
} from 'firebase/firestore'
import { useCallback, useState } from 'react'

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

  const { data: submissionDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'formSubmissions'),
        limit(200),
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const submissions = [...(submissionDocs ?? [])].sort(
    (a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0),
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

  // Site members + leads (AGL-109).
  const { data: memberDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'siteMembers'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const siteMembers = [...(memberDocs ?? [])].sort(
    (a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0),
  )
  const { data: leadDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'leads'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const leads = [...(leadDocs ?? [])].sort(
    (a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0),
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
      <HubTabs
            tabs={[
              {
                id: 'submissions',
                label: 'Submissions',
                content: (
                  <CardDisplay
                    header={'Form Submissions'}
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
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{'Form'}</TableCell>
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
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center' }}
                      >
                        <span>{submission.formName ?? 'Form'}</span>
                        {!submission.read ? (
                          <Chip label="New" color="primary" size="small" />
                        ) : null}
                      </Stack>
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
                      {submission.createdAt?.toDate?.().toLocaleString() ??
                        '--'}
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
                    {siteMembers.map((member) => (
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
                    {leads
                      .filter(
                        (lead) =>
                          !siteMembers.some(
                            (member) => member.email === lead.email,
                          ),
                      )
                      .map((lead) => (
                        <TableRow key={lead.$id} hover>
                          <TableCell>{lead.email}</TableCell>
                          <TableCell>
                            <Chip label="Lead" size="small" variant="outlined" />
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
