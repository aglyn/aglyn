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
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { getTenantEmail } from '@aglyn/shared-util-email'
import { collection, doc, limit, query } from 'firebase/firestore'
import { useMemo, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../constants/docs-links'
import useFirestoreCollection from '../hooks/use-firestore-collection'
import useFirestoreDoc from '../hooks/use-firestore-doc'
import PublishArtifactDialog, {
  type PublishArtifactTarget,
} from './templates/publish-artifact-dialog.component'

type PublishKind =
  | 'component'
  | 'layout'
  | 'site'
  | 'datasetSchema'
  | 'emailTemplate'

const artifactName = (artifact: any): string | undefined =>
  artifact?.displayName ?? artifact?.name ?? artifact?.title ?? undefined

/**
 * Email templates are keyed by a fixed catalog key, and the stored doc carries
 * only the design — the human name lives in the catalog.
 */
const emailLabel = (templateKey: string): string =>
  getTenantEmail(templateKey)?.name ?? templateKey

/** Per-kind select label, option text, and empty-state copy. */
const PICKERS: Record<
  PublishKind,
  { label: string; empty: string; optionLabel: (entry: any) => string }
> = {
  component: {
    label: 'Component',
    empty: 'This site has no reusable components to publish yet.',
    optionLabel: (entry) => artifactName(entry) ?? entry.$id,
  },
  layout: {
    label: 'Layout',
    empty: 'This site has no layouts to publish yet.',
    optionLabel: (entry) => artifactName(entry) ?? entry.$id,
  },
  datasetSchema: {
    label: 'Dataset',
    empty: 'This organization has no datasets to publish yet.',
    optionLabel: (entry) => artifactName(entry) ?? entry.$id,
  },
  emailTemplate: {
    label: 'Email',
    empty: 'This site has no designed emails to publish yet.',
    // The doc id IS the catalog key; the design carries no name of its own.
    optionLabel: (entry) => emailLabel(entry.$id),
  },
  site: { label: 'Site', empty: '', optionLabel: () => '' },
}

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
  orgId,
  hosts,
}: {
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
  // Datasets are ORG-scoped (AGL-237), so unlike every other source here they
  // don't depend on the selected site.
  const { data: datasetDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'orgs', orgId || '-none-', 'datasets'),
        limit(100),
      ),
    [firestore, orgId],
    { idField: '$id' },
  )
  const { data: emailDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts', hostId || '-none-', 'emailTemplates'),
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
  const datasets = useMemo(
    () => (datasetDocs ?? []).filter((entry: any) => !entry.deletedAt),
    [datasetDocs],
  )
  // Only emails that actually have a saved design are publishable — the doc
  // exists with no `versionId` whenever the besigner was merely opened.
  const emails = useMemo(
    () =>
      (emailDocs ?? []).filter(
        (entry: any) => !entry.deletedAt && entry.versionId,
      ),
    [emailDocs],
  )

  // Validate the pick against the current list rather than resetting it in an
  // effect (a classic render-loop source — the reset runs a `setState` after
  // every host/kind change, adding renders that a transient flurry can push
  // past React's update-depth limit). A stale id from another site or
  // artifact type simply reads as "nothing selected" this render, so we never
  // publish it, and the MUI <Select> value stays in range every render.
  const activeList =
    kind === 'component'
      ? components
      : kind === 'layout'
        ? layouts
        : kind === 'datasetSchema'
          ? datasets
          : kind === 'emailTemplate'
            ? emails
            : []
  // One descriptor per source kind, so adding an artifact type is a row here
  // rather than another arm of a nested ternary in the JSX below.
  const picker = PICKERS[kind]
  const selectedId = activeList.some((entry: any) => entry.$id === artifactId)
    ? artifactId
    : ''

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
      const chosen = components.find((entry: any) => entry.$id === selectedId)
      return setTarget({
        endpoint: 'community/publish',
        payload: { hostId, componentId: selectedId },
        displayName: artifactName(chosen),
        noun: 'component',
      })
    }
    if (kind === 'datasetSchema') {
      const chosen = datasets.find((entry: any) => entry.$id === selectedId)
      // Datasets are org-scoped, so this route takes orgId rather than hostId.
      return setTarget({
        endpoint: 'community/publish-dataset-schema',
        payload: { orgId, datasetId: selectedId },
        displayName: artifactName(chosen),
        noun: 'dataset schema',
      })
    }
    if (kind === 'emailTemplate') {
      return setTarget({
        endpoint: 'community/publish-email-template',
        payload: { hostId, templateKey: selectedId },
        displayName: emailLabel(selectedId),
        noun: 'email template',
      })
    }
    const chosen = layouts.find((entry: any) => entry.$id === selectedId)
    setTarget({
      endpoint: 'community/publish-layout',
      payload: { hostId, layoutId: selectedId },
      displayName: artifactName(chosen),
      noun: 'layout',
    })
  }

  // Dataset schemas publish from the org, so they need no source site — an
  // org with datasets but no sites yet can still publish one.
  const canPublish =
    kind === 'datasetSchema'
      ? Boolean(orgId && selectedId)
      : Boolean(hostId && (kind === 'site' || selectedId))

  // A publisher profile (with a handle) is required server-side; guide the
  // user there rather than letting the publish 412.
  if (profile !== undefined && !profile?.handle) {
    return (
      <CardDisplay header={'Publish to the marketplace'} contentGutterX contentGutterY>
        <Alert severity="info">
          {'Set up your organization’s publisher profile in the Profile tab ' +
            'before publishing.'}
        </Alert>
      </CardDisplay>
    )
  }

  return (
    <CardDisplay
      header={'Publish to the marketplace'}
      help={docsHelp('publisherHandbook', {
        anchor: '#where-to-publish-from',
        excerpt:
          'Publish a component, layout, dataset schema, email template, or ' +
          'whole site so other organizations can install it.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2} sx={{ maxWidth: 480 }}>
        <Typography variant="body2" color="text.secondary">
          {'Publish a component, layout, dataset schema, email template, or ' +
            'an entire site from your organization so other organizations ' +
            'can install it. Your live site is unaffected.'}
        </Typography>
        {hosts.length > 1 && kind !== 'datasetSchema' ? (
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
          <MenuItem value="datasetSchema">{'A dataset schema'}</MenuItem>
          <MenuItem value="emailTemplate">{'An email template'}</MenuItem>
          <MenuItem value="site">{'This entire site (as a template)'}</MenuItem>
        </TextField>
        {kind === 'site' ? (
          <Typography variant="body2" color="text.secondary">
            {'Publishes this site’s current published screens and theme as an ' +
              'installable starting point.'}
          </Typography>
        ) : activeList.length ? (
          <TextField
            select
            size="small"
            label={picker.label}
            value={selectedId}
            onChange={(event) => setArtifactId(event.target.value)}
          >
            {activeList.map((entry: any) => (
              <MenuItem key={entry.$id} value={entry.$id}>
                {picker.optionLabel(entry)}
              </MenuItem>
            ))}
          </TextField>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {picker.empty}
          </Typography>
        )}
        {kind === 'emailTemplate' && activeList.length ? (
          <Typography variant="caption" color="text.secondary">
            {'Installing an email template adds it as a draft version — it ' +
              'never replaces the design a site is already sending.'}
          </Typography>
        ) : null}
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
