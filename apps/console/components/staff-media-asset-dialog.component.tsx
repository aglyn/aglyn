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

import { AppLink } from '@aglyn/shared-ui-jsx'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Typography,
} from '@mui/material'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { buildRoute, Route } from '../constants/route-links'
import { StaffMediaTakedown } from './staff-media-takedown.component'
import {
  type StaffMediaAsset,
  type StaffMediaRow,
  staffMediaSizeLabel,
  staffMediaTypeLabel,
} from '../utils/staff-media-library'

export interface StaffMediaAssetDialogProps {
  /** The library: `orgId=…` or `hostId=…`, as the card asked for it. */
  scopeQuery: string
  /** The row clicked — shown at once, while the full asset loads. */
  row: StaffMediaRow
  onClose: () => void
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0, sm: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 140, flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography variant="body2" component="div" sx={{ wordBreak: 'break-word', minWidth: 0 }}>
        {children}
      </Typography>
    </Stack>
  )
}

function when(ms: number | null): string {
  return ms ? new Date(ms).toLocaleString() : '—'
}

function Preview({ asset }: { asset: StaffMediaAsset }) {
  if (!asset.previewSrc) {
    return (
      <Typography variant="body2" color="text.secondary">
        {'No preview for this type.'}
      </Typography>
    )
  }
  const sx = { display: 'block', maxWidth: '100%', maxHeight: 360, mx: 'auto', borderRadius: 1 }
  if (asset.contentType.startsWith('image/')) {
    return <Box component="img" src={asset.previewSrc} alt={asset.alt ?? asset.name} sx={sx} />
  }
  if (asset.contentType.startsWith('video/')) {
    return <Box component="video" src={asset.previewSrc} controls preload="metadata" sx={sx} />
  }
  if (asset.contentType.startsWith('audio/')) {
    return <Box component="audio" src={asset.previewSrc} controls preload="none" sx={{ width: '100%' }} />
  }
  return (
    <AppLink href={asset.previewSrc} target="_blank" rel="noopener noreferrer">
      {'Open the file in a new tab'}
    </AppLink>
  )
}

/**
 * One asset of a media library, opened from the staff media card: the
 * preview, what the file is, where its bytes sit, who uploaded it (and, for
 * audio, who confirmed its rights), who may see it and where it is used —
 * and the one write it offers, the copyright takedown (AGL-3716,
 * `StaffMediaTakedown`), which is the platform's asset quarantine.
 *
 * Mounted only while open: it reads `/api/admin/media-library/asset` on
 * mount, and that read is what records the look in the staff audit log. A
 * private asset's preview is a signed URL the route minted for staff; it
 * expires, so the dialog says when rather than holding a link that decays.
 */
