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

import { mdiBookmarkOutline } from '@aglyn/shared-data-mdi'
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
  Tooltip,
  Typography,
} from '@mui/material'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { collection, doc, limit, query, updateDoc } from 'firebase/firestore'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import HostDisplayNameComponent from '../../../../../../../components/host-display-name.component'
import { useHostId, useHostSubdomain } from '../../../../../../../components/host-id-provider'
import DashboardLayout from '../../../../../../../components/layouts/dashboard.layout'
import hostNavTabItems from '../../../../../../../constants/host-nav-tabs'
import { buildRoute, Route } from '../../../../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../../../../constants/shared'
import { useOrgSlug } from '../../../../../../../hooks/use-org-scope'
import useFirestoreCollection from '../../../../../../../hooks/use-firestore-collection'
import useFirestoreDoc from '../../../../../../../hooks/use-firestore-doc'

/** Human label + colour for the frozen `source.type` (AGL-666/687). */
function sourceLabel(source: { type?: string; version?: string } | undefined) {
  if (source?.type === 'marketplace') {
    return {
      label: source.version ? `Marketplace · v${source.version}` : 'Marketplace',
      color: 'secondary' as const,
      title: 'Installed from the marketplace',
    }
  }
  if (source?.type === 'starter') {
    return {
      label: 'Starter',
      color: 'default' as const,
      title: 'A first-party starter, copied in when you used or edited it',
    }
  }
  return {
    label: 'Saved here',
    color: 'default' as const,
    title: 'Saved from this site',
  }
}

/**
 * Template detail (AGL-694), the counterpart to the component detail page.
 *
 * Two things make this different from a screen's detail page:
 *
 * - Templates version but never PUBLISH, so there is no `versionId` pointer
 *   and `TEMPLATE_BESIGNER` takes none. "Current" is simply the template
 *   document itself, which is why there is no publish action here (AGL-688).
 * - `source` is server-managed and frozen by the Firestore rules, so this
 *   page only ever READS provenance. A client that could write it could
 *   forge a marketplace origin for its own work.
 *
 * A multi-page starter materializes one document per screen (AGL-687). This
 * page shows its sibling pages so a starter is still comprehensible as the
 * bundle it was authored as, without pretending the pages are one document.
 */
const TemplateDetails: NextPageWithLayout<Record<string, never>> = () => {
  const params = useParams<{ templateId: string }>()
  const templateId = params?.templateId as string
  const hostId = useHostId()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const firestore = useFirestore()
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()

  const { data: template } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId, 'templates', templateId),
    [firestore, hostId, templateId],
    { idField: '$id' },
  )
  const { data: templateDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'templates'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )

  const starterId = template?.source?.starterId as string | undefined
  // Sibling pages of the same starter bundle, in authored order.
  const siblings = useMemo(() => {
    if (!starterId) return []
    return (templateDocs ?? [])
      .filter(
        (entry: any) =>
          !entry.deletedAt && entry.source?.starterId === starterId,
      )
      .sort(
        (a: any, b: any) =>
          Number(a.source?.starterOrder ?? 0) -
          Number(b.source?.starterOrder ?? 0),
      )
  }, [templateDocs, starterId])

  const [name, setName] = useState<string | null>(null)
  const [description, setDescription] = useState<string | null>(null)

  const handleSave = useCallback(async () => {
    const dequeue = queueLoading()
    try {
      await updateDoc(doc(firestore, 'hosts', hostId, 'templates', templateId), {
        ...(name != null ? { displayName: name.trim() } : {}),
        ...(description != null ? { description: description.trim() } : {}),
        updatedAt: Timestamp.now(),
      })
      setName(null)
      setDescription(null)
      enqueueSnackbar('Template saved', { variant: 'success', persist: false })
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
    templateId,
    name,
    description,
    queueLoading,
    enqueueSnackbar,
  ])

  const listUrl = buildRoute(Route.HOST_TEMPLATES, { orgSlug, host })
  const besignerUrl = buildRoute(Route.TEMPLATE_BESIGNER, {
    orgSlug,
    host,
    templateId,
  })
  const chip = sourceLabel(template?.source)
  const dirty = name != null || description != null

  return (
    <>
      <NextPageTitle screen={template?.displayName ?? 'Template'} />
      <DashboardLayout
        navTabItems={hostNavTabItems(orgSlug, host)}
        breadcrumbItems={[
          {
            children: <HostDisplayNameComponent hostId={hostId} />,
            href: buildRoute(Route.HOST_DASHBOARD, { orgSlug, host }),
          },
          { children: 'Templates', href: listUrl },
          {
            children: template?.displayName ?? templateId,
            href: buildRoute(Route.TEMPLATE_DETAILS, {
              orgSlug,
              host,
              templateId,
            }),
          },
        ]}
        help="templatesLibrary"
        header={{
          children: template?.displayName ?? 'Template',
          icon: { path: mdiBookmarkOutline.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <CardDisplay header={'Details'} contentGutterX contentGutterY>
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Tooltip title={chip.title}>
                  <Chip size="small" label={chip.label} color={chip.color} />
                </Tooltip>
                <Chip
                  size="small"
                  variant="outlined"
                  label={template?.kind ?? 'page'}
                />
              </Stack>
              <TextField
                label="Display name"
                size="small"
                value={name ?? template?.displayName ?? ''}
                onChange={(event) => setName(event.target.value)}
                fullWidth
              />
              <TextField
                label="Description"
                size="small"
                value={description ?? template?.description ?? ''}
                onChange={(event) => setDescription(event.target.value)}
                fullWidth
                multiline
                minRows={2}
                helperText="Carried onto the screen this template creates"
              />
              <Typography variant="caption" color="text.secondary">
                {`ID ${templateId} — provenance is server-managed and cannot be edited here`}
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
                <Button size="small" onClick={() => router.push(besignerUrl)}>
                  {'Open in besigner'}
                </Button>
                <Button size="small" onClick={() => router.push(listUrl)}>
                  {'Back to templates'}
                </Button>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {'Templates have no publish step — the besigner edits this ' +
                  'template directly, and screens made from it are unaffected.'}
              </Typography>
            </Stack>
          </CardDisplay>

          {siblings.length > 1 ? (
            <CardDisplay
              header={`Starter bundle · ${template?.source?.starterName ?? starterId}`}
              contentGutterX
              contentGutterY
            >
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 1.5 }}
              >
                {'This starter was authored as a set of pages. Each one is a ' +
                  'separate template you can edit, use or delete on its own.'}
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{'Page'}</TableCell>
                    <TableCell>{'Slug'}</TableCell>
                    <TableCell align="right">{'Actions'}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {siblings.map((entry: any) => (
                    <TableRow key={entry.$id} hover selected={entry.$id === templateId}>
                      <TableCell>{entry.displayName ?? entry.$id}</TableCell>
                      <TableCell>
                        <Typography variant="caption" color="text.secondary">
                          {entry.slug ?? '--'}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          disabled={entry.$id === templateId}
                          onClick={() =>
                            router.push(
                              buildRoute(Route.TEMPLATE_DETAILS, {
                                orgSlug,
                                host,
                                templateId: entry.$id,
                              }),
                            )
                          }
                        >
                          {entry.$id === templateId ? 'Viewing' : 'Open'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardDisplay>
          ) : null}
        </Container>
      </DashboardLayout>
    </>
  )
}
TemplateDetails.displayName = 'Page:TemplateDetails'

export default TemplateDetails
