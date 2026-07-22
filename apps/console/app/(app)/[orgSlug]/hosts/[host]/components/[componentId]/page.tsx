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
  ICON_VARIANT_APP_SETTINGS,
  ICON_VARIANT_BESIGNER,
} from '@aglyn/shared-data-enums'
import {
  CardDisplay,
  Container,
  GridItems,
  MdiIcon,
  useLoading,
} from '@aglyn/shared-ui-jsx'
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
import ArtifactNotFound from '../../../../../../../components/artifact-not-found.component'
import HostDisplayNameComponent from '../../../../../../../components/host-display-name.component'
import { useHostId, useHostSubdomain } from '../../../../../../../components/host-id-provider'
import DashboardLayout from '../../../../../../../components/layouts/dashboard.layout'
import hostNavTabItems from '../../../../../../../constants/host-nav-tabs'
import { buildRoute, Route } from '../../../../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../../../../constants/shared'
import { useOrgSlug } from '../../../../../../../hooks/use-org-scope'
import useFirestoreCollection from '../../../../../../../hooks/use-firestore-collection'
import useFirestoreDoc from '../../../../../../../hooks/use-firestore-doc'
import UsedByCard from '../../../../../../../components/used-by-card.component'

/**
 * Component detail (AGL-693).
 *
 * Components used to go straight from a row in the listing into the besigner,
 * which left nowhere to see what a component IS — its description, when it
 * changed, what versions exist. Screens have had this shape (`SCREEN_DETAILS`)
 * all along; this brings components alongside.
 */
const ComponentDetails: NextPageWithLayout<Record<string, never>> = () => {
  const params = useParams<{ componentId: string }>()
  const componentId = params?.componentId as string
  const hostId = useHostId()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const firestore = useFirestore()
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()

  const { data: definition, status } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId, 'components', componentId),
    [firestore, hostId, componentId],
    { idField: '$id' },
  )
  // Three states, not two (AGL-706): a document that is still loading and one
  // that does not exist both arrive as `undefined`, and rendering an empty
  // editable form for the second made a mistyped id look like data loss.
  const notFound = status === 'success' && !definition
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
          'components',
          componentId,
          'versions',
        ),
        limit(100),
      ),
    [firestore, hostId, componentId],
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
      await updateDoc(doc(firestore, 'hosts', hostId, 'components', componentId), {
        ...(name != null ? { displayName: name.trim() } : {}),
        ...(description != null ? { description: description.trim() } : {}),
        updatedAt: Timestamp.now(),
      })
      setName(null)
      setDescription(null)
      enqueueSnackbar('Component saved', { variant: 'success', persist: false })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      dequeue()
    }
  }, [firestore, hostId, componentId, name, description, queueLoading, enqueueSnackbar])

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
              'components',
              componentId,
              'versions',
              versionId,
            ),
            {
              componentId,
              hostId,
              displayName: 'Initial version',
              // Falls back to a root-only canvas, never `{}` — an empty map
              // renders as "Invalid node" (AGL-693).
              nodes:
                definition?.nodes ?? {
                  [Aglyn.CANVAS_ROOT_ELEMENT_ID]: {
                    $id: Aglyn.CANVAS_ROOT_ELEMENT_ID,
                    componentId: 'div',
                    nodes: [],
                  },
                },
              ...(definition?.rootId ? { rootId: definition.rootId } : {}),
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          )
          await updateDoc(
            doc(firestore, 'hosts', hostId, 'components', componentId),
            { versionId, updatedAt: timestamp },
          )
        }
        router.push(
          buildRoute(Route.COMPONENT_BESIGNER, {
            orgSlug,
            host,
            componentId,
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
      componentId,
      definition,
      router,
      orgSlug,
      host,
      enqueueSnackbar,
    ],
  )

  const listUrl = buildRoute(Route.HOST_COMPONENTS, { orgSlug, host })
  const dirty = name != null || description != null

  return (
    <>
      <NextPageTitle screen={definition?.displayName ?? 'Component'} />
      <DashboardLayout
        navTabItems={hostNavTabItems(orgSlug, host)}
        // Keep the parent tab lit on a detail page, the way the
        // admin detail pages do — without this the nav loses its
        // selected state as soon as you open a row.
        activeTab={buildRoute(Route.HOST_COMPONENTS, { orgSlug, host })}
        breadcrumbItems={[
          {
            children: <HostDisplayNameComponent hostId={hostId} />,
            href: buildRoute(Route.HOST_DASHBOARD, { orgSlug, host }),
          },
          { children: 'Components', href: listUrl },
          {
            children: definition?.displayName ?? componentId,
            href: buildRoute(Route.COMPONENT_DETAILS, {
              orgSlug,
              host,
              componentId,
            }),
          },
        ]}
        help="components"
        header={{
          children: definition?.displayName ?? 'Component',
          icon: { path: ICON_VARIANT_APP_SETTINGS.path },
        }}
        // The besigner is what this page exists to reach, so it belongs in
        // the hero like the screen detail page's, not as a text button at
        // the bottom of a card (AGL-702).
        // Withheld when there is no component: Open Besigner would mint a
        // version document under an id that has none (AGL-706).
        headerRight={
          notFound ? null : (
            <Button
              size="small"
              variant="contained"
              disabled={opening}
              onClick={handleOpen()}
              startIcon={
                <MdiIcon color="inherit" path={ICON_VARIANT_BESIGNER.path} />
              }
            >
              {opening ? 'Opening…' : 'Open Besigner'}
            </Button>
          )
        }
      >
        {notFound ? (
          <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
            <ArtifactNotFound
              noun="component"
              listUrl={listUrl}
              listLabel="components"
              id={componentId}
            />
          </Container>
        ) : (
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <GridItems
            spacing={3}
            items={[
              {
                size: { xs: 12, lg: 5 },
                children: (
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
                {`ID ${componentId} — persisted in screen documents, so it never changes`}
              </Typography>
              {/* Save stays with the fields it saves. Open-besigner moved to
                  the hero, and "Back to components" is dropped — the
                  breadcrumb already goes there, and the screen detail page
                  carries no back button either (AGL-702). */}
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
              </Stack>
            </Stack>
          </CardDisplay>
                ),
              },
              {
                size: { xs: 12, lg: 7 },
                children: (
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
                ),
              },
              {
                // Sits under Details, beside Versions: what USES this
                // component is a property of the component, not of any one
                // version (AGL-703).
                size: { xs: 12, lg: 5 },
                children: (
                  <UsedByCard
                    hostId={hostId}
                    kind="component"
                    id={componentId}
                    noun="component"
                  />
                ),
              },
            ]}
          />
        </Container>
        )}
      </DashboardLayout>
    </>
  )
}
ComponentDetails.displayName = 'Page:ComponentDetails'

export default ComponentDetails
