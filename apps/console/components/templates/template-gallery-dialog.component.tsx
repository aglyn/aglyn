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

import { useLoading } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Typography,
} from '@mui/material'
import { collection, limit, query, where } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useFirestore,
  useHostResourceApi,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { checkOrgQuota } from '../../constants/entitlements'
import createPageFromTemplate from './create-page-from-template'
import UseTemplateDialog from './use-template-dialog.component'
import useCurrentOrg from '../../hooks/use-current-org'
import useFirestoreCollection from '../../hooks/use-firestore-collection'

export interface TemplateGalleryDialogProps {
  hostId: string
  open: boolean
  onClose: () => void
  /** Slugs already used on the host, for collision suffixing. */
  existingSlugs: string[]
  /** Current screen count, for the plan quota check. */
  screenCount: number
}

/**
 * Template gallery (AGL-78/79, single-sourced by AGL-687).
 *
 * Every card here is now a real document in the host's own template library.
 * The first-party starters used to be rendered straight from code, which
 * made them a second kind of template — no version history, no editor, no
 * placeholders — sitting in the same grid as the editable ones. They are now
 * seeded into `hosts/{hostId}/templates` (see
 * `utils/server/seed-starter-templates.ts`), so a starter card and a saved
 * card differ only in the provenance recorded on the document.
 *
 * Multi-page starters seed one page template per screen and are regrouped
 * here by `source.starterId`, which keeps the one-click "add all five shop
 * pages" behaviour while leaving each page individually editable, versionable
 * and usable from the Templates library.
 */
