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

import { mdiInboxArrowDown } from '@aglyn/shared-data-mdi'
import {
  CardDisplay,
  Container,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import { NextPageTitle, NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
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
import { useFirestore } from 'reactfire'
import HostDisplayNameComponent from '../../../components/host-display-name.component'
import HostCampaignsCard from '../../../components/host-campaigns-card.component'
import { useHostId } from '../../../components/host-id-provider'
import HostOrdersCard from '../../../components/commerce/host-orders-card.component'
import AuthenticatedLayout from '../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../components/layouts/dashboard.layout'
import MainLayout from '../../../components/layouts/main.layout'
import { buildRoute, Route } from '../../../constants/route-links'
import hostNavTabItems from '../../../constants/host-nav-tabs'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'
import useFirestoreCollection from '../../../hooks/use-firestore-collection'

/** Form submissions inbox (AGL-77). */
const HostInbox: NextPageWithLayout = () => {
  const hostId = useHostId()
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
      <NextPageTitle screen={'Inbox'} />
      <DashboardLayout
        navTabItems={hostNavTabItems(hostId)}
        breadcrumbItems={[
          {
            children: <HostDisplayNameComponent hostId={hostId} />,
            href: buildRoute(Route.HOST_DASHBOARD, { hostId }),
          },
          {
            children: 'Inbox',
            href: buildRoute(Route.HOST_INBOX, { hostId }),
          },
        ]}
        header={{
          children: 'Inbox',
          icon: { path: mdiInboxArrowDown.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
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
                          <Chip label="New" color="secondary" size="small" />
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
          <Stack spacing={3} sx={{ mt: 3 }}>
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
                          <Chip label="Member" color="secondary" size="small" />
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
          <div style={{ marginTop: 24 }}>
            <HostCampaignsCard hostId={hostId} />
          </div>
        </Container>
      </DashboardLayout>
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
HostInbox.displayName = 'Page:HostInbox'
HostInbox.layouts = [
  {
    Component: AuthenticatedLayout,
  },
  {
    Component: MainLayout,
    props: {
      title: 'Inbox',
    },
  },
]

export default HostInbox
