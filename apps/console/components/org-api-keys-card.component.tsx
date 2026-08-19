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

import { buildDocsUrl } from '../constants/docs-links'
import { canManageOrg, checkEntitlement } from '@aglyn/aglyn'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../constants/docs-links'
import useCurrentOrg from '../hooks/use-current-org'
import { useOrgScope } from '../hooks/use-org-scope'

/**
 * Scopes offered in the UI. This list must hold EVERY entry of `API_SCOPES`
 * — a scope the server enforces but this picker omits is a scope nobody can
 * grant, so the endpoint behind it ships closed to every customer.
 *
 * It is a hand-maintained copy rather than a `map` over `API_SCOPES` because
 * that constant lives in `@aglyn/tenant-data-admin`, whose module graph pulls
 * `firebase-admin` — not something to drag into a client bundle for eight
 * strings. `apps/console/specs/api-scope-picker-coverage.spec.ts` reads both
 * files and fails when they disagree (AGL-2127).
 */
const SCOPE_OPTIONS: Array<{ scope: string; label: string; description: string }> = [
  { scope: 'datasets:read', label: 'Datasets — read', description: 'List datasets and read their records.' },
  { scope: 'datasets:write', label: 'Datasets — write', description: 'Create, update, and delete records.' },
  { scope: 'contacts:read', label: 'Contacts — read', description: 'List and read contacts.' },
  { scope: 'sites:read', label: 'Sites — read', description: 'List sites and their details.' },
  { scope: 'forms:read', label: 'Form submissions — read', description: 'Read a site’s form submissions.' },
  { scope: 'forms:write', label: 'Form submissions — write', description: 'Mark a site’s form submissions read or unread, and delete them. Never edits what a visitor typed.' },
  { scope: 'orders:read', label: 'Orders — read', description: 'Read a site’s store orders, their line items and totals.' },
  { scope: 'products:read', label: 'Products — read', description: 'Read a site’s products, variants, prices and stock.' },
  { scope: 'media:read', label: 'Media — read', description: 'List files in the organization library and a site’s media.' },
]

interface PublicApiKey {
  keyId: string
  name: string
  keyPrefix: string
  scopes: string[]
  createdAt: string | null
  lastUsedAt: string | null
  revokedAt: string | null
}

interface CreateDraft {
  name: string
  scopes: string[]
}

const formatDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString() : '—'

/**
 * API keys manager (AGL-619): create/list/revoke the org's REST API keys.
 * Creation mints the secret server-side and reveals it once; only its hash is
 * stored. Gated by the `apiAccess` entitlement (Business tier).
 */
