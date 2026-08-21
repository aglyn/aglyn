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

import { ICON_VARIANT_SEARCH } from '@aglyn/shared-data-enums'
import { AppLink, MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Box,
  CircularProgress,
  Dialog,
  Divider,
  InputBase,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { useFirestore, useSwitcherCollection, useUser } from '@aglyn/tenant-feature-instance'
import { buildRoute, Route } from '../../constants/route-links'
import { useHostId, useHostReady, useHostSubdomain } from '../host-id-provider'
import { useOrgScope, useOrgSlug } from '../../hooks/use-org-scope'
import {
  globalSearchScopeMessage,
  resolveGlobalSearchScope,
} from './global-search-scope'

export interface GlobalSearchDialogProps {
  open: boolean
  onClose: () => void
}

interface ResultRow {
  key: string
  label: string
  caption: string
  href: string
  group: string
}

/**
 * Console-wide search (AGL-2179).
 *
 * A dialog rather than a field in the top bar, and that is a deliberate
 * reading of AGL-1414: `TopAppBar` carries the besigner's FILE/EDIT/INSERT
 * menubar in its centre slot, its clusters are tuned around a measured 375px
 * budget, and a `min-width: 0` chain runs through it that a single `auto`
 * anywhere in the middle breaks. A text field spliced into that is the one
 * class of change no unit test can see. An icon button in the existing
 * `flexShrink: 0` cluster costs a fixed ~40px and cannot distort the chain,
 * and the field itself lives in here where there is room to be honest about
 * what it searches.
 *
 * ## Scoping
 *
 * Neither query is filtered down to the caller after the fact — both are
 * scoped by the shape of the read, which is the only version that cannot be
 * got wrong by a later edit:
 *
 * * **Sites** come from `users/{uid}/hostMemberships`, the caller's OWN
 *   membership projection, narrowed to the open workspace. Another org's
 *   sites are not filtered out of the result — they were never in the query,
 *   and the rules would refuse another user's projection outright. `skip` is
 *   what holds it until the workspace id is known: an unresolved `orgId`
 *   makes the `where` clause `undefined`, which does not narrow the query, it
 *   DROPS the filter (AGL-2350).
 * * **Screens** come from `hosts/{hostId}/screens` for the site already open,
 *   which `HostGuard` has already admitted the caller to and which the
 *   Firestore rules gate on host membership.
 *
 * So a result this dialog can render is a document the caller could already
 * read. There is no fan-out across an org's sites, which is also why screens
 * are offered only on a site.
 */
export function GlobalSearchDialogComponent(props: GlobalSearchDialogProps) {
  const { open, onClose } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { currentOrg } = useOrgScope()
  const orgSlug = useOrgSlug()
  const hostId = useHostId()
  const hostReady = useHostReady()
  const hostSubdomain = useHostSubdomain()
  const [text, setText] = useState('')

  const uid = user?.uid
  const orgId = currentOrg?.$id ?? null

  const scope = useMemo(
    () => resolveGlobalSearchScope({ orgId, hostId, hostReady }),
    [orgId, hostId, hostReady],
  )
  const searchesSites = scope.entities.includes('sites')
  const searchesScreens = scope.entities.includes('screens')

  // Reset between openings so a stale query never renders against a scope it
  // was not typed in — reopening on a different site is a scope change.
  useEffect(() => {
    if (!open) setText('')
  }, [open])

  const { items: siteHits, loading: sitesLoading } = useSwitcherCollection<any>({
    firestore,
    path: ['users', uid ?? '', 'hostMemberships'],
    where: orgId ? ['orgId', '==', orgId] : undefined,
    // See the scoping note above: without this an unresolved workspace lists
    // every org's sites rather than none.
    skip: !searchesSites || !orgId,
    query: text,
    idField: '$id',
    deps: [firestore, uid, orgId],
  })

  const { items: screenHits, loading: screensLoading } =
    useSwitcherCollection<any>({
      firestore,
      path: ['hosts', hostId ?? '', 'screens'],
      skip: !searchesScreens,
      query: text,
      idField: '$id',
      // Email templates live in this collection too and are edited from the
      // Emails page, not as pages of the site.
      filter: (screen: any) => !screen.deletedAt && screen.kind !== 'email',
      deps: [firestore, hostId],
    })

  const rows = useMemo<ResultRow[]>(() => {
    if (!orgSlug) return []
    const out: ResultRow[] = []
    if (searchesSites) {
      for (const site of siteHits ?? []) {
        if (!site?.subdomain) continue
        out.push({
          key: `site:${site.$id}`,
          label: String(site.displayName ?? site.subdomain),
          caption: 'Site',
          group: 'Sites',
          href: buildRoute(Route.HOST_DASHBOARD, {
            orgSlug,
            host: String(site.subdomain),
          }),
        })
      }
    }
    if (searchesScreens && hostSubdomain) {
      for (const screen of screenHits ?? []) {
        // A screen with no version has never been published or opened, so
        // there is nothing to link to — the besigner routes are version-keyed.
        if (!screen?.versionId) continue
        out.push({
          key: `screen:${screen.$id}`,
          label: String(screen.displayName ?? screen.$id),
          caption: screen.route ? `/${screen.route}` : 'Page',
          group: 'Pages',
          href: buildRoute(Route.SCREEN_DETAILS, {
            orgSlug,
            host: hostSubdomain,
            screenId: String(screen.$id),
            versionId: String(screen.versionId),
          }),
        })
      }
    }
    return out
  }, [
    orgSlug,
    searchesSites,
    searchesScreens,
    siteHits,
    screenHits,
    hostSubdomain,
  ])

  const loading =
    (searchesSites && sitesLoading) || (searchesScreens && screensLoading)
  const scopeMessage = globalSearchScopeMessage(scope)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      slotProps={{ paper: { sx: { alignSelf: 'flex-start', mt: 8 } } }}
      aria-label="Search this workspace"
    >
      <Stack direction="row" sx={{ alignItems: 'center', px: 2, py: 1.5 }}>
        <MdiIcon
          path={ICON_VARIANT_SEARCH.path}
          sx={{ color: 'text.disabled', mr: 1.5 }}
        />
        <InputBase
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={scope.placeholder}
          autoFocus
          fullWidth
          inputProps={{ 'aria-label': scope.placeholder }}
          sx={{ fontSize: 16 }}
        />
        {loading ? <CircularProgress size={16} /> : null}
      </Stack>
      <Divider />

      <Box sx={{ maxHeight: 360, overflowY: 'auto' }}>
        {rows.length === 0 ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ px: 2, py: 3 }}
          >
            {loading
              ? 'Searching…'
              : text.trim()
                ? 'Nothing matched.'
                : 'Recently updated appears here as you type.'}
          </Typography>
        ) : (
          <List dense disablePadding>
            {rows.map((row, index) => {
              const previous = rows[index - 1]
              return (
                <Box key={row.key}>
                  {previous?.group === row.group ? null : (
                    <Typography
                      variant="overline"
                      color="text.secondary"
                      sx={{ display: 'block', px: 2, pt: 1.5 }}
                    >
                      {row.group}
                    </Typography>
                  )}
                  <ListItemButton
                    component={AppLink}
                    href={row.href}
                    onClick={onClose}
                  >
                    <ListItemText
                      primary={row.label}
                      secondary={row.caption}
                      slotProps={{ primary: { noWrap: true } }}
                    />
                  </ListItemButton>
                </Box>
              )
            })}
          </List>
        )}
      </Box>

      {scopeMessage ? (
        <>
          <Divider />
          {/*
            The honest half. A prefix match is not the search box people
            expect, and an unqualified empty result reads as "you do not have
            one" — see `globalSearchScopeMessage`.
          */}
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', px: 2, py: 1.25 }}
          >
            {scopeMessage}
          </Typography>
        </>
      ) : null}
    </Dialog>
  )
}

export default GlobalSearchDialogComponent