export function StaffMediaAssetDialog({ scopeQuery, row, onClose }: StaffMediaAssetDialogProps) {
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const [asset, setAsset] = useState<StaffMediaAsset | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const response = await authorizedFetch(
          userRef.current,
          `/api/admin/media-library/asset?${scopeQuery}&mediaId=${encodeURIComponent(row.$id)}`,
        )
        const payload = await response.json().catch(() => ({}))
        if (!live) return
        if (!response.ok) throw new Error(payload?.error ?? 'The asset could not be read')
        setAsset(payload as StaffMediaAsset)
      } catch (caught) {
        if (live) setError((caught as Error)?.message ?? 'The asset could not be read')
      }
    })()
    return () => {
      live = false
    }
  }, [scopeQuery, row.$id])

  const shown = asset ?? row
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth scroll="paper">
      <DialogTitle sx={{ pb: 1, wordBreak: 'break-word' }}>
        {shown.name}
        <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
          <Chip size="small" label={staffMediaTypeLabel(shown.contentType)} />
          <Chip
            size="small"
            color={shown.private ? 'warning' : 'default'}
            variant={shown.private ? 'filled' : 'outlined'}
            label={shown.private ? 'Private' : 'Public'}
          />
          {shown.deleted ? <Chip size="small" color="error" label="In trash" /> : null}
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {!asset && !error ? (
          <Stack sx={{ alignItems: 'center', py: 4 }}>
            <CircularProgress size={28} />
          </Stack>
        ) : null}
        {asset ? (
          <Stack spacing={2}>
            <Preview asset={asset} />
            {asset.previewExpiresAtMs ? (
              <Typography variant="caption" color="text.secondary">
                {`A private file: this preview is a signed link minted for staff, good until ${new Date(
                  asset.previewExpiresAtMs,
                ).toLocaleTimeString()}. Reopen the file for a new one.`}
              </Typography>
            ) : null}
            <Divider />
            <Stack spacing={1}>
              <Row label="Type">{asset.contentType || '—'}</Row>
              <Row label="Size">{staffMediaSizeLabel(asset.sizeBytes)}</Row>
              {asset.width && asset.height ? (
                <Row label="Dimensions">{`${asset.width} × ${asset.height}`}</Row>
              ) : null}
              <Row label="Created">{when(asset.createdAtMs)}</Row>
              <Row label="Storage path">
                <Box component="code" sx={{ fontSize: '0.8125rem' }}>
                  {asset.storagePath ?? '—'}
                </Box>
              </Row>
              <Row label="Asset id">
                <Box component="code" sx={{ fontSize: '0.8125rem' }}>
                  {asset.$id}
                </Box>
              </Row>
              {asset.folderId ? <Row label="Folder">{asset.folderId}</Row> : null}
              <Row label="Uploaded by">
                {asset.owner ? (
                  <AppLink href={buildRoute(Route.ADMIN_USER_DETAIL, { uid: asset.owner.uid })}>
                    {asset.owner.email ?? asset.owner.displayName ?? asset.owner.uid}
                  </AppLink>
                ) : (
                  'Not recorded'
                )}
              </Row>
              <Row label="Visibility">
                {asset.private ? 'Private — served only through signed links' : 'Public — served by the CDN'}
                {asset.visibleTo.length
                  ? ` · limited to ${asset.visibleTo.join(', ')}`
                  : ' · everyone with access to this library'}
              </Row>
              {asset.contentType.startsWith('audio/') ? (
                <Row label="Rights confirmed">
                  {asset.rightsConfirmation
                    ? `${when(asset.rightsConfirmation.atMs)} by ${asset.rightsConfirmation.uid}`
                    : 'Never — no rights confirmation is recorded for this audio'}
                </Row>
              ) : null}
              {asset.alt ? <Row label="Alt text">{asset.alt}</Row> : null}
              {asset.description ? <Row label="Description">{asset.description}</Row> : null}
            </Stack>
            <Divider />
            <Stack spacing={1}>
              <Typography variant="subtitle2">{'Where it is used'}</Typography>
              {!asset.usage ? (
                <Alert severity="warning">
                  {'The usage scan could not run. That is not the same as "used nowhere".'}
                </Alert>
              ) : asset.usage.references.length ? (
                asset.usage.references.map((reference, index) => (
                  <Typography
                    key={`${reference.hostId}:${reference.kind}:${reference.name}:${index}`}
                    variant="body2"
                    component="div"
                  >
                    {reference.hostId ? (
                      <AppLink href={buildRoute(Route.ADMIN_SITE_DETAIL, { hostId: reference.hostId })}>
                        {reference.hostName}
                      </AppLink>
                    ) : (
                      reference.hostName
                    )}
                    {` · ${reference.kind} · ${reference.name}`}
                    {reference.live === true ? ' · live' : reference.live === false ? ' · draft' : ''}
                  </Typography>
                ))
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {asset.usage.coverage === 'full'
                    ? 'Not used on any page, layout, entry or setting.'
                    : 'No use found, but the scan did not cover everything — treat this as unknown.'}
                </Typography>
              )}
              {asset.usage && asset.usage.references.length && asset.usage.coverage !== 'full' ? (
                <Typography variant="caption" color="text.secondary">
                  {'The scan did not cover everything; there may be more.'}
                </Typography>
              ) : null}
            </Stack>
            <Divider />
            <StaffMediaTakedown scopeQuery={scopeQuery} mediaId={asset.$id} />
            <Typography variant="caption" color="text.secondary">
              {'Opening this file is recorded in the staff audit log.'}
            </Typography>
          </Stack>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export default StaffMediaAssetDialog
