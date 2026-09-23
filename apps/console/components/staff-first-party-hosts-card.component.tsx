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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Alert, Button, Chip, Stack, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { docsHelp } from '../constants/docs-links'

interface FirstPartyHostsBody {
  role: string
  builtIn: string[]
  configured: { hosts: string[]; updatedAtMs: number | null; updatedBy: string | null }
  max: number
}

/**
 * THE FIRST-PARTY HOST REGISTRY, on Platform settings (AGL-3289).
 *
 * Which hosts are the platform's own decides where a sign-up's first touch
 * can start: a hop between two of them is one visit. The built-in half comes
 * from configuration and is shown, not edited — changing it means changing
 * the configuration it reflects. The half staff add is where a new surface is
 * registered: a forum, a status page, another domain.
 *
 * Reading is any staff role; saving is `super` with a reason, enforced by the
 * route, which also writes the audit row. The Save button stays disabled
 * until the list has loaded, so an empty box can never be mistaken for the
 * stored list and saved over it.
 */
export default function StaffFirstPartyHostsCard() {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [data, setData] = useState<FirstPartyHostsBody | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const adopt = useCallback((body: FirstPartyHostsBody) => {
    setData(body)
    setDraft(body.configured.hosts.join('\n'))
  }, [])

  useEffect(() => {
    if (!user) return
    void (async () => {
      try {
        const response = await authorizedFetch(user, '/api/admin/first-party-hosts')
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          setError(payload?.error ?? 'Could not load the first-party hosts')
          return
        }
        setError(null)
        adopt(payload as FirstPartyHostsBody)
      } catch {
        setError('Could not load the first-party hosts')
      }
    })()
  }, [user, adopt])

  const save = async () => {
    if (busy || !data) return
    setBusy(true)
    try {
      const hosts = draft
        .split(/[\n,]/)
        .map((entry) => entry.trim())
        .filter(Boolean)
      const response = await authorizedFetch(user, '/api/admin/first-party-hosts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hosts, note }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        enqueueSnackbar(payload?.error ?? 'Could not save the first-party hosts', { variant: 'error' })
        return
      }
      adopt({ ...data, ...payload } as FirstPartyHostsBody)
      setNote('')
      enqueueSnackbar('First-party hosts saved', { variant: 'success' })
    } catch {
      enqueueSnackbar('Could not save the first-party hosts', { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const help = docsHelp('staffConsole', {
    anchor: '#first-party-hosts',
    excerpt:
      'The hosts the platform serves itself. A visit between two of them is one ' +
      'visit, so a sign-up’s first touch can only start somewhere else.',
  })
  const canEdit = data?.role === 'super'

  return (
    <CardDisplay header="First-party hosts" help={help} contentGutterX contentGutterY>
      {error ? (
        <Alert severity="warning">{error}</Alert>
      ) : !data ? (
        <Typography variant="body2" color="text.secondary">
          {'Loading…'}
        </Typography>
      ) : (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {'Built from this deployment’s configuration, and always included:'}
          </Typography>
          <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 0.5 }}>
            {data.builtIn.length ? (
              data.builtIn.map((host) => <Chip key={host} size="small" label={host} />)
            ) : (
              <Typography variant="body2">{'None — no workspace, console, docs or home address is configured.'}</Typography>
            )}
          </Stack>
          <TextField
            label="Also ours"
            helperText={
              'One per line: a host, *.host for every subdomain, or !host to exclude. ' +
              `At most ${data.max}.`
            }
            multiline
            minRows={3}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={!canEdit || busy}
          />
          {canEdit ? (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
              <TextField
                label="Reason"
                size="small"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                disabled={busy}
                sx={{ flexGrow: 1 }}
              />
              <Button variant="contained" onClick={save} disabled={busy || !note.trim()}>
                {'Save'}
              </Button>
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {'Changing this list needs the super staff role.'}
            </Typography>
          )}
          {data.configured.updatedAtMs ? (
            <Typography variant="caption" color="text.secondary">
              {`Last changed ${new Date(data.configured.updatedAtMs).toLocaleString()}` +
                (data.configured.updatedBy ? ` by ${data.configured.updatedBy}` : '')}
            </Typography>
          ) : null}
        </Stack>
      )}
    </CardDisplay>
  )
}
