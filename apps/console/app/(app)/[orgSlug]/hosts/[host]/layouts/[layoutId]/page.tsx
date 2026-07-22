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
import { ICON_VARIANT_BESIGNER } from '@aglyn/shared-data-enums'
import { mdiPageLayoutBody } from '@aglyn/shared-data-mdi'
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
import { useCallback, useMemo, useState } from 'react'
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

  const { data: definition, status } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId, 'layouts', layoutId),
    [firestore, hostId, layoutId],
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

  // Every layout on the host, for the parent picker below (AGL-703).
  const { data: layoutDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'layouts'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )

  const [name, setName] = useState<string | null>(null)
  const [description, setDescription] = useState<string | null>(null)
  const [parentLayoutId, setParentLayoutId] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)

  /**
   * Layouts this one may render inside (AGL-703).
   *
   * Excludes itself and anything already below it — picking either would
   * close a loop. `canNestLayout` does the ancestry walk; offering an
   * impossible option and rejecting it on save would be a worse way to
   * teach the same rule.
   */
  const parentOptions = useMemo(() => {
    const byId = new Map<string, any>()
    for (const entry of layoutDocs ?? []) {
      if (!entry.deletedAt) byId.set(entry.$id, entry)
    }
    const parentOf = (id: string) => byId.get(id)?.layoutId
    return Array.from(byId.values())
      .filter((entry: any) =>
        Aglyn.canNestLayout(layoutId, entry.$id, parentOf),
      )
      .sort((a: any, b: any) =>
        String(a.displayName ?? '').localeCompare(String(b.displayName ?? '')),
      )
  }, [layoutDocs, layoutId])

  const handleSave = useCallback(async () => {
    const dequeue = queueLoading()
    try {
      await updateDoc(doc(firestore, 'hosts', hostId, 'layouts', layoutId), {
        ...(name != null ? { displayName: name.trim() } : {}),
        ...(description != null ? { description: description.trim() } : {}),
        // '' clears it: deleteField() would be the tidier write, but an
        // absent field and an empty one both read as "no parent" here and
        // in the runtime walk.
        ...(parentLayoutId != null ? { layoutId: parentLayoutId } : {}),
        updatedAt: Timestamp.now(),
      })
      setName(null)
      setDescription(null)
      setParentLayoutId(null)
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
  }, [
    firestore,
    hostId,
    layoutId,
    name,
    description,
    parentLayoutId,
    queueLoading,
    enqueueSnackbar,
  ])

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
  const dirty = name != null || description != null || parentLayoutId != null

  return (
    <>
      <NextPageTitle screen={definition?.displayName ?? 'Layout'} />
      <DashboardLayout
        navTabItems={hostNavTabItems(orgSlug, host)}
        // Keep the parent tab lit on a detail page, the way the
        // admin detail pages do — without this the nav loses its
        // selected state as soon as you open a row.
        activeTab={buildRoute(Route.LAYOUT_LIST, { orgSlug, host })}
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
        // The besigner is what this page exists to reach, so it belongs in
        // the hero like the screen detail page's, not as a text button at
        // the bottom of a card (AGL-702).
        // Withheld when there is no layout: Open Besigner would mint a
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
              noun="layout"
              listUrl={listUrl}
              listLabel="layouts"
              id={layoutId}
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
              {/* Nested layouts (AGL-703): shared chrome can sit OUTSIDE a
                  more specific frame, the same relationship a screen has
                  with its layout, one level up. */}
              <TextField
                select
                label="Renders inside"
                size="small"
                value={parentLayoutId ?? definition?.layoutId ?? ''}
                onChange={(event) => setParentLayoutId(event.target.value)}
                fullWidth
                slotProps={{ select: { native: true } }}
                helperText={
                  parentOptions.length
                    ? 'Wrap this layout in another one. A layout cannot sit ' +
                      'inside itself, or inside a layout already nested in it.'
                    : 'No other layout can wrap this one yet — create a ' +
                      'second layout first.'
                }
              >
                <option value="">{'— None —'}</option>
                {parentOptions.map((entry: any) => (
                  <option key={entry.$id} value={entry.$id}>
                    {entry.displayName ?? entry.$id}
                  </option>
                ))}
              </TextField>
              <Typography variant="caption" color="text.secondary">
                {`ID ${layoutId} — persisted in screen documents, so it never changes`}
              </Typography>
              {/* Save stays with the fields it saves. Open-besigner moved to
                  the hero, and "Back to layouts" is dropped — the breadcrumb
                  already goes there, and the screen detail page carries no
                  back button either (AGL-702). */}
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
                // Which screens render inside this layout (AGL-703) — the
                // one question worth answering before deleting it.
                size: { xs: 12, lg: 5 },
                children: (
                  <UsedByCard
                    hostId={hostId}
                    kind="layout"
                    id={layoutId}
                    noun="layout"
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
LayoutDetails.displayName = 'Page:LayoutDetails'

export default LayoutDetails
