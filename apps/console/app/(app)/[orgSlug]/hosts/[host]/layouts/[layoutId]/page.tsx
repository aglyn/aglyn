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
import { mdiPageLayoutBody } from '@aglyn/shared-data-mdi'
import { CardDisplay, Container, useLoading } from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Button,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { collection, doc, limit, query, setDoc, updateDoc } from 'firebase/firestore'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import HostDisplayNameComponent from '../../../../../../../components/host-display-name.component'
import { useHostId, useHostSubdomain } from '../../../../../../../components/host-id-provider'
import DashboardLayout from '../../../../../../../components/layouts/dashboard.layout'
import hostNavTabItems from '../../../../../../../constants/host-nav-tabs'
import { buildRoute, Route } from '../../../../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../../../../constants/shared'
import { useOrgSlug } from '../../../../../../../hooks/use-org-scope'
import useFirestoreCollection from '../../../../../../../hooks/use-firestore-collection'
import useFirestoreDoc from '../../../../../../../hooks/use-firestore-doc'

/**
 * Layout detail (AGL-695).
 *
 * Completes the list → detail → besigner shape across screens, components,
 * templates and layouts. The layouts list already had a table and a create
 * button; it was the detail page that was missing, so a row jumped straight
 * into the editor.
 *
 * Unlike templates, layouts genuinely PUBLISH — `versionId` on the layout
 * document is the pointer the tenant renders through — so "current" here
 * means the published version, and the version table marks it.
 */
