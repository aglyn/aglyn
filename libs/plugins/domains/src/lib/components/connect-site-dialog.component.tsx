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
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'

/*
 * CONNECT A WORKSPACE'S NAME TO A SITE (AGL-4040). A site serves one domain,
 * so connecting to a site that has one replaces it — and the dialog names
 * the domain being replaced before the owner confirms, never after.
 */

export interface ConnectableSite {
  id: string
  name: string
}

export interface ConnectSiteDialogProps {
  open: boolean
  domain: string
  /** The site the name serves now, which is not offered. */
  currentHostId: string | null
  sites: readonly ConnectableSite[]
  /** Each site's current domain, by site id; '' for none. */
  siteDomains: Readonly<Record<string, string>>
  busy: boolean
  error: string | null
  onClose: () => void
  onConnect: (siteId: string) => void
}

/** What connecting `domain` to the site does to the site's current domain. */
export function replacementSentence(domain: string, siteName: string, current: string): string | null {
  if (!current || current === domain) return null
  return `${siteName} uses ${current} now. Connecting ${domain} replaces it: ${current} stops serving ${siteName}, and ${domain} serves it instead. ${current} stays registered wherever it is registered now.`
}

export function ConnectSiteDialog(props: ConnectSiteDialogProps) {
  const { open, domain, currentHostId, sites, siteDomains, busy, error, onClose, onConnect } = props
  const offered = sites.filter((site) => site.id !== currentHostId)
  const [siteId, setSiteId] = useState('')
  useEffect(() => {
    if (open) setSiteId(offered[0]?.id ?? '')
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const site = offered.find((candidate) => candidate.id === siteId)
  const current = site ? (siteDomains[site.id] ?? '') : ''
  const replaces = site ? replacementSentence(domain, site.name, current) : null
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{`Connect ${domain} to a site`}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          {offered.length ? (
            <TextField
              select
              label="Site"
              value={siteId}
              onChange={(event) => setSiteId(event.target.value)}
              disabled={busy}
              size="small"
            >
              {offered.map((candidate) => (
                <MenuItem key={candidate.id} value={candidate.id}>
                  {siteDomains[candidate.id]
                    ? `${candidate.name} (now ${siteDomains[candidate.id]})`
                    : candidate.name}
                </MenuItem>
              ))}
            </TextField>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {'This workspace has no other site to connect it to.'}
            </Typography>
          )}
          {currentHostId ? (
            <Typography variant="body2" color="text.secondary">
              {`${domain} stops serving the site it is connected to now.`}
            </Typography>
          ) : null}
          {replaces ? <Alert severity="warning">{replaces}</Alert> : null}
          {site && !replaces ? (
            <Typography variant="body2" color="text.secondary">
              {`${domain} will serve ${site.name}, with its security certificate set up for you. It usually takes a few minutes.`}
            </Typography>
          ) : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {'Cancel'}
        </Button>
        <Button
          variant="contained"
          color={replaces ? 'warning' : 'primary'}
          disabled={busy || !site}
          onClick={() => site && onConnect(site.id)}
        >
          {busy ? 'Connecting…' : replaces ? `Replace ${current}` : 'Connect'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
