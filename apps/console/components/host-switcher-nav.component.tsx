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
import { useRouter } from 'next/navigation'
import { type MouseEvent, useMemo, useState } from 'react'
import { buildRoute, Route } from '../constants/route-links'
import { hostDisplayDomain } from '../constants/tenant-links'
import {
  useHostId,
  useHostSubdomain,
  useOrgHostsContext,
} from '../components/host-id-provider'
import { useOrgSlug } from '../hooks/use-org-scope'
import CreateHostDialog from './create-host-dialog.component'
import HostIcon from './host-icon.component'
import SwitcherSearchField from './switcher-search-field.component'

/**
 * Site switcher for the primary app bar (AGL-629, Vercel project-switcher UI):
 * the button shows the current site (or "All sites" off a site); the dropdown
 * filters the org's sites, marks the current one, and offers a create row. The
 * URL addresses sites by subdomain (AGL-622).
 *
 * The site list comes from `HostIdProvider`'s context, NOT a local
 * `useOrgHosts` subscription: this component is rendered by the per-page
 * `DashboardLayout`, so it remounts on every navigation, and a local
 * subscription restarted from empty each time — flashing "Sites", then
 * "All sites", then the real name (AGL-745).
 */
export function HostSwitcherNavComponent() {
  const hostId = useHostId()
  const hostSubdomain = useHostSubdomain()
  const router = useRouter()
  const orgSlug = useOrgSlug()
  // Workspace-scoped (AGL-236): the provider lists the selected org's sites.
  const { hosts } = useOrgHostsContext()
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
  // On a site route the URL subdomain is known synchronously, so it labels
  // the button during a cold load rather than the misleading "All sites".
  const label =
    current?.displayName ?? current?.$id ?? hostSubdomain ?? 'All sites'

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
                    <HostIcon host={host} color={isCurrent ? 'secondary' : undefined} />
                  </ListItemIcon>
                  <ListItemText
                    primary={host.displayName ?? host.$id}
                    secondary={hostDisplayDomain(host)}
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
