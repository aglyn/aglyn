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

import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useHost } from '../hooks/use-host'
import { holdsSiteKey } from '@aglyn/aglyn/app-utils/host-permissions'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { docsHelp } from '../constants/docs-links'
import { buildRoute, Route } from '../constants/route-links'
import { useOrgSlug } from '../hooks/use-org-scope'

/** One resource that goes with the site, as `GET /api/hosts/delete` lists it. */
export interface DeleteSiteResourceGoing {
  id: string
  name: string
  /** How many items it holds; `null` where the server could not count them. */
  items: number | null
}

/** One plugin's resources shared with the site: a workspace's datasets. */
export interface DeleteSiteResourceGroup {
  pluginId: string
  /** `null` where the plugin could not answer, so the list is incomplete. */
  preview: {
    noun: readonly [string, string]
    itemNoun: readonly [string, string]
    going: DeleteSiteResourceGoing[]
    staying: number
  } | null
}

/** What deleting the site takes with it (AGL-4003). */
export interface DeleteSitePreview {
  resources: DeleteSiteResourceGroup[]
}

/** "12 records", "1 record", or that they could not be counted. */
export function deleteSiteItemCount(
  items: number | null,
  noun: readonly [string, string],
): string {
  if (items === null) return `${noun[1][0].toUpperCase()}${noun[1].slice(1)} not counted`
  return `${items.toLocaleString()} ${items === 1 ? noun[0] : noun[1]}`
}

/**
 * The confirm dialog's sentence: the site, and how many of each resource go
 * with it, so the last thing read before the button is the whole of what
 * goes.
 */
export function deleteSiteConfirmText(
  siteName: string,
  preview: DeleteSitePreview | null,
): string {
  const going = (preview?.resources ?? []).flatMap(({ preview: group }) => {
    const count = group?.going.length ?? 0
    if (!group || !count) return []
    return count === 1
      ? [`the ${group.noun[0]} shared with this site only and its ${group.itemNoun[1]}`]
      : [`the ${count} ${group.noun[1]} shared with this site only and their ${group.itemNoun[1]}`]
  })
  const lists = going.length ? `, with ${going.join(' and ')},` : ''
  return (
    `"${siteName}" and all of its pages, media, and settings${lists} are ` +
    "permanently deleted. This can't be undone."
  )
}

/**
 * What goes with the site, read when the card opens (AGL-4003),
 * so they are shown before anyone types the name. `undefined` while it
 * reads; `null` when it could not be read.
 */
