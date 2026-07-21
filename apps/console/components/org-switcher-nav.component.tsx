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
  ICON_VARIANT_MENU_DOWN,
  ICON_VARIANT_MODIFY_ADD,
  ICON_VARIANT_ORGANIZATION,
  ICON_VARIANT_SYMBOL_CONFIRMED,
} from '@aglyn/shared-data-enums'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Avatar,
  Box,
  Button,
  Chip,
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { buildRoute, Route } from '../constants/route-links'
import useCurrentOrg from '../hooks/use-current-org'
import { useOrgPlans } from '../hooks/use-org-plans'
import { useOrgScope } from '../hooks/use-org-scope'
import CreateOrgDialog from './create-org-dialog.component'
import SwitcherSearchField from './switcher-search-field.component'

const WORKSPACE_DOMAIN = process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN ?? 'aglyn.io'

const titleCase = (value?: string) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : ''

/**
 * Organization switcher (AGL-236/AGL-621; AGL-629 Vercel team-switcher UI).
 * The button shows the current workspace; the dropdown filters the user's
 * orgs, marks the current one with a check, and offers a create row.
 * Switching NAVIGATES to the other org's URL — the URL is the source of truth,
 * so there is no local selection to race and snap back (the old switch-bounce).
 * On the apex that is `/[orgSlug]/hosts`; on a workspace subdomain it is the
 * other org's subdomain (the session cookie signs it in silently).
 */
export function OrgSwitcherNav() {
  const { orgs, currentOrg, orgSlug } = useOrgScope()
  // The full current-org doc carries the logo (AGL-363) and plan for the badge.
  const { org } = useCurrentOrg()
  const logoUrl = (org as any)?.logoUrl as string | undefined
  const plan = (org as any)?.plan as string | undefined
  const router = useRouter()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  // Each org's billing tier for the row badges — read only while the menu is
  // open (AGL-631). The current org's plan comes straight from useCurrentOrg.
  const plans = useOrgPlans(
    orgs.map((item) => item.$id),
    Boolean(anchor),
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return orgs
    return orgs.filter((item) =>
      [item.orgName, item.slug, item.$id].some((field) =>
        field?.toLowerCase().includes(needle),
      ),
    )
  }, [orgs, query])

  const close = () => {
    setAnchor(null)
    setQuery('')
  }

  const switchTo = (item: (typeof orgs)[number]) => {
    close()
    if (item.$id === currentOrg?.$id || !item.slug) return
    const href = buildRoute(Route.HOST_LIST, { orgSlug: item.slug })
    // On a workspace subdomain the org IS the hostname, so switching means
    // moving to the other org's subdomain; on the apex it is a client
    // navigation. Either way the URL drives the scope.
    if (orgSlug) {
      window.location.assign(`https://${item.slug}.${WORKSPACE_DOMAIN}${href}`)
      return
    }
    router.push(href)
  }

  if (!currentOrg) return null
  // The pill is the BILLING TIER. Falling back to the member's role meant a
  // free org — which carries no `plan` field — showed "Owner", a role badge
  // masquerading as a plan (AGL-646). No plan means free.
  const currentBadge = titleCase(plan ?? 'free')

  const orgAvatar = (url?: string) =>
    url ? (
      <Avatar src={url} variant="rounded" sx={{ width: 22, height: 22 }} />
    ) : (
      <Avatar
        variant="rounded"
        // Pair the glyph with the background it sits on. Avatar's default
        // fallback color is `background.default`, which against primary.main
        // lands at ~1.4:1 in dark mode — the icon reads as dark-on-dark.
        sx={{
          width: 22,
          height: 22,
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
        }}
      >
        <MdiIcon path={ICON_VARIANT_ORGANIZATION.path} fontSize="small" />
      </Avatar>
    )

  return (
    <>
      <Tooltip title={`Workspace: ${currentOrg.orgName ?? currentOrg.$id}`}>
        <Button
          size="small"
          variant="text"
          color="inherit"
          onClick={(event) => setAnchor(event.currentTarget)}
          startIcon={orgAvatar(logoUrl)}
          endIcon={
            <MdiIcon path={ICON_VARIANT_MENU_DOWN.path} fontSize="small" />
          }
          sx={{
            maxWidth: 280,
            textTransform: 'none',
            gap: 0.5,
            '& .MuiButton-endIcon': { marginLeft: 0.25 },
          }}
        >
          <Typography
            variant="subtitle2"
            noWrap
            sx={{ display: 'block', minWidth: 0 }}
          >
            {currentOrg.orgName ?? currentOrg.slug ?? currentOrg.$id}
          </Typography>
          {currentBadge ? (
            <Chip
              label={currentBadge}
              size="small"
              variant="outlined"
              sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: 11 } }}
            />
          ) : null}
        </Button>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={close}
        autoFocus={false}
        slotProps={{
          list: { autoFocusItem: false, sx: { pt: 0 } },
          paper: { sx: { width: 320, maxWidth: '90vw', mt: 0.5 } },
        }}
      >
        <SwitcherSearchField
          value={query}
          onChange={setQuery}
          placeholder="Find organization…"
        />
        <Divider />
        <Box sx={{ maxHeight: 280, overflowY: 'auto', py: 0.5 }}>
          {filtered.length === 0 ? (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ px: 2, py: 1.5 }}
            >
              {'No organizations match.'}
            </Typography>
          ) : (
            filtered.map((item) => {
              const isCurrent = item.$id === currentOrg.$id
              // Billing tier, like the button — the current org's plan is
              // known immediately, others resolve as the reads land.
              const tier = titleCase(
                plans[item.$id] ?? (isCurrent ? plan ?? 'free' : undefined),
              )
              return (
                <MenuItem
                  key={item.$id}
                  selected={isCurrent}
                  onClick={() => switchTo(item)}
                  sx={{ gap: 1 }}
                >
                  <ListItemIcon sx={{ minWidth: 0 }}>
                    {orgAvatar(isCurrent ? logoUrl : undefined)}
                  </ListItemIcon>
                  <ListItemText
                    primary={item.orgName ?? item.slug ?? item.$id}
                    secondary={
                      item.slug
                        ? `${item.slug}.${WORKSPACE_DOMAIN}`
                        : undefined
                    }
                    slotProps={{
                      primary: { noWrap: true },
                      secondary: { noWrap: true, variant: 'caption' },
                    }}
                  />
                  {tier ? (
                    <Chip
                      label={tier}
                      size="small"
                      variant="outlined"
                      sx={{
                        height: 20,
                        '& .MuiChip-label': { px: 0.75, fontSize: 11 },
                      }}
                    />
                  ) : null}
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
          sx={{ gap: 1, py: 1 }}
        >
          <ListItemIcon sx={{ minWidth: 0 }}>
            <Avatar
              variant="rounded"
              sx={{
                width: 22,
                height: 22,
                bgcolor: 'action.hover',
                color: 'text.secondary',
              }}
            >
              <MdiIcon path={ICON_VARIANT_MODIFY_ADD.path} fontSize="small" />
            </Avatar>
          </ListItemIcon>
          <ListItemText
            primary="Create organization"
            secondary="Own sites and share media, data & billing"
            slotProps={{
              primary: { variant: 'body2' },
              secondary: { variant: 'caption' },
            }}
          />
        </MenuItem>
      </Menu>
      <CreateOrgDialog open={creating} onClose={() => setCreating(false)} />
    </>
  )
}
OrgSwitcherNav.displayName = 'OrgSwitcherNav'
OrgSwitcherNav.aglyn = true

export default OrgSwitcherNav
