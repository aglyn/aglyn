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

import { ICON_VARIANT_APP_SETTINGS } from '@aglyn/shared-data-enums'
import { Container, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { NextPageTitle, NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Chip,
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
import { useCallback } from 'react'
import { useFirestore, useFirestoreCollectionData } from 'reactfire'
import HostDisplayNameComponent from '../../../components/host-display-name.component'
import { useHostId } from '../../../components/host-id-provider'
import AuthenticatedLayout from '../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../components/layouts/dashboard.layout'
import MainLayout from '../../../components/layouts/main.layout'
import { buildRoute, Route } from '../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'

/** Form submissions inbox (AGL-77). */
const HostInbox: NextPageWithLayout = () => {
  const hostId = useHostId()
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()

  const { data: submissionDocs } = useFirestoreCollectionData<any>(
    query(
      collection(firestore, 'hosts', hostId, 'formSubmissions'),
      limit(200),
    ),
    { idField: '$id' },
  )
  const submissions = [...(submissionDocs ?? [])].sort(
    (a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0),
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
        navTabItems={[
          {
            id: 'nav-tab-dashboard',
            label: 'Dashboard',
            href: buildRoute(Route.HOST_DASHBOARD, { hostId }),
          },
          {
            id: 'nav-tab-screens',
            label: 'Screens',
            href: buildRoute(Route.SCREEN_LIST, { hostId }),
          },
          {
            id: 'nav-tab-layouts',
            label: 'Layouts',
            href: buildRoute(Route.LAYOUT_LIST, { hostId }),
          },
          {
            id: 'nav-tab-theme',
            label: 'Theme',
            href: buildRoute(Route.HOST_THEME, { hostId }),
          },
          {
            id: 'nav-tab-media',
            label: 'Media',
            href: buildRoute(Route.HOST_MEDIA, { hostId }),
          },
          {
            id: 'nav-tab-inbox',
            label: 'Inbox',
            href: buildRoute(Route.HOST_INBOX, { hostId }),
          },
          {
            id: 'nav-tab-setup',
            label: 'Setup',
            href: buildRoute(Route.HOST_SETUP, { hostId }),
          },
        ]}
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
          icon: { path: ICON_VARIANT_APP_SETTINGS.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
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
                    sx={{
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
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
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
        </Container>
      </DashboardLayout>
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