const LayoutDetails: NextPageWithLayout<Record<string, never>> = () => {
  const params = useParams<{ layoutId: string }>()
  const layoutId = params?.layoutId as string
  const hostId = useHostId()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const firestore = useFirestore()
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()

  const { data: definition } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId, 'layouts', layoutId),
    [firestore, hostId, layoutId],
    { idField: '$id' },
  )
  // No orderBy: the oldest version docs predate `createdAt`, and Firestore
  // drops documents missing the ordered field. Sort client-side, same as
  // BesignerVersionsComponent.
  const { data: versionDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(
          firestore,
          'hosts',
          hostId,
          'layouts',
          layoutId,
          'versions',
        ),
        limit(100),
      ),
    [firestore, hostId, layoutId],
    { idField: '$id' },
  )
  const versions = [...(versionDocs ?? [])].sort(
    (a: any, b: any) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0),
  )
  const publishedVersionId = definition?.versionId as string | undefined

  const [name, setName] = useState<string | null>(null)
  const [description, setDescription] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)

  const handleSave = useCallback(async () => {
    const dequeue = queueLoading()
    try {
      await updateDoc(doc(firestore, 'hosts', hostId, 'layouts', layoutId), {
        ...(name != null ? { displayName: name.trim() } : {}),
        ...(description != null ? { description: description.trim() } : {}),
        updatedAt: Timestamp.now(),
      })
      setName(null)
      setDescription(null)
      enqueueSnackbar('Layout saved', { variant: 'success', persist: false })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      dequeue()
    }
  }, [firestore, hostId, layoutId, name, description, queueLoading, enqueueSnackbar])

  /**
   * Opens a version in the besigner, minting the first one when the component
   * has none. Components created before versioning (AGL-679) carry no
   * `versionId`, and a component created from the listing (AGL-693) is written
   * empty on purpose — this is the one place that decides what an initial
   * version looks like, so the two paths cannot drift.
   */
  const handleOpen = useCallback(
    (targetVersionId?: string) => async () => {
      if (opening) return
      setOpening(true)
      try {
        let versionId = targetVersionId ?? publishedVersionId ?? versions[0]?.$id
        if (!versionId) {
          versionId = Aglyn.createResourceUid()
          const timestamp = Timestamp.now()
          await setDoc(
            doc(
              firestore,
              'hosts',
              hostId,
              'layouts',
              layoutId,
              'versions',
              versionId,
            ),
            {
              layoutId,
              hostId,
              displayName: 'Initial version',
              nodes: definition?.nodes ?? {},
              ...(definition?.rootId ? { rootId: definition.rootId } : {}),
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          )
          await updateDoc(
            doc(firestore, 'hosts', hostId, 'layouts', layoutId),
            { versionId, updatedAt: timestamp },
          )
        }
        router.push(
          buildRoute(Route.LAYOUT_BESIGNER, {
            orgSlug,
            host,
            layoutId,
            versionId,
          }),
        )
      } catch (error) {
        console.error(error)
        enqueueSnackbar('Could not open the besigner', {
          variant: 'error',
          allowDuplicate: true,
        })
        setOpening(false)
      }
    },
    [
      opening,
      publishedVersionId,
      versions,
      firestore,
      hostId,
      layoutId,
      definition,
      router,
      orgSlug,
      host,
      enqueueSnackbar,
    ],
  )

  const listUrl = buildRoute(Route.LAYOUT_LIST, { orgSlug, host })
  const dirty = name != null || description != null

  return (
    <>
      <NextPageTitle screen={definition?.displayName ?? 'Layout'} />
      <DashboardLayout
        navTabItems={hostNavTabItems(orgSlug, host)}
        breadcrumbItems={[
          {
            children: <HostDisplayNameComponent hostId={hostId} />,
            href: buildRoute(Route.HOST_DASHBOARD, { orgSlug, host }),
          },
          { children: 'Layouts', href: listUrl },
          {
            children: definition?.displayName ?? layoutId,
            href: buildRoute(Route.LAYOUT_DETAILS, {
              orgSlug,
              host,
              layoutId,
            }),
          },
        ]}
        help="screens"
        header={{
          children: definition?.displayName ?? 'Layout',
          icon: { path: mdiPageLayoutBody.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <CardDisplay header={'Details'} contentGutterX contentGutterY>
            <Stack spacing={2}>
              <TextField
                label="Display name"
                size="small"
                value={name ?? definition?.displayName ?? ''}
                onChange={(event) => setName(event.target.value)}
                fullWidth
              />
              <TextField
                label="Description"
                size="small"
                value={description ?? definition?.description ?? ''}
                onChange={(event) => setDescription(event.target.value)}
                fullWidth
                multiline
                minRows={2}
                helperText="Shown in the components list and the element drawer"
              />
              <Typography variant="caption" color="text.secondary">
                {`ID ${layoutId} — persisted in screen documents, so it never changes`}
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button
                  variant="contained"
                  color="secondary"
                  size="small"
                  disabled={!dirty}
                  onClick={handleSave}
                >
                  {'Save'}
                </Button>
                <Button
                  size="small"
                  disabled={opening}
                  onClick={handleOpen()}
                >
                  {opening ? 'Opening…' : 'Open in besigner'}
                </Button>
                <Button size="small" onClick={() => router.push(listUrl)}>
                  {'Back to layouts'}
                </Button>
              </Stack>
            </Stack>
          </CardDisplay>

          <CardDisplay header={'Versions'} contentGutterX contentGutterY>
            {versions.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {'No versions yet — opening the besigner creates the first one.'}
              </Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{'Version'}</TableCell>
                    <TableCell>{'Created'}</TableCell>
                    <TableCell>{'Updated'}</TableCell>
                    <TableCell align="right">{'Actions'}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {versions.map((version: any) => (
                    <TableRow key={version.$id} hover>
                      <TableCell>
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'center' }}
                        >
                          <Typography variant="body2">
                            {version.displayName ?? version.$id}
                          </Typography>
                          {version.$id === publishedVersionId ? (
                            <Chip label="Current" color="success" size="small" />
                          ) : null}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        {version.createdAt?.toDate?.().toLocaleString() ?? '--'}
                      </TableCell>
                      <TableCell>
                        {version.updatedAt?.toDate?.().toLocaleString() ?? '--'}
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          disabled={opening}
                          onClick={handleOpen(version.$id)}
                        >
                          {'Open'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardDisplay>
        </Container>
      </DashboardLayout>
    </>
  )
}
LayoutDetails.displayName = 'Page:LayoutDetails'

export default LayoutDetails