export function OrgApiKeysCard() {
  const { data: user } = useUser()
  const { currentOrg } = useOrgScope()
  const { org, ready: orgReady } = useCurrentOrg()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const orgId = currentOrg?.$id
  const canManage = canManageOrg(currentOrg?.role)
  const entitled = checkEntitlement(org, 'apiAccess')

  const [keys, setKeys] = useState<PublicApiKey[]>([])
  /**
   * Three outcomes, not two (AGL-1380). `keys = []` is the value before the
   * list has answered and after it has failed, as much as it is the value of
   * an org with no keys — and "No API keys yet" is a claim about what can
   * currently authenticate against this org's data. Wrong in the direction
   * that stops an admin going to revoke one.
   */
  const [listState, setListState] = useState<'pending' | 'error' | 'loaded'>(
    'pending',
  )
  const [draft, setDraft] = useState<CreateDraft | null>(null)
  const [revealed, setRevealed] = useState<{ name: string; token: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const request = useCallback(
    async (method: string, body?: Record<string, unknown>) => {
      if (!orgId) return null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch(
        method === 'GET'
          ? `/api/orgs/api-keys?orgId=${orgId}`
          : '/api/orgs/api-keys',
        {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          ...(body ? { body: JSON.stringify({ ...body, orgId }) } : {}),
        },
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        enqueueSnackbar(payload?.error ?? 'API key request failed', {
          variant: 'warning',
          persist: false,
        })
        return null
      }
      return payload
    },
    [orgId, user, enqueueSnackbar],
  )

  const refresh = useCallback(async () => {
    let payload: Awaited<ReturnType<typeof request>> = null
    try {
      payload = await request('GET')
    } catch {
      // A rejected fetch throws straight past the snackbar inside `request`.
      payload = null
    }
    if (!payload?.keys) {
      setListState('error')
      return
    }
    setKeys(payload.keys)
    setListState('loaded')
  }, [request])

  const retryList = useCallback(() => {
    setListState('pending')
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (orgId && user && orgReady && entitled) void refresh()
  }, [orgId, user, orgReady, entitled, refresh])

  const toggleScope = (scope: string) =>
    setDraft((current) => {
      if (!current) return current
      const scopes = current.scopes.includes(scope)
        ? current.scopes.filter((s) => s !== scope)
        : [...current.scopes, scope]
      return { ...current, scopes }
    })

  const handleCreate = async () => {
    if (!draft || draft.scopes.length === 0 || busy) return
    setBusy(true)
    try {
      const created = await request('POST', {
        action: 'create',
        name: draft.name.trim() || 'API key',
        scopes: draft.scopes,
      })
      if (created?.token) {
        setDraft(null)
        setRevealed({ name: created.key?.name ?? 'API key', token: created.token })
        await refresh()
      }
    } finally {
      setBusy(false)
    }
  }

  const handleRevoke = async (key: PublicApiKey) => {
    // confirm() resolves on accept and REJECTS on cancel (it carries no
    // boolean) — so a catch is the cancel path, not a falsy return value.
    try {
      await confirm({
        title: 'Revoke this API key?',
        description: `"${key.name}" (${key.keyPrefix}) will stop working immediately. This cannot be undone.`,
        confirmationButtonProps: { color: 'error' },
      })
    } catch {
      return
    }
    const result = await request('POST', { action: 'revoke', keyId: key.keyId })
    if (result?.revoked) {
      enqueueSnackbar('API key revoked', { variant: 'success', persist: false })
      await refresh()
    }
  }

  const copyToken = () => {
    if (!revealed) return
    void navigator.clipboard.writeText(revealed.token)
    enqueueSnackbar('API key copied', { variant: 'success', persist: false })
  }

  if (!currentOrg || !canManage) return null

  const activeKeys = keys.filter((key) => !key.revokedAt)

  return (
    <CardDisplay
      header={'API keys'}
      help={docsHelp('billing', {
        anchor: '#tiers--entitlements',
        title: 'REST API & API keys',
        excerpt:
          'Programmatic access to your datasets, contacts, sites, and form submissions. Included on the Business and Advanced plans.',
      })}
      contentGutterX
      contentGutterY
    >
      {/*
        `checkEntitlement(undefined)` answers "no", and `org` is undefined
        both in flight and while the read is failing — so this upsell used to
        be shown to Business orgs that already have the REST API, telling
        them to buy something they own (AGL-1380). Say nothing until the plan
        is known.
      */}
      {!orgReady ? (
        <Typography variant="body2" color="text.secondary">
          {'Checking your plan…'}
        </Typography>
      ) : !entitled ? (
        <Alert severity="info">
          {'The REST API and API keys are included on the '}
          <strong>{'Business'}</strong>
          {' plan — see Billing to upgrade.'}
        </Alert>
      ) : (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {'Create keys to call the '}
            <Link href={buildDocsUrl('/api')} target="_blank" rel="noopener noreferrer">
              {'Aglyn REST API'}
            </Link>
            {'. A key is shown once at creation — store it somewhere safe. Each key is scoped to exactly what it needs.'}
          </Typography>

          {listState === 'error' ? (
            <Alert
              severity="error"
              action={
                <Button color="inherit" size="small" onClick={retryList}>
                  {'Retry'}
                </Button>
              }
            >
              {'We couldn’t load your API keys. This does not mean there are ' +
                'none — any that exist are still live.'}
            </Alert>
          ) : listState === 'pending' ? (
            <Typography variant="body2" color="text.secondary">
              {'Checking your API keys…'}
            </Typography>
          ) : activeKeys.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {'No API keys yet.'}
            </Typography>
          ) : (
            <Stack spacing={1}>
              {activeKeys.map((key) => (
                <Stack
                  key={key.keyId}
                  direction="row"
                  spacing={2}
                  sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <Stack sx={{ minWidth: 0 }}>
                    <Typography variant="body2" noWrap>
                      {key.name}
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                        {key.keyPrefix}
                      </Typography>
                    </Typography>
                    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5, mt: 0.5 }}>
                      {key.scopes.map((scope) => (
                        <Chip key={scope} label={scope} size="small" variant="outlined" />
                      ))}
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                      {`Created ${formatDate(key.createdAt)} · Last used ${formatDate(key.lastUsedAt)}`}
                    </Typography>
                  </Stack>
                  <Button
                    size="small"
                    color="error"
                    onClick={() => void handleRevoke(key)}
                  >
                    {'Revoke'}
                  </Button>
                </Stack>
              ))}
            </Stack>
          )}

          <Button
            size="small"
            color="primary"
            variant="contained"
            sx={{ alignSelf: 'flex-start' }}
            onClick={() => setDraft({ name: '', scopes: ['datasets:read'] })}
          >
            {'Create API key'}
          </Button>
        </Stack>
      )}

      {/* Create dialog */}
      <Dialog open={Boolean(draft)} onClose={() => setDraft(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{'Create API key'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}>
          <TextField
            size="small"
            label="Name"
            placeholder="e.g. Zapier integration"
            value={draft?.name ?? ''}
            onChange={(event) =>
              setDraft((current) => (current ? { ...current, name: event.target.value } : current))
            }
          />
          <Typography variant="subtitle2">{'Scopes'}</Typography>
          {SCOPE_OPTIONS.map((option) => (
            <FormControlLabel
              key={option.scope}
              control={
                <Checkbox
                  checked={draft?.scopes.includes(option.scope) ?? false}
                  onChange={() => toggleScope(option.scope)}
                />
              }
              label={
                <Stack>
                  <Typography variant="body2">{option.label}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {option.description}
                  </Typography>
                </Stack>
              }
            />
          ))}
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setDraft(null)}>
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            color="primary"
            disabled={busy || !draft || draft.scopes.length === 0}
            onClick={() => void handleCreate()}
          >
            {busy ? 'Creating…' : 'Create key'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reveal-once dialog */}
      <Dialog open={Boolean(revealed)} onClose={() => setRevealed(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{'Copy your API key'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}>
          <Alert severity="warning">
            {'This is the only time the key is shown. Copy it now and store it securely — you can’t retrieve it later.'}
          </Alert>
          <TextField
            size="small"
            label={revealed?.name ?? 'API key'}
            value={revealed?.token ?? ''}
            slotProps={{ input: { readOnly: true } }}
            onFocus={(event) => event.target.select()}
          />
        </DialogContent>
        <DialogActions>
          <Button color="primary" onClick={copyToken}>
            {'Copy'}
          </Button>
          <Button variant="contained" color="primary" onClick={() => setRevealed(null)}>
            {'Done'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
OrgApiKeysCard.displayName = 'OrgApiKeysCard'

export default OrgApiKeysCard
