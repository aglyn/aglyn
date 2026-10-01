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

import {
  lockdownRefusalText,
  parseLockdownRefusal,
  type ConsoleTemplateGalleryShelfState,
  type ConsoleTemplateGalleryZoneProps,
} from '@aglyn/aglyn'
import { useLoading } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import {
  LIST_QUERY_ID_PATH,
  type ListQueryDeclaration,
  type ListQueryFilter,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { useListQuery } from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import {
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  Grid,
  Typography,
} from '@mui/material'
import { collection } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ListingImage } from './listing-image.component'

/** The name this shelf reports itself by to the gallery. */
const SHELF_ID = 'marketplace-site-templates'

/**
 * What the shelf asks: no Filters panel, the walk's order (the document
 * name, which the automatic single-field indexes serve under the one
 * equality and the one array clause), and the listing's name keys, which
 * every publish stamps (AGL-3321).
 */
const SITE_TEMPLATE_SHELF: ListQueryDeclaration = {
  fields: [],
  sorts: [{ path: LIST_QUERY_ID_PATH, direction: 'asc' }],
  search: { tokensPath: 'nameTokens' },
}

/** The shelf's scope: published site templates. */
const SITE_TEMPLATE_BASE: ListQueryFilter[] = [
  { path: 'kind', op: '==', value: 'template' },
]

/**
 * Marketplace site templates in the template gallery (AGL-137) — the
 * `templateGallery` zone, drawn here since AGL-3080.
 *
 * Published bundles with previews, searched by the gallery's search word.
 * Whole-site page bundles, so — like the gallery's starters — only in the
 * page-kind picker (AGL-699): a five-page site on the components list would
 * install pages nobody asked for.
 *
 * An unpublished listing keeps its document (`deletedAt`), and Firestore
 * cannot ask for the absence of that field without hiding every listing
 * written before the field existed — so it is dropped from the page it falls
 * in. That is the shelf's scope, not a filter: the search is on the query,
 * and a page can only render fewer cards than its size.
 *
 * "Use template" installs through `marketplace/install-template`, which
 * holds every check an install makes, and lands the bundle in the site's
 * library without publishing anything (AGL-669).
 */
export function TemplateGalleryShelf(props: ConsoleTemplateGalleryZoneProps) {
  const { hostId, kind, search, onInstalled, reportShelf } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const offered = kind === 'page'
  const searchWords = useMemo(() => (search ? [search] : []), [search])

  const market = useListQuery<any>({
    collection: offered ? collection(firestore, 'marketplaceListings') : null,
    declaration: SITE_TEMPLATE_SHELF,
    request: { clauses: [], search: searchWords, base: SITE_TEMPLATE_BASE },
    deps: [firestore, offered],
    idField: '$id',
  })
  const listings = useMemo(
    () => market.rows.filter((listing: any) => !listing.deletedAt),
    [market.rows],
  )
  const visible = listings.length > 0 || market.hasMore || market.page > 0
  const state: ConsoleTemplateGalleryShelfState = !offered
    ? 'empty'
    : market.status === 'loading'
      ? 'loading'
      : visible
        ? 'shown'
        : 'empty'
  useEffect(() => {
    reportShelf(SHELF_ID, state)
  }, [reportShelf, state])

  const [installingId, setInstallingId] = useState<string | null>(null)
  const handleInstall = useCallback(
    (listing: any) => async () => {
      if (installingId) return
      setInstallingId(listing.$id)
      const dequeue = queueLoading()
      try {
        const response = await authorizedFetch(
          user,
          '/api/marketplace/install-template',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ listingId: listing.$id, hostId }),
          },
        )
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          // An installs lock is not a broken listing (AGL-1532).
          const locked = parseLockdownRefusal(response.status, payload)
          if (locked) {
            return void enqueueSnackbar(lockdownRefusalText(locked), {
              variant: 'warning',
              persist: true,
            })
          }
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
        onInstalled()
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
    [installingId, user, hostId, queueLoading, enqueueSnackbar, onInstalled],
  )

  if (!offered || !visible) return null
  // One element: the zone stacks its widgets, and the heading, the cards and
  // the pager are one shelf.
  return (
    <Box component="section" aria-label="Marketplace templates">
      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        {'Marketplace templates'}
      </Typography>
      <Grid container spacing={2}>
        {listings.map((listing: any) => (
          <Grid key={listing.$id} size={{ xs: 12, sm: 6, md: 4 }}>
            <Card variant="outlined" sx={{ height: '100%' }}>
              <ListingImage
                src={listing.previewImageUrl}
                alt={`${listing.displayName} preview`}
                sx={{ width: '100%', height: 120, objectFit: 'cover' }}
              />
              <CardContent>
                <Typography variant="h6">{listing.displayName}</Typography>
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
                  {`${listing.screenCount ?? '?'} pages · v${listing.latestVersion}` +
                    (Number(listing.priceUsd ?? 0) > 0
                      ? ` · $${listing.priceUsd}`
                      : ' · free')}
                </Typography>
              </CardContent>
              <CardActions>
                <Button
                  size="small"
                  variant="contained"
                  color="primary"
                  disabled={installingId === listing.$id}
                  onClick={handleInstall(listing)}
                >
                  {installingId === listing.$id ? 'Installing…' : 'Use template'}
                </Button>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>
      <ListPagination
        page={market.page}
        pageSize={market.pageSize}
        rowCount={listings.length}
        hasMore={market.hasMore}
        onPageChange={market.setPage}
        onPageSizeChange={market.setPageSize}
      />
    </Box>
  )
}

export default TemplateGalleryShelf