export function TemplateGalleryDialog(props: TemplateGalleryDialogProps) {
  const { hostId, open, onClose, existingSlugs, screenCount } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const { org } = useCurrentOrg()
  const { data: user } = useUser()
  const createHostResource = useHostResourceApi()

  // Community site templates (AGL-137): published bundles with previews.
  const { data: templateListings } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'communityListings'),
        where('kind', '==', 'template'),
        limit(30),
      ),
    [firestore],
    { idField: '$id' },
  )
  const communityTemplates = (templateListings ?? []).filter(
    (listing: any) => !listing.deletedAt,
  )
  // The host's own library (AGL-672) — saved templates and marketplace
  // installs, the same collection the Templates page renders. Page kind
  // only: a component or layout template has nothing to do with "start
  // from a template" on the screens list.
  const { data: libraryDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'templates'), limit(50)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const libraryPages = (libraryDocs ?? []).filter(
    (entry: any) => !entry.deletedAt && (entry.kind ?? 'page') === 'page',
  )
  // Seeded starters are presented as the bundles they were authored as; the
  // rest of the library stays a flat list of individual templates.
  const savedPages = libraryPages.filter(
    (entry: any) => entry.source?.type !== 'starter',
  )
  const starterGroups = useMemo(() => {
    const groups = new Map<string, { id: string; displayName: string; description?: string; category?: string; screens: any[] }>()
    for (const entry of libraryPages) {
      if (entry.source?.type !== 'starter') continue
      const starterId = String(entry.source.starterId ?? entry.$id)
      const group = groups.get(starterId) ?? {
        id: starterId,
        displayName: entry.source.starterName ?? entry.displayName,
        description: entry.source.starterDescription ?? entry.description,
        category: entry.category,
        screens: [],
      }
      group.screens.push(entry)
      groups.set(starterId, group)
    }
    for (const group of groups.values()) {
      // Authored order, not Firestore's: a starter's pages are written in
      // the order its author intended them to be created.
      group.screens.sort(
        (a: any, b: any) =>
          Number(a.source?.starterOrder ?? 0) - Number(b.source?.starterOrder ?? 0),
      )
    }
    return Array.from(groups.values())
  }, [libraryPages])
  const [useTemplate, setUseTemplate] = useState<Record<string, any> | null>(
    null,
  )
  const [installingId, setInstallingId] = useState<string | null>(null)
  const handleInstallTemplate = useCallback(
    (listing: any) => async () => {
      if (installingId) return
      setInstallingId(listing.$id)
      const dequeue = queueLoading()
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch('/api/community/install-template', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ listingId: listing.$id, hostId }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          return void enqueueSnackbar(
            payload?.error ?? 'Template install failed',
            {
              variant: response.status === 402 ? 'warning' : 'error',
              allowDuplicate: true,
            },
          )
        }
        // Installing adds to the template library and publishes nothing
        // (AGL-669), so the message must not imply pages appeared.
        const added = Number(payload.templates ?? 0)
        enqueueSnackbar(
          `Saved ${added} template${added === 1 ? '' : 's'} from ` +
            `"${listing.displayName}" to your library — open Templates to ` +
            'create pages from them.',
          { variant: 'success', persist: false },
        )
        onClose()
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        setInstallingId(null)
        dequeue()
      }
    },
    [installingId, user, hostId, queueLoading, enqueueSnackbar, onClose],
  )

  // Backfill for hosts that predate AGL-687 — new hosts are seeded at
  // creation. Idempotent and marker-guarded server-side, so a repeat open
  // costs one host-doc read and writes nothing.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      try {
        const idToken = await (user as any)?.getIdToken?.()
        if (cancelled || !idToken) return
        await fetch('/api/hosts/seed-starter-templates', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ hostId }),
        })
      } catch (error) {
        // A gallery showing only the user's own templates is a worse
        // gallery, not a broken one — never block opening on this.
        console.error(error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, hostId, user])

  const handleUse = useCallback(
    (template: { displayName: string; screens: any[] }) => async () => {
      const quota = checkOrgQuota(
        org,
        'screensPerHost',
        screenCount + template.screens.length - 1,
      )
      if (!quota.allowed) {
        return void enqueueSnackbar(
          `This template needs ${template.screens.length} screens — your ` +
            `plan allows ${quota.limit}. See Billing to upgrade.`,
          { variant: 'warning', persist: false },
        )
      }
      const dequeue = queueLoading()
      try {
        const used = new Set(existingSlugs)
        for (const screen of template.screens) {
          // Same helper the library's Use flow calls (AGL-672) — one
          // implementation of create-screen → write-version → publish-route,
          // including the slug de-confliction that must not overwrite a
          // live page.
          await createPageFromTemplate(firestore, createHostResource as any, {
            hostId,
            displayName: screen.displayName,
            nodes: screen.nodes as Record<string, unknown>,
            description: screen.description,
            seo: screen.seo,
            slug: screen.slug,
            usedSlugs: used,
          })
        }
        enqueueSnackbar(
          `Added ${template.screens.length} screen${
            template.screens.length === 1 ? '' : 's'
          } from "${template.displayName}"`,
          { variant: 'success', persist: false },
        )
        onClose()
      } catch (error: any) {
        console.error(error)
        enqueueSnackbar(error?.message ?? 'An error has occurred', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        dequeue()
      }
    },
    [
      org,
      screenCount,
      existingSlugs,
      firestore,
      hostId,
      createHostResource,
      queueLoading,
      enqueueSnackbar,
      onClose,
    ],
  )

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{'Start from a template'}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {'Templates add ready-made, published screens you can restyle in ' +
            'the besigner. Existing screens are never touched.'}
        </Typography>
        {/* Your own library first (AGL-672): saved and installed templates
            are the ones a returning user is looking for, and they open the
            same Use flow as the Templates page rather than a second
            implementation. */}
        {savedPages.length ? (
          <>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {'Your templates'}
            </Typography>
            <Grid container spacing={2} sx={{ mb: 3 }}>
              {savedPages.map((template: any) => (
                <Grid key={template.$id} size={{ xs: 12, sm: 6, md: 4 }}>
                  <Card variant="outlined" sx={{ height: '100%' }}>
                    <CardContent>
                      <Typography variant="h6">
                        {template.displayName}
                      </Typography>
                      <Chip
                        label={
                          template.source?.type === 'marketplace'
                            ? 'Marketplace'
                            : 'Saved here'
                        }
                        size="small"
                        variant="outlined"
                        sx={{ my: 1 }}
                      />
                      {template.description ? (
                        <Typography variant="body2" color="text.secondary">
                          {template.description}
                        </Typography>
                      ) : null}
                    </CardContent>
                    <CardActions>
                      <Button
                        size="small"
                        variant="contained"
                        color="secondary"
                        onClick={() => setUseTemplate(template)}
                      >
                        {'Use'}
                      </Button>
                    </CardActions>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </>
        ) : null}
        {/* Seeded first-party starters (AGL-687), regrouped by the starter
            they came from so a multi-page starter is still one card that
            creates all of its pages — while each of those pages remains an
            ordinary, editable template in the library. */}
        {starterGroups.length ? (
          <>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {'Starter sites'}
            </Typography>
            <Grid container spacing={2}>
              {starterGroups.map((starter) => (
                <Grid key={starter.id} size={{ xs: 12, sm: 6, md: 4 }}>
                  <Card variant="outlined" sx={{ height: '100%' }}>
                    <CardContent>
                      <Typography variant="h6">
                        {starter.displayName}
                      </Typography>
                      {starter.category ? (
                        <Chip
                          label={starter.category}
                          size="small"
                          variant="outlined"
                          sx={{ my: 1 }}
                        />
                      ) : null}
                      <Typography variant="body2" color="text.secondary">
                        {starter.description}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        component="div"
                        sx={{ mt: 1 }}
                      >
                        {`${starter.screens.length} screen${
                          starter.screens.length === 1 ? '' : 's'
                        }`}
                      </Typography>
                    </CardContent>
                    <CardActions>
                      <Button
                        size="small"
                        variant="contained"
                        color="secondary"
                        onClick={handleUse(starter)}
                      >
                        {'Use template'}
                      </Button>
                    </CardActions>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </>
        ) : null}
        {communityTemplates.length ? (
          <>
            <Typography variant="subtitle1" sx={{ mt: 3, mb: 1 }}>
              {'Community templates'}
            </Typography>
            <Grid container spacing={2}>
              {communityTemplates.map((listing: any) => (
                <Grid key={listing.$id} size={{ xs: 12, sm: 6, md: 4 }}>
                  <Card variant="outlined" sx={{ height: '100%' }}>
                    {listing.previewImageUrl ? (
                      <Box
                        component="img"
                        src={listing.previewImageUrl}
                        alt={`${listing.displayName} preview`}
                        sx={{
                          width: '100%',
                          height: 120,
                          objectFit: 'cover',
                        }}
                      />
                    ) : null}
                    <CardContent>
                      <Typography variant="h6">
                        {listing.displayName}
                      </Typography>
                      {listing.category ? (
                        <Chip
                          label={listing.category}
                          size="small"
                          variant="outlined"
                          sx={{ my: 1 }}
                        />
                      ) : null}
                      <Typography variant="body2" color="text.secondary">
                        {listing.description ?? ''}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        component="div"
                        sx={{ mt: 1 }}
                      >
                        {`${listing.screenCount ?? '?'} screens · v${
                          listing.latestVersion
                        }` +
                          (Number(listing.priceUsd ?? 0) > 0
                            ? ` · $${listing.priceUsd}`
                            : ' · free')}
                      </Typography>
                    </CardContent>
                    <CardActions>
                      <Button
                        size="small"
                        variant="contained"
                        color="secondary"
                        disabled={installingId === listing.$id}
                        onClick={handleInstallTemplate(listing)}
                      >
                        {installingId === listing.$id
                          ? 'Installing…'
                          : 'Use template'}
                      </Button>
                    </CardActions>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Start blank instead'}</Button>
      </DialogActions>
      <UseTemplateDialog
        hostId={hostId}
        template={useTemplate}
        onClose={() => {
          setUseTemplate(null)
          // The gallery's job is done once a page exists; leaving it open
          // over a fresh page invites a second accidental create.
          onClose()
        }}
      />
    </Dialog>
  )
}
TemplateGalleryDialog.displayName = 'TemplateGalleryDialog'

export default TemplateGalleryDialog
