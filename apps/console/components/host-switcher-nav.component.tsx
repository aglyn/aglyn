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
  ICON_VARIANT_HOST_GROUP,
  ICON_VARIANT_MENU_DOWN,
  ICON_VARIANT_MODIFY_ADD,
  ICON_VARIANT_SYMBOL_CONFIRMED,
} from '@aglyn/shared-data-enums'
import { AppLink, MdiIcon } from '@aglyn/shared-ui-jsx'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import {
  Avatar,
  Box,
  Button,
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material'
import { useParams, useRouter } from 'next/navigation'
import { type MouseEvent, useMemo, useState } from 'react'
import { buildRoute, Route } from '../constants/route-links'
import { useHostId } from '../components/host-id-provider'
import { useOrgHosts } from '../hooks/use-org-hosts'
import { useOrgScope, useOrgSlug } from '../hooks/use-org-scope'
import CreateHostDialog from './create-host-dialog.component'
import SwitcherSearchField from './switcher-search-field.component'

/**
 * A site's icon: its favicon when set (AGL-630), otherwise the generic host
 * glyph (tinted for the current site).
 */
function HostIcon(props: { host?: any; current?: boolean }) {
  const favicon = props.host?.seo?.favicon as string | undefined
  if (favicon) {
    return (
      <Avatar
        src={favicon}
        variant="rounded"
        sx={{ width: 20, height: 20 }}
        slotProps={{ img: { loading: 'lazy' } }}
      />
    )
  }
  return (
    <MdiIcon
      path={ICON_VARIANT_HOST.path}
      fontSize="small"
      color={props.current ? 'secondary' : undefined}
    />
  )
}

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
 * Site switcher for the primary app bar (AGL-629, Vercel project-switcher UI):
 * the button shows the current site (or "All sites" off a site); the dropdown
 * filters the org's sites, marks the current one, and offers a create row. The
 * URL addresses sites by subdomain (AGL-622).
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
  const params = useParams<{ host?: string }>()
  const hostId = useHostId()
  const router = useRouter()
  const orgSlug = useOrgSlug()
  const firestore = useFirestore()
  const { currentOrg, loading: orgsLoading } = useOrgScope()
  // Workspace-scoped (AGL-236): the switcher lists the selected org's sites.
  const { hosts } = useOrgHosts(
    firestore,
    uid,
    orgsLoading ? undefined : (currentOrg?.$id ?? null),
  )
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')

  const close = () => {
    setAnchorEl(null)
    setQuery('')
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list = (hosts ?? []) as Array<any>
    if (!needle) return list
    return list.filter((host) =>
      [host.displayName, host.subdomain, host.cname, host.$id].some(
        (field: string | undefined) => field?.toLowerCase().includes(needle),
      ),
    )
  }, [hosts, query])

  const goToHost = (host: { $id: string; subdomain: string }) => {
    close()
    if (host.$id === hostId) return
    router.push(
      buildRoute(Route.HOST_DASHBOARD, { orgSlug, host: host.subdomain }),
    )
  }

  const current = (hosts ?? []).find((host: any) => host.$id === hostId)
  const label = current?.displayName ?? current?.$id ?? 'All sites'

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
        startIcon={<HostIcon host={current} />}
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
          {filtered.length === 0 ? (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ px: 2, py: 1.5 }}
            >
              {(hosts ?? []).length === 0
                ? 'No sites yet.'
                : 'No sites match.'}
            </Typography>
          ) : (
            filtered.map((host: any) => {
              const isCurrent = host.$id === hostId
              return (
                <MenuItem
                  key={host.$id}
                  selected={isCurrent}
                  onClick={() =>
                    goToHost({ $id: host.$id, subdomain: host.subdomain })
                  }
                  sx={{ gap: 1 }}
                >
                  <ListItemIcon sx={{ minWidth: 0 }}>
                    <HostIcon host={host} current={isCurrent} />
                  </ListItemIcon>
                  <ListItemText
                    primary={host.displayName ?? host.$id}
                    secondary={host.cname ?? host.subdomain ?? undefined}
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

export default HostSwitcherNavComponent