function useDeleteSitePreview(
  hostId: string,
  user: unknown,
  enabled: boolean,
): DeleteSitePreview | null | undefined {
  const uid = (user as { uid?: string } | null | undefined)?.uid
  const [preview, setPreview] = useState<DeleteSitePreview | null | undefined>(undefined)
  useEffect(() => {
    if (!enabled || !uid) return
    let live = true
    setPreview(undefined)
    authorizedFetch(user, `/api/hosts/delete?hostId=${encodeURIComponent(hostId)}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null)
        if (!response.ok || !payload || !Array.isArray(payload.resources)) return null
        return { resources: payload.resources as DeleteSiteResourceGroup[] }
      })
      .catch(() => null)
      .then((next) => {
        if (live) setPreview(next)
      })
    return () => {
      live = false
    }
    // Keyed on who and which site — not on `user`, whose identity changes
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId, uid, enabled])
  return preview
}

/**
 * Delete site (AGL-488): site-admin-only. A single site is deleted
 * immediately (no hold) behind a type-the-name confirm plus a dialog; the
 * server route's `eraseHost` cleans up Storage, the routing index, the
 * org's hosts map, and the whole Firestore tree so nothing is orphaned.
 *
 * The datasets shared with this site only go with it, with their records,
 * and so do its AI jobs, AI insights and Assist conversations (AGL-4003).
 * The card lists those datasets, each with its record count, before it asks.
 */
export function DeleteSiteCard(props: { hostId: string }) {
  const { hostId } = props
  const { data: user } = useUser()
  const router = useRouter()
  const orgSlug = useOrgSlug()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const {
    doc: { data: host },
  } = useHost({ hostId })
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)

  // "Manage site settings" (`site.manage`, AGL-4047), read as the rules and
  // `/api/hosts/delete` read it.
  const isAdmin = holdsSiteKey(host as never, (user as any)?.uid ?? '', 'site.manage')
  const siteName = (host as any)?.displayName || hostId
  const preview = useDeleteSitePreview(hostId, user, isAdmin)
  // Only site admins can delete; the tab still renders for others without it.
  if (!isAdmin) return null

  const handleDelete = async () => {
    if (busy) return
    const accepted = await confirm({
      title: 'Delete this site?',
      description: deleteSiteConfirmText(siteName, preview ?? null),
      confirmationText: 'Delete site',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!accepted) return
    setBusy(true)
    try {
      const response = await authorizedFetch(user, '/api/hosts/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.error ?? 'Delete failed')
      }
      enqueueSnackbar(`"${siteName}" deleted`, { variant: 'success' })
      // The sites list moved under the org slug (AGL-621); bare `/hosts` is
      // no longer a route, so deleting a site landed on a 404.
      router.push(buildRoute(Route.HOST_LIST, { orgSlug }))
    } catch (error: any) {
      enqueueSnackbar(error?.message ?? 'Could not delete the site', {
        variant: 'error',
        allowDuplicate: true,
      })
      setBusy(false)
    }
  }

  return (
    <CardDisplay
      header={'Delete site'}
      help={docsHelp('downgradingAndCanceling', {
        anchor: '#deleting-a-single-site',
        excerpt:
          'Deleting a site is immediate and permanent — export a backup ' +
          'first if you might want it back.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2} sx={{ maxWidth: 480 }}>
        <Typography variant="body2" color="text.secondary">
          {'Permanently delete this site — its pages, media, and settings, ' +
            'its AI jobs, AI insights, and Assist conversations, and the ' +
            'datasets shared with this site only. This is immediate and ' +
            'cannot be undone. Export a backup first if you might want it back.'}
        </Typography>
        <DeleteSiteResources preview={preview} />
        <TextField
          label={`Type "${siteName}" to confirm`}
          value={confirmText}
          disabled={busy}
          onChange={(event) => setConfirmText(event.target.value)}
          size="small"
        />
        <Button
          color="error"
          variant="contained"
          disabled={busy || confirmText.trim() !== siteName}
          onClick={() => void handleDelete()}
          sx={{ alignSelf: 'flex-start' }}
        >
          {'Delete site'}
        </Button>
      </Stack>
    </CardDisplay>
  )
}
DeleteSiteCard.displayName = 'DeleteSiteCard'

/**
 * What the delete takes — each dataset, with its record count — and how many
 * shared ones stay. Shown while the name is typed, never only after.
 */
export function DeleteSiteResources(props: {
  preview: DeleteSitePreview | null | undefined
}) {
  const { preview } = props
  if (preview === undefined) {
    return (
      <Typography variant="body2" color="text.secondary">
        {'Checking which datasets go with this site…'}
      </Typography>
    )
  }
  const groups = preview?.resources ?? []
  const incomplete = preview === null || groups.some((group) => group.preview === null)
  const answered = groups.flatMap((group) => (group.preview ? [{ ...group, preview: group.preview }] : []))
  const going = answered.filter((group) => group.preview.going.length)
  return (
    <Stack spacing={1}>
      {going.map(({ pluginId, preview: { noun, itemNoun, going: rows } }) => (
        <Stack key={pluginId} spacing={0.5}>
          <Typography variant="subtitle2">
            {rows.length === 1
              ? `This ${noun[0]} is deleted with the site, with its ${itemNoun[1]}:`
              : `These ${rows.length} ${noun[1]} are deleted with the site, with their ${itemNoun[1]}:`}
          </Typography>
          <List dense disablePadding aria-label={`${noun[1]} deleted with this site`}>
            {rows.map((row) => (
              <ListItem key={row.id} disableGutters divider>
                <ListItemText primary={row.name} secondary={deleteSiteItemCount(row.items, itemNoun)} />
              </ListItem>
            ))}
          </List>
        </Stack>
      ))}
      {!incomplete && !going.length ? (
        <Typography variant="body2" color="text.secondary">
          {'No datasets are shared with this site only, so none are deleted.'}
        </Typography>
      ) : null}
      {answered
        .filter((group) => group.preview.staying)
        .map(({ pluginId, preview: { noun, staying } }) => (
          <Typography key={`${pluginId}-staying`} variant="body2" color="text.secondary">
            {staying === 1
              ? `One ${noun[0]} this site shares with other sites stays. This site is removed from its sharing.`
              : `${staying} ${noun[1]} this site shares with other sites stay. This site is removed from their sharing.`}
          </Typography>
        ))}
      {incomplete ? (
        <Typography variant="body2" color="warning.main">
          {'Could not list everything that goes with this site. Datasets ' +
            'shared with this site only are still deleted with it; see them ' +
            'on the Data page first.'}
        </Typography>
      ) : null}
    </Stack>
  )
}
DeleteSiteResources.displayName = 'DeleteSiteResources'

export default DeleteSiteCard
