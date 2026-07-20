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
  ICON_VARIANT_HOST,
  ICON_VARIANT_MENU_DOWN,
  ICON_VARIANT_SYMBOL_CONFIRMED,
} from '@aglyn/shared-data-enums'
import { AppLink, MdiIcon } from '@aglyn/shared-ui-jsx'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import {
  Button,
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material'
import { useParams } from 'next/navigation'
import { useRouter } from 'next/navigation'
import { type MouseEvent, useCallback, useState } from 'react'
import { buildRoute, Route } from '../constants/route-links'
import { useHostId } from '../components/host-id-provider'
import { useOrgHosts } from '../hooks/use-org-hosts'
import { useOrgScope, useOrgSlug } from '../hooks/use-org-scope'

function HostsPlainLink() {
  const orgSlug = useOrgSlug()
  return (
    <Button
      id="center-nav-hosts"
      color="inherit"
      component={AppLink as any}
      {...({ componentVariant: 'button', nativeButton: false } as any)}
      href={buildRoute(Route.HOST_LIST, { orgSlug })}
    >
      {'Sites'}
    </Button>
  )
}

/**
 * Host-switcher dropdown for the primary app bar: the button shows the
 * currently selected host (from the `[hostId]` route segment, falling back
 * to "Hosts" outside host routes); the menu lists the user's hosts with the
 * current one checked, plus a fixed "View all hosts" footer.
 */
export function HostSwitcherNavComponent() {
  const { data: user } = useUser()
  // Firestore hooks need a uid; render the plain link until signed in.
  if (!user) {
    return <HostsPlainLink />
  }
  return <HostSwitcherMenu uid={user.uid} />
}
HostSwitcherNavComponent.displayName = 'HostSwitcherNavComponent'

function HostSwitcherMenu(props: { uid: string }) {
  const { uid } = props
  const params = useParams<{ hostId?: string }>()
  const hostId = useHostId()
  const router = useRouter()
  const orgSlug = useOrgSlug()
  const firestore = useFirestore()
  const { currentOrg, loading: orgsLoading } = useOrgScope()
  // Workspace-scoped (AGL-236): the switcher lists the selected org's
  // sites only; undefined holds the query while the workspace resolves.
  const { hosts } = useOrgHosts(
    firestore,
    uid,
    orgsLoading ? undefined : (currentOrg?.$id ?? null),
  )
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)

  const handleOpen = useCallback((event: MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget)
  }, [])
  const handleClose = useCallback(() => setAnchorEl(null), [])
  const handleSelect = useCallback(
    (nextHost: { $id: string; subdomain: string }) => () => {
      setAnchorEl(null)
      if (nextHost.$id !== hostId) {
        void router.push(
          buildRoute(Route.HOST_DASHBOARD, {
            orgSlug,
            host: nextHost.subdomain,
          }),
        )
      }
    },
    [hostId, router, orgSlug],
  )
  const handleViewAll = useCallback(() => {
    setAnchorEl(null)
    void router.push(buildRoute(Route.HOST_LIST, { orgSlug }))
  }, [router])

  const current = (hosts ?? []).find((host: any) => host.$id === hostId)
  const label = current?.displayName ?? current?.$id ?? 'Sites'

  return (
    <>
      <Button
        id="center-nav-hosts"
        variant="text"
        color="inherit"
        size="small"
        aria-haspopup="menu"
        aria-expanded={anchorEl ? 'true' : undefined}
        onClick={handleOpen}
        startIcon={<MdiIcon path={ICON_VARIANT_HOST.path} />}
        endIcon={<MdiIcon path={ICON_VARIANT_MENU_DOWN.path} />}
        sx={{
          maxWidth: 260,
          '& .MuiButton-endIcon': { marginLeft: 0 },
          '& .MuiButton-endIcon>*:nth-of-type(1)': { fontSize: `1.7em` },
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
        onClose={handleClose}
        slotProps={{
          list: { dense: true },
          // Match the shared Menu paper used by the File/Edit/Insert app-bar
          // menus (width, flat elevation, drop shadow, anchor arrow) so the
          // switcher reads as part of the same family (AGL-66).
          paper: {
            elevation: 0,
            sx: {
              width: '30ch',
              filter: 'drop-shadow(0px 2px 8px rgba(0,0,0,0.32))',
              backgroundColor: 'surface.main',
              marginTop: 0.5,
              overflow: 'visible',
              '&:before': {
                content: '""',
                display: 'block',
                position: 'absolute',
                top: 0,
                left: 14,
                width: 10,
                height: 10,
                bgcolor: 'surface.main',
                transform: 'translateY(-50%) rotate(45deg)',
                zIndex: 0,
              },
            },
          },
        }}
      >
        {(hosts ?? []).map((host: any) => (
          <MenuItem
            key={host.$id}
            selected={host.$id === hostId}
            onClick={handleSelect(host)}
          >
            <ListItemIcon>
              <MdiIcon
                fontSize="small"
                path={
                  host.$id === hostId
                    ? ICON_VARIANT_SYMBOL_CONFIRMED.path
                    : ICON_VARIANT_HOST.path
                }
              />
            </ListItemIcon>
            <ListItemText
              primary={host.displayName ?? host.$id}
              secondary={host.cname ?? host.subdomain ?? undefined}
              slotProps={{
                primary: { noWrap: true },
                secondary: { noWrap: true, variant: 'caption' },
              }}
            />
          </MenuItem>
        ))}
        <Divider />
        <MenuItem onClick={handleViewAll}>
          <ListItemText
            primary="View all sites"
            slotProps={{ primary: { color: 'secondary' } }}
          />
        </MenuItem>
      </Menu>
    </>
  )
}

export default HostSwitcherNavComponent
