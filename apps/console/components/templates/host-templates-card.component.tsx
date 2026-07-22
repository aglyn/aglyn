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
import type { TemplateKind } from '@aglyn/aglyn'
import { AppLink, CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import {
  Button,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  collection,
  doc,
  getDoc,
  limit,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { docsHelp } from '../../constants/docs-links'
import { buildRoute, Route } from '../../constants/route-links'
import { useHostSubdomain } from '../host-id-provider'
import { useOrgSlug } from '../../hooks/use-org-scope'
import useFirestoreCollection from '../../hooks/use-firestore-collection'
import UseTemplateDialog from './use-template-dialog.component'

const KIND_ORDER: Array<{ kind: TemplateKind; heading: string; blurb: string }> =
  [
    {
      kind: 'page',
      heading: 'Pages',
      blurb: 'Start a new screen from a saved layout of content.',
    },
    {
      kind: 'component',
      heading: 'Components',
      blurb: 'Drop a saved element tree onto any screen.',
    },
    {
      kind: 'layout',
      heading: 'Layouts',
      blurb: 'Reuse saved page chrome — header, footer, navigation.',
    },
  ]

/**
 * Provenance badge (AGL-666), qualified once the copy has been edited
 * locally (AGL-681).
 *
 * `source` is server-managed so a marketplace claim cannot be forged. But
 * once someone edits a downloaded template, "Marketplace" alone starts
 * vouching for content the publisher never wrote — so an edited copy says
 * so. `editedAt` is client-written on purpose: it is a claim nobody gains
 * anything by faking about their own copy.
 */
function sourceChip(
  source: { type?: string; listingId?: string } | undefined,
  editedAt?: unknown,
) {
  const edited = Boolean(editedAt)
  if (source?.type === 'marketplace') {
    return {
      label: edited ? 'Marketplace · edited' : 'Marketplace',
      color: 'secondary' as const,
    }
  }
  if (source?.type === 'starter') {
    return {
      label: edited ? 'Starter · edited' : 'Starter',
      color: 'default' as const,
    }
  }
  return { label: 'Saved here', color: 'default' as const }
}

/**
 * Templates library (AGL-667).
 *
 * Templates are inert: nothing here is on the live site until it is used,
 * which is what lets marketplace downloads land somewhere safe instead of
 * publishing pages the moment you click install.
 *
 * Grouped by kind rather than listed flat because the three kinds are used
 * in completely different places — a page template makes a screen, a
 * component template goes onto one.
 */
export function HostTemplatesCard({ hostId }: { hostId: string }) {
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { data: user } = useUser()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const router = useRouter()
  const [useTemplate, setUseTemplate] = useState<Record<string, any> | null>(
    null,
  )
  const [updating, setUpdating] = useState<string | null>(null)
  /**
   * Listing id → latest published version (AGL-671).
   *
   * "An update is available" needs no new data: a listing already records
   * `latestVersion`, and an installed template records the version it came
   * from. This is that comparison.
   */
  const [latestByListing, setLatestByListing] = useState<
    Map<string, number | string>
  >(new Map())
  const { data: templateDocs, status } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'templates'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )

  /**
   * One row per template, EXCEPT that a starter's pages collapse into a
   * single row keyed by `source.starterId` (Zach's call, AGL-694).
   *
   * A multi-page starter materializes one document per screen (AGL-687), so
   * flat it would put five rows in the library for something the gallery
   * presents as one card. Grouping keeps the two surfaces agreeing. The row
   * points at the FIRST page in authored order; its detail page lists the
   * siblings, so nothing is hidden — the pages remain individually editable,
   * usable and deletable from there.
   *
   * Whether this is the right trade is deliberately left open — AGL-696
   * revisits it once a multi-page starter can actually be looked at.
   */
  const rows = useMemo(() => {
    const seenStarters = new Set<string>()
    const out: Array<{
      key: string
      template: any
      displayName: string
      description?: string
      pageCount: number
    }> = []
    const live = (templateDocs ?? []).filter((entry: any) => !entry.deletedAt)
    // Kind order first, then name — the sections this table replaced were
    // ordered that way and the ordering was the useful part of them.
    const kindRank = (kind: string) =>
      KIND_ORDER.findIndex((entry) => entry.kind === kind)
    const sorted = [...live].sort((a: any, b: any) => {
      const byRank = kindRank(a.kind ?? 'page') - kindRank(b.kind ?? 'page')
      if (byRank !== 0) return byRank
      return String(a.displayName ?? '').localeCompare(
        String(b.displayName ?? ''),
      )
    })
    for (const template of sorted) {
      const starterId = template.source?.starterId as string | undefined
      if (starterId) {
        if (seenStarters.has(starterId)) continue
        seenStarters.add(starterId)
        const pages = live
          .filter((entry: any) => entry.source?.starterId === starterId)
          .sort(
            (a: any, b: any) =>
              Number(a.source?.starterOrder ?? 0) -
              Number(b.source?.starterOrder ?? 0),
          )
        out.push({
          key: `starter:${starterId}`,
          template: pages[0] ?? template,
          displayName:
            template.source?.starterName ?? template.displayName ?? starterId,
          description: template.source?.starterDescription,
          pageCount: pages.length,
        })
        continue
      }
      out.push({
        key: template.$id,
        template,
        displayName: template.displayName ?? template.$id,
        description: template.description,
        pageCount: 1,
      })
    }
    return out
  }, [templateDocs])

  const byKind = useMemo(() => {
    const groups = new Map<string, any[]>()
    for (const template of templateDocs ?? []) {
      if (template.deletedAt) continue
      const kind = template.kind ?? 'page'
      groups.set(kind, [...(groups.get(kind) ?? []), template])
    }
    for (const list of groups.values()) {
      list.sort((a, b) =>
        String(a.displayName ?? '').localeCompare(String(b.displayName ?? '')),
      )
    }
    return groups
  }, [templateDocs])

  const total = useMemo(
    () => (templateDocs ?? []).filter((entry: any) => !entry.deletedAt).length,
    [templateDocs],
  )

  const listingIds = useMemo(() => {
    const ids = new Set<string>()
    for (const entry of templateDocs ?? []) {
      if (entry.deletedAt) continue
      const id = entry.source?.listingId
      if (entry.source?.type === 'marketplace' && id) ids.add(id)
    }
    return Array.from(ids).sort().join(',')
  }, [templateDocs])

  useEffect(() => {
    if (!listingIds) return
    let active = true
    void Promise.all(
      listingIds.split(',').map(async (id) => {
        try {
          const snapshot = await getDoc(doc(firestore, 'communityListings', id))
          const version = snapshot.get('latestVersion')
          return version == null ? null : ([id, version] as const)
        } catch {
          // Listing removed or unreadable — no badge rather than a wrong one.
          return null
        }
      }),
    ).then((entries) => {
      if (!active) return
      setLatestByListing(
        new Map(entries.filter(Boolean) as Array<readonly [string, any]>),
      )
    })
    return () => {
      active = false
    }
  }, [firestore, listingIds])

  const hasUpdate = useCallback(
    (template: any) => {
      if (template.source?.type !== 'marketplace') return false
      const latest = latestByListing.get(template.source.listingId)
      if (latest == null || template.source.version == null) return false
      // Versions are numbers in practice but typed loosely; compare
      // numerically when both parse, otherwise fall back to inequality.
      const a = Number(template.source.version)
      const b = Number(latest)
      return Number.isFinite(a) && Number.isFinite(b)
        ? b > a
        : String(latest) !== String(template.source.version)
    },
    [latestByListing],
  )

  const handleUpdate = useCallback(
    (template: any) => async () => {
      const listingId = template.source?.listingId
      if (!listingId || updating) return
      // Updating re-installs and replaces the bundle (AGL-671). If this copy
      // was edited locally (AGL-681) those edits go with it, so ask first —
      // silently discarding someone's work to fetch a newer version is the
      // worst possible reading of "update".
      if (template.editedAt) {
        const confirmed = await confirm({
          title: 'Replace your edited copy?',
          description:
            `You have edited "${template.displayName ?? template.$id}" since ` +
            'installing it. Updating replaces it with the publisher’s latest ' +
            'version, and your changes to this template are lost. Pages you ' +
            'already created from it are unaffected.',
          confirmationText: 'Replace',
          confirmationButtonProps: { color: 'error' },
        })
          .then(() => true)
          .catch(() => false)
        if (!confirmed) return
      }
      setUpdating(template.$id)
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch('/api/community/install-template', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ listingId, hostId }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          return void enqueueSnackbar(payload?.error ?? 'Update failed', {
            variant: response.status === 402 ? 'warning' : 'error',
            allowDuplicate: true,
          })
        }
        enqueueSnackbar(
          `Updated to v${payload.version} — pages you already created are ` +
            'unchanged.',
          { variant: 'success', persist: false },
        )
      } catch (error) {
        console.error(error)
        enqueueSnackbar('Update failed', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        setUpdating(null)
      }
    },
    [updating, confirm, user, hostId, enqueueSnackbar],
  )

  const handleDelete = useCallback(
    (template: any) => async () => {
      const confirmed = await confirm({
        title: 'Delete this template?',
        description:
          `"${template.displayName ?? template.$id}" is removed from your ` +
          'library. Anything you already created from it is unaffected.',
        confirmationText: 'Delete',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      // Soft delete, matching reusable components — a template may be the
      // only remaining copy of a page someone deleted.
      await updateDoc(
        doc(firestore, 'hosts', hostId, 'templates', template.$id),
        { deletedAt: Timestamp.now() },
      )
      enqueueSnackbar('Template deleted', { variant: 'success', persist: false })
    },
    [confirm, firestore, hostId, enqueueSnackbar],
  )

  // Create from the listing (AGL-694). Templates could previously only be
  // born from "Save as template" elsewhere in the product, so the page that
  // lists them offered no way to make one.
  //
  // Written with `source.type: 'authored'` explicitly rather than left
  // absent: provenance is what the badge and the marketplace update path key
  // off, and an absent source reads as "unknown" rather than "mine".
  const [creating, setCreating] = useState(false)
  const handleCreate = useCallback(async () => {
    if (creating) return
    setCreating(true)
    try {
      const templateId = Aglyn.createResourceUid()
      const timestamp = Timestamp.now()
      await setDoc(doc(firestore, 'hosts', hostId, 'templates', templateId), {
        hostId,
        kind: 'page',
        displayName: 'Untitled template',
        description: '',
        nodes: {},
        source: { type: 'authored' },
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      router.push(
        buildRoute(Route.TEMPLATE_DETAILS, { orgSlug, host, templateId }),
      )
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Could not create the template', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setCreating(false)
    }
  }, [creating, firestore, hostId, router, orgSlug, host, enqueueSnackbar])

  return (
    <CardDisplay
      header={'Templates'}
      help={docsHelp('templatesLibrary', { anchor: '#the-three-kinds' })}
      contentGutterX
      contentGutterY
    >
      {status === 'loading' ? (
        <Typography variant="body2" color="text.secondary">
          {'Loading…'}
        </Typography>
      ) : total === 0 ? (
        <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
          <Typography variant="body2" color="text.secondary">
            {'No templates yet. Create one here, save one from the Screens, ' +
              'Layouts or Components list — look for “Save as template” — ' +
              'or install one from the marketplace.'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {'Templates stay out of your live site until you use them.'}
          </Typography>
          <Button
            variant="contained"
            color="secondary"
            size="small"
            disabled={creating}
            onClick={handleCreate}
          >
            {creating ? 'Creating…' : 'Create template'}
          </Button>
        </Stack>
      ) : (
        <>
          <Stack direction="row" sx={{ justifyContent: 'flex-end', mb: 1.5 }}>
            <Button
              variant="contained"
              color="secondary"
              size="small"
              disabled={creating}
              onClick={handleCreate}
            >
              {creating ? 'Creating…' : 'Create template'}
            </Button>
          </Stack>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Display name'}</TableCell>
                <TableCell>{'Kind'}</TableCell>
                <TableCell>{'Source'}</TableCell>
                <TableCell>{'Description'}</TableCell>
                <TableCell>{'Updated'}</TableCell>
                <TableCell align="right">{'Actions'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => {
                const template = row.template
                const chip = sourceChip(template.source, template.editedAt)
                return (
                  <TableRow key={row.key} hover>
                    <TableCell>
                      <Stack spacing={0.25}>
                        <AppLink
                          href={buildRoute(Route.TEMPLATE_DETAILS, {
                            orgSlug,
                            host,
                            templateId: template.$id,
                          })}
                        >
                          {row.displayName}
                        </AppLink>
                        {row.pageCount > 1 ? (
                          <Typography variant="caption" color="text.secondary">
                            {`${row.pageCount} pages`}
                          </Typography>
                        ) : null}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {template.kind ?? 'page'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {/* Provenance is server-managed (AGL-666), so this
                          badge means something — a client cannot claim a
                          marketplace origin for its own work. */}
                      <Tooltip
                        title={
                          template.source?.type === 'marketplace'
                            ? `Installed from the marketplace${
                                template.source.version
                                  ? ` (v${template.source.version})`
                                  : ''
                              }`
                            : template.source?.type === 'starter'
                              ? 'A first-party starter'
                              : 'Saved from this site'
                        }
                      >
                        <Chip size="small" label={chip.label} color={chip.color} />
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {row.description || '--'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {template.updatedAt?.toDate?.().toLocaleString() ?? '--'}
                      </Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {hasUpdate(template) ? (
                        <Button
                          size="small"
                          color="secondary"
                          disabled={updating === template.$id}
                          aria-label={`Update ${row.displayName}`}
                          onClick={handleUpdate(template)}
                        >
                          {updating === template.$id
                            ? 'Updating…'
                            : 'Update available'}
                        </Button>
                      ) : null}
                      <Button
                        size="small"
                        aria-label={`Edit ${row.displayName}`}
                        component={AppLink as any}
                        {...({ componentVariant: 'naked' } as any)}
                        href={buildRoute(Route.TEMPLATE_BESIGNER, {
                          orgSlug,
                          host,
                          templateId: template.$id,
                        })}
                      >
                        {'Edit'}
                      </Button>
                      {/* Named for screen readers — "Use" alone repeats
                          once per row with no indication of which. */}
                      <Button
                        size="small"
                        variant="outlined"
                        aria-label={`Use ${row.displayName}`}
                        onClick={() => setUseTemplate(template)}
                      >
                        {'Use'}
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        aria-label={`Delete ${row.displayName}`}
                        onClick={handleDelete(template)}
                      >
                        {'Delete'}
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </>
      )}
      <UseTemplateDialog
        hostId={hostId}
        template={useTemplate}
        onClose={() => setUseTemplate(null)}
      />
    </CardDisplay>
  )
}

HostTemplatesCard.displayName = 'HostTemplatesCard'

export default HostTemplatesCard
