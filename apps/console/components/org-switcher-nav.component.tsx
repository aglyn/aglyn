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
  Button,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { useOrgWorkspace } from '../hooks/use-org-workspace'

/**
 * Slack-style organization switcher (AGL-236), rendered in the secondary
 * app bar. Switching scopes the console to that org (persisted locally);
 * once wildcard workspace subdomains are live the menu will navigate to
 * {slug}.aglyn.com instead.
 */
export function OrgSwitcherNav() {
  const { orgs, currentOrg, selectOrg, workspaceSlug } = useOrgWorkspace()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  if (!currentOrg) return null

  return (
    <>
      <Tooltip title={`Workspace: ${currentOrg.orgName ?? currentOrg.$id}`}>
        <Button
          size="small"
          color="inherit"
          onClick={(event) => setAnchor(event.currentTarget)}
          sx={{ textTransform: 'none', maxWidth: 220 }}
        >
          <Typography variant="subtitle2" noWrap>
            {currentOrg.orgName ?? currentOrg.slug ?? currentOrg.$id}
          </Typography>
        </Button>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
      >
        {orgs.map((org) => (
          <MenuItem
            key={org.$id}
            selected={org.$id === currentOrg.$id}
            // Subdomain-scoped sessions are pinned to their workspace; the
            // switcher only re-scopes the apex console.
            disabled={Boolean(workspaceSlug) && org.$id !== currentOrg.$id}
            onClick={() => {
              selectOrg(org.$id)
              setAnchor(null)
            }}
          >
            <ListItemText
              primary={org.orgName ?? org.$id}
              secondary={org.slug ? `${org.slug}.aglyn.com · ${org.role}` : org.role}
            />
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
OrgSwitcherNav.displayName = 'OrgSwitcherNav'
OrgSwitcherNav.aglyn = true

export default OrgSwitcherNav
