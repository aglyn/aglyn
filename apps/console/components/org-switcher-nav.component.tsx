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

import { generateOrgSlug } from '@aglyn/aglyn'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  InputAdornment,
  ListItemText,
  Menu,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useOrgWorkspace } from '../hooks/use-org-workspace'

/**
 * Slack-style organization switcher (AGL-236), rendered in the secondary
 * app bar. Switching scopes the console to that org (persisted locally);
 * once wildcard workspace subdomains are live the menu will navigate to
 * {slug}.aglyn.com instead.
 */
export function OrgSwitcherNav() {
  const { data: user } = useUser()
  const { orgs, currentOrg, selectOrg, workspaceSlug } = useOrgWorkspace()
  const { enqueueSnackbar } = useSnackbar()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [busy, setBusy] = useState(false)

  const handleCreate = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/orgs/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ name: name.trim(), slug: slug.trim() }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload?.orgId) {
        enqueueSnackbar(payload?.error ?? 'Creating the organization failed', {
          variant: response.status === 409 ? 'warning' : 'error',
        })
        return
      }
      enqueueSnackbar(`Created "${name.trim()}"`, { variant: 'success' })
      selectOrg(payload.orgId)
      setCreating(false)
      setName('')
      setSlug('')
      setSlugTouched(false)
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Creating the organization failed', { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

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
        <Divider />
        <MenuItem
          onClick={() => {
            setAnchor(null)
            setCreating(true)
          }}
        >
          {'Create organization…'}
        </MenuItem>
      </Menu>
      <Dialog
        open={creating}
        onClose={() => (busy ? null : setCreating(false))}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'Create an organization'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
        >
          <Typography variant="body2" color="text.secondary">
            {'Organizations own sites and share media, data, plugins and ' +
              'billing across them. You become the owner.'}
          </Typography>
          <TextField
            label="Organization name"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              if (!slugTouched) setSlug(generateOrgSlug(event.target.value))
            }}
            autoFocus
          />
          <TextField
            label="Workspace URL"
            value={slug}
            onChange={(event) => {
              setSlug(event.target.value.toLowerCase())
              setSlugTouched(true)
            }}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">{'.aglyn.com'}</InputAdornment>
                ),
              },
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setCreating(false)}>
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            disabled={busy || !name.trim()}
            onClick={() => void handleCreate()}
          >
            {busy ? 'Creating…' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
OrgSwitcherNav.displayName = 'OrgSwitcherNav'
OrgSwitcherNav.aglyn = true

export default OrgSwitcherNav
