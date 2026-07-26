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
  ICON_VARIANT_HOST_GROUP,
  ICON_VARIANT_MENU_DOWN,
  ICON_VARIANT_MODIFY_ADD,
  ICON_VARIANT_SYMBOL_CONFIRMED,
} from '@aglyn/shared-data-enums'
import { AppLink, MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Box,
  Button,
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material'
import { doc } from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { type MouseEvent, useMemo, useState } from 'react'
import {
  useFirestore,
  useSwitcherCollection,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { buildRoute, Route } from '../constants/route-links'
import { hostDisplayDomain } from '../constants/tenant-links'
import { useHostId, useHostSubdomain } from '../components/host-id-provider'
import { useOrgScope, useOrgSlug } from '../hooks/use-org-scope'
import useFirestoreDoc from '../hooks/use-firestore-doc'
import CreateHostDialog from './create-host-dialog.component'
import HostIcon from './host-icon.component'
import SwitcherSearchField from './switcher-search-field.component'

/**
 * Site switcher for the primary app bar (AGL-629, Vercel project-switcher UI):
 * the button shows the current site (or "All sites" off a site); the dropdown
 * lists the org's sites, marks the current one, and offers a create row.
 *
 * Backed by the per-user `hostMemberships` projection via `useSwitcherCollection`
 * (AGL-844): a recent-first window when idle and a name-prefix search when
 * typing, so a member of hundreds of sites neither loads them all nor fails to
 * find one outside the loaded window. The current site is read directly so the
 * trigger always labels correctly during a cold load.
 */
export function HostSwitcherNavComponent() {
  const hostId = useHostId()
  const hostSubdomain = useHostSubdomain()
  const router = useRouter()
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { currentOrg } = useOrgScope()
  // The ROUTE slug (path → current org), not `useOrgScope().orgSlug` — that
  // one is the workspace SUBDOMAIN, null on localhost and the console apex,
  // which built literal `/<orgSlug?>/hosts/…` links (AGL-893).
  const orgSlug = useOrgSlug()
  const uid = user?.uid
  const orgId = currentOrg?.$id
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')

  const {
    items: hits,
    loading,
    hasQuery,
  } = useSwitcherCollection<any>({
    firestore,
    path: ['users', uid ?? '', 'hostMemberships'],
    where: orgId ? ['orgId', '==', orgId] : undefined,
    query,
    idField: '$id',
    deps: [firestore, uid, orgId],
  })

  // The open site read directly so the trigger resolves and its row keeps a
  // check even when it falls outside the recent window.
  const { data: currentDoc } = useFirestoreDoc<any>(
    () =>
      uid && hostId
        ? doc(firestore, 'users', uid, 'hostMemberships', hostId)
        : null,
    [firestore, uid, hostId],
    { idField: '$id' },
  )

  const close = () => {
    setAnchorEl(null)
    setQuery('')
  }

  // Pin the open site to the top of the idle window.
  const sites = useMemo(() => {
    const list = [...(hits ?? [])]
    if (
      !hasQuery &&
      currentDoc?.$id &&
      !list.some((site: any) => site.$id === currentDoc.$id)
    ) {
      list.unshift(currentDoc)
    }
    return list
  }, [hits, hasQuery, currentDoc])

  const goToHost = (site: { $id: string; subdomain?: string }) => {
    close()
    if (site.$id === hostId || !site.subdomain) return
    router.push(
      buildRoute(Route.HOST_DASHBOARD, { orgSlug, host: site.subdomain }),
    )
  }

  // The URL subdomain labels the button during a cold load rather than the
  // misleading "All sites".
  const label =
    currentDoc?.displayName ?? currentDoc?.$id ?? hostSubdomain ?? 'All sites'
  const empty = sites.length === 0
  const showEmpty = empty && !loading

  return (
    <>
      <Button
        id="center-nav-hosts"
        variant="text"
        color="inherit"
        size="small"
        aria-haspopup="menu"
        aria-expanded={anchorEl ? 'true' : undefined}
        onClick={(event: MouseEvent<HTMLElement>) =>
          setAnchorEl(event.currentTarget)
        }
        startIcon={<HostIcon host={currentDoc} />}
        endIcon={<MdiIcon path={ICON_VARIANT_MENU_DOWN.path} />}
        sx={{
          maxWidth: 260,
          textTransform: 'none',
          '& .MuiButton-endIcon': { marginLeft: 0.25 },
        }}
      >
        <Typography
          variant="inherit"
          noWrap
          title={label}
          sx={{ display: 'block', minWidth: 0 }}
        >
          {label}
        </Typography>
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={close}
        autoFocus={false}
        slotProps={{
          list: { autoFocusItem: false, dense: true, sx: { pt: 0 } },
          paper: { sx: { width: 300, maxWidth: '90vw', mt: 0.5 } },
        }}
      >
        <SwitcherSearchField
          value={query}
          onChange={setQuery}
          placeholder="Find site…"
        />
        <Divider />
        <Box sx={{ maxHeight: 280, overflowY: 'auto', py: 0.5 }}>
          {showEmpty ? (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ px: 2, py: 1.5 }}
            >
              {hasQuery ? 'No sites match.' : 'No sites yet.'}
            </Typography>
          ) : (
            sites.map((site: any) => {
              const isCurrent = site.$id === hostId
              return (
                <MenuItem
                  key={site.$id}
                  selected={isCurrent}
                  onClick={() =>
                    goToHost({ $id: site.$id, subdomain: site.subdomain })
                  }
                  sx={{ gap: 1 }}
                >
                  <ListItemIcon sx={{ minWidth: 0 }}>
                    <HostIcon host={site} color={isCurrent ? 'secondary' : undefined} />
                  </ListItemIcon>
                  <ListItemText
                    primary={site.displayName ?? site.$id}
                    secondary={hostDisplayDomain(site)}
                    slotProps={{
                      primary: { noWrap: true },
                      secondary: { noWrap: true, variant: 'caption' },
                    }}
                  />
                  {isCurrent ? (
                    <MdiIcon
                      path={ICON_VARIANT_SYMBOL_CONFIRMED.path}
                      fontSize="small"
                      sx={{ color: 'text.secondary' }}
                    />
                  ) : null}
                </MenuItem>
              )
            })
          )}
        </Box>
        <Divider />
        <MenuItem
          onClick={() => {
            close()
            setCreating(true)
          }}
          sx={{ gap: 1 }}
        >
          <ListItemIcon sx={{ minWidth: 0 }}>
            <MdiIcon path={ICON_VARIANT_MODIFY_ADD.path} fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Create site" />
        </MenuItem>
        <MenuItem
          onClick={close}
          component={AppLink as any}
          {...({ componentVariant: 'naked' } as any)}
          href={buildRoute(Route.HOST_LIST, { orgSlug })}
          sx={{ gap: 1 }}
        >
          <ListItemIcon sx={{ minWidth: 0 }}>
            <MdiIcon path={ICON_VARIANT_HOST_GROUP.path} fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary="View all sites"
            slotProps={{ primary: { color: 'secondary' } }}
          />
        </MenuItem>
      </Menu>
      <CreateHostDialog open={creating} onClose={() => setCreating(false)} />
    </>
  )
}
HostSwitcherNavComponent.displayName = 'HostSwitcherNavComponent'

export default HostSwitcherNavComponent
