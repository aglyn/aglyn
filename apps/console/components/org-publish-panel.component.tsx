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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import {
  Alert,
  Box,
  Button,
  Link as MuiLink,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { collection, doc, limit, query } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { buildRoute, Route } from '../constants/route-links'
import useFirestoreCollection from '../hooks/use-firestore-collection'
import useFirestoreDoc from '../hooks/use-firestore-doc'
import PublishArtifactDialog, {
  type PublishArtifactTarget,
} from './templates/publish-artifact-dialog.component'

type PublishKind = 'component' | 'layout' | 'site'

const artifactName = (artifact: any): string | undefined =>
  artifact?.displayName ?? artifact?.name ?? artifact?.title ?? undefined

/**
 * Org-level publish (AGL-776): pick a source site, then a component, a layout,
 * or the whole site (as a template), and publish it to the marketplace under
 * the org's publisher identity. The host-based publish routes already derive
 * the publishing org from the source `hostId`, so this only assembles their
 * request — the shared PublishArtifactDialog owns the name/price form and the
 * POST. Plugins publish from their own bundle upload, not here.
 *
 * The per-site publish buttons (Components/Layouts/Setup pages) stay as
 * in-context shortcuts; this is the one place that spans every site.
 */
export function OrgPublishPanel({
  orgSlug,
  orgId,
  hosts,
}: {
  orgSlug: string
  orgId: string
  hosts: ReadonlyArray<{ id: string; label: string }>
}) {
  const firestore = useFirestore()
  const { data: profile } = useFirestoreDoc<any>(
    () => doc(firestore, 'publisherProfiles', orgId || '-none-'),
    [firestore, orgId],
    { idField: '$id' },
  )
  const [sourceHostId, setSourceHostId] = useState('')
  const hostId = sourceHostId || hosts[0]?.id || ''
  const [kind, setKind] = useState<PublishKind>('component')
  const [artifactId, setArtifactId] = useState('')
  const [target, setTarget] = useState<PublishArtifactTarget | null>(null)

  const { data: componentDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts', hostId || '-none-', 'components'),
        limit(100),
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: layoutDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts', hostId || '-none-', 'layouts'),
        limit(100),
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const components = useMemo(
    () => (componentDocs ?? []).filter((entry: any) => !entry.deletedAt),
    [componentDocs],
  )
  const layouts = useMemo(
    () => (layoutDocs ?? []).filter((entry: any) => !entry.deletedAt),
    [layoutDocs],
  )

  // A new site or artifact-type resets the specific pick, so we never publish
  // a stale id from the previous selection.
  useEffect(() => {
    setArtifactId('')
  }, [hostId, kind])

  const hostLabel = hosts.find((host) => host.id === hostId)?.label

  const openPublish = () => {
    if (kind === 'site') {
      return setTarget({
        endpoint: 'community/publish-template',
        payload: { hostId },
        displayName: hostLabel,
        noun: 'site template',
      })
    }
    if (kind === 'component') {
      const chosen = components.find((entry: any) => entry.$id === artifactId)
      return setTarget({
        endpoint: 'community/publish',
        payload: { hostId, componentId: artifactId },
        displayName: artifactName(chosen),
        noun: 'component',
      })
    }
    const chosen = layouts.find((entry: any) => entry.$id === artifactId)
    setTarget({
      endpoint: 'community/publish-layout',
      payload: { hostId, layoutId: artifactId },
      displayName: artifactName(chosen),
      noun: 'layout',
    })
  }

  const canPublish = Boolean(hostId && (kind === 'site' || artifactId))

  // A publisher profile (with a handle) is required server-side; guide the
  // user there rather than letting the publish 412.
  if (profile !== undefined && !profile?.handle) {
    return (
      <CardDisplay header={'Publish to the marketplace'} contentGutterX contentGutterY>
        <Alert severity="info">
          {'Set up your organization’s publisher profile before publishing. '}
          <MuiLink
            href={buildRoute(Route.MANAGE_COMMUNITY_PROFILE, { orgSlug })}
            color="secondary"
            underline="hover"
          >
            {'Go to your Community profile'}
          </MuiLink>
        </Alert>
      </CardDisplay>
    )
  }

  return (
    <CardDisplay header={'Publish to the marketplace'} contentGutterX contentGutterY>
      <Stack spacing={2} sx={{ maxWidth: 480 }}>
        <Typography variant="body2" color="text.secondary">
          {'Publish a component, a layout, or an entire site from your ' +
            'organization so other organizations can install it. Your live ' +
            'site is unaffected.'}
        </Typography>
        {hosts.length > 1 ? (
          <TextField
            select
            size="small"
            label="From site"
            value={hostId}
            onChange={(event) => setSourceHostId(event.target.value)}
          >
            {hosts.map((host) => (
              <MenuItem key={host.id} value={host.id}>
                {host.label}
              </MenuItem>
            ))}
          </TextField>
        ) : null}
        <TextField
          select
          size="small"
          label="What to publish"
          value={kind}
          onChange={(event) => setKind(event.target.value as PublishKind)}
        >
          <MenuItem value="component">{'A component'}</MenuItem>
          <MenuItem value="layout">{'A layout'}</MenuItem>
          <MenuItem value="site">{'This entire site (as a template)'}</MenuItem>
        </TextField>
        {kind === 'component' ? (
          components.length ? (
            <TextField
              select
              size="small"
              label="Component"
              value={artifactId}
              onChange={(event) => setArtifactId(event.target.value)}
            >
              {components.map((entry: any) => (
                <MenuItem key={entry.$id} value={entry.$id}>
                  {artifactName(entry) ?? entry.$id}
                </MenuItem>
              ))}
            </TextField>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {'This site has no reusable components to publish yet.'}
            </Typography>
          )
        ) : kind === 'layout' ? (
          layouts.length ? (
            <TextField
              select
              size="small"
              label="Layout"
              value={artifactId}
              onChange={(event) => setArtifactId(event.target.value)}
            >
              {layouts.map((entry: any) => (
                <MenuItem key={entry.$id} value={entry.$id}>
                  {artifactName(entry) ?? entry.$id}
                </MenuItem>
              ))}
            </TextField>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {'This site has no layouts to publish yet.'}
            </Typography>
          )
        ) : (
          <Typography variant="body2" color="text.secondary">
            {'Publishes this site’s current published screens and theme as an ' +
              'installable starting point.'}
          </Typography>
        )}
        <Box>
          <Button
            variant="contained"
            color="secondary"
            disabled={!canPublish}
            onClick={openPublish}
          >
            {'Publish…'}
          </Button>
        </Box>
      </Stack>
      <PublishArtifactDialog target={target} onClose={() => setTarget(null)} />
    </CardDisplay>
  )
}
OrgPublishPanel.displayName = 'OrgPublishPanel'

export default OrgPublishPanel
