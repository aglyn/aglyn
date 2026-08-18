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

import { ICON_VARIANT_CLOSE } from '@aglyn/shared-data-enums'
import {
  Container,
  MdiIcon,
  SrOnly,
} from '@aglyn/shared-ui-jsx'
import { NavigationDrawerComponent } from '@aglyn/shared-ui-jsx/components/navigation-drawer.component'
import { fetchAllPages } from '../utils/fetch-all-pages'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import type { SystemEmailTemplateDefinition } from '@aglyn/shared-util-email'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Autocomplete,
  Button,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * A thing whose fields can populate a template's merge tokens: an org, a
 * host, or a user. Selecting one fills the token fields with values keyed by
 * the same dotted names the templates use (`org.name`, `host.subdomain`,
 * `user.email`, …), so `{{org.name}}` resolves straight from the chosen org.
 */
interface SampleSource {
  group: 'Organizations' | 'Hosts' | 'Users'
  key: string
  label: string
  /** Token name → value, applied to the fields on select. */
  context: Record<string, string>
  /** Suggested recipient when this source is a person. */
  email?: string
}

interface SendResult {
  subject: string
  preview: string
  sent: boolean
  reason?: string
  detail?: string
}

export interface SystemEmailTestDrawerProps {
  open: boolean
  onClose: () => void
  /** The template to test; null while the drawer is closed. */
  definition: SystemEmailTemplateDefinition | null
}

/**
 * Sends a test of a system email (AGL-766). Staff pick an org/host/user to
 * fill the merge tokens, tweak any field, choose a recipient, and send — the
 * server renders exactly what would go out (designed version or catalog
 * default) and mails a `[Test]` copy.
 *
 * Same right-anchored drawer shell as the create-screen/create-component
 * flows. Orgs, hosts and users all come from staff endpoints.
 *
 * Orgs and hosts USED to be read straight from Firestore as client LISTs,
 * on the reasoning that both are staff-readable. They are — but a client LIST
 * over a collection whose rule is evaluated PER DOCUMENT can poison the local
 * document cache (AGL-929). When a document drops out of a query target — a
 * rule re-evaluating, or an App Check token failing to mint (AGL-1143, live on
 * this deployment) — the SDK cannot tell "denied" from "deleted", resolves it
 * with a single-doc listen, and on another denial records a DELETION at the
 * path. `remoteDocumentsV14` is keyed by path, so that tombstone is then
 * served to every other reader of `orgs/{orgId}` — including `useCurrentOrg`.
 *
 * A staff-only picker is not worth that. AGL-878 moved the staff org list off
 * the client for exactly this reason; this drawer had the same shape and was
 * missed.
 */
export function SystemEmailTestDrawer(props: SystemEmailTestDrawerProps) {
  const { open, onClose, definition } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()

  const [orgDocs, setOrgDocs] = useState<any[]>([])
  const [hostDocs, setHostDocs] = useState<any[]>([])
  const [users, setUsers] = useState<
    { uid: string; email: string | null; displayName: string | null }[]
  >([])
  /**
   * Sources whose page ceiling was hit (AGL-2083). Rendered, not swallowed:
   * the whole defect this closes was a list that looked complete, so a
   * partial list has to say it is partial.
   */
  const [truncated, setTruncated] = useState<string[]>([])

  // One fetch per source, all staff endpoints. Only while the drawer is open —
  // it mounts with the page and these are three list reads nobody asked for
  // until they open it.
  useEffect(() => {
    if (!open || !user) return undefined
    let active = true
    void (async () => {
      const idToken = await (
        user as { getIdToken?: () => Promise<string> }
      )?.getIdToken?.()
      const headers = idToken ? { Authorization: `Bearer ${idToken}` } : {}
      // Every one of these three routes paginates, and this drawer read
      // exactly one page of each (AGL-2083). `/api/admin/orgs` serves 25 per
      // page, so the organization picker listed the first 25 orgs on the
      // platform; `/api/admin/hosts` serves 200; `/api/admin/users` pages
      // through GCIP with a `nextPageToken`. None of them errored and none
      // said they were short — an operator who could not find a host in this
      // picker had every reason to conclude it did not exist.
      const [orgs, hosts, userList] = await Promise.all([
        fetchAllPages<any>({ path: '/api/admin/orgs', key: 'orgs', headers, active: () => active }),
        fetchAllPages<any>({ path: '/api/admin/hosts', key: 'hosts', headers, active: () => active }),
        // GCIP names its cursor differently from the Firestore routes.
        fetchAllPages<any>({
          path: '/api/admin/users',
          key: 'users',
          cursorParam: 'nextPageToken',
          cursorField: 'nextPageToken',
          headers,
          active: () => active,
          // A SECOND kind of short list, narrower than the cursor: an SSO
          // tenant pool that outgrew its per-tenant cap inside a page.
          // Walking `nextPageToken` to the end does not catch it, so
          // dropping this field would leave the picker looking complete
          // again by a different route. `/admin/users` already reports it.
          accumulate: ['tenantTruncated'],
        }),
      ])
      if (!active) return
      setOrgDocs(orgs.items)
      setHostDocs(hosts.items)
      setUsers(userList.items)
      const shortTenants = userList.extras.tenantTruncated ?? []
      setTruncated(
        [
          orgs.truncated ? 'organizations' : null,
          hosts.truncated ? 'sites' : null,
          userList.truncated ? 'users' : null,
          shortTenants.length
            ? `users in ${shortTenants.length} SSO tenant${
                shortTenants.length === 1 ? '' : 's'
              }`
            : null,
        ].filter(Boolean) as string[],
      )
    })().catch(() => undefined)
    return () => {
      active = false
    }
  }, [open, user])

  const sources = useMemo<SampleSource[]>(() => {
    const orgSources: SampleSource[] = (orgDocs ?? []).map((org: any) => ({
      group: 'Organizations',
      key: `org:${org.$id}`,
      label: org.name ?? org.$id,
      context: { 'org.name': String(org.name ?? ''), 'org.id': String(org.$id) },
    }))
    const hostSources: SampleSource[] = (hostDocs ?? []).map((host: any) => ({
      group: 'Hosts',
      key: `host:${host.$id}`,
      label: host.subdomain
        ? `${host.displayName ?? host.$id} (${host.subdomain})`
        : (host.displayName ?? host.$id),
      context: {
        'host.name': String(host.displayName ?? ''),
        'host.subdomain': String(host.subdomain ?? ''),
        'host.id': String(host.$id),
      },
    }))
    const userSources: SampleSource[] = users.map((account) => ({
      group: 'Users',
      key: `user:${account.uid}`,
      label: account.email ?? account.displayName ?? account.uid,
      email: account.email ?? undefined,
      context: {
        'user.email': String(account.email ?? ''),
        'user.name': String(account.displayName ?? ''),
        'user.id': account.uid,
      },
    }))
    return [...orgSources, ...hostSources, ...userSources]
  }, [orgDocs, hostDocs, users])

  const [selected, setSelected] = useState<SampleSource | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [recipient, setRecipient] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<SendResult | null>(null)

  // Re-seed the fields whenever the drawer opens on a template: tokens start
  // at their catalog samples, recipient at the signed-in staffer (test to
  // yourself), and any prior selection/result is cleared.
  useEffect(() => {
    if (!open || !definition) return
    setValues(
      Object.fromEntries(
        definition.mergeTokens.map((token) => [token.name, token.sample]),
      ),
    )
    setRecipient((user as { email?: string } | undefined)?.email ?? '')
    setSelected(null)
    setResult(null)
  }, [open, definition, user])

  const applySource = useCallback(
    (source: SampleSource | null) => {
      setSelected(source)
      if (!source || !definition) return
      // Only overwrite tokens this source actually provides — leave the rest
      // (including anything the staffer already edited) untouched.
      setValues((prev) => {
        const next = { ...prev }
        for (const token of definition.mergeTokens) {
          const value = source.context[token.name]
          if (value !== undefined) next[token.name] = value
        }
        return next
      })
      if (source.email) setRecipient(source.email)
    },
    [definition],
  )

  const handleSend = useCallback(async () => {
    if (!definition) return
    setSending(true)
    setResult(null)
    try {
      const idToken = await (
        user as { getIdToken?: () => Promise<string> }
      )?.getIdToken?.()
      const response = await fetch('/api/admin/emails/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          templateKey: definition.key,
          mergeValues: values,
          to: recipient,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        enqueueSnackbar(payload?.error ?? 'Test send failed', {
          variant: 'error',
          allowDuplicate: true,
        })
        return
      }
      setResult({
        subject: payload.subject ?? '',
        preview: payload.preview ?? '',
        sent: Boolean(payload.sent),
        reason: payload.reason,
        detail: payload.detail,
      })
      if (payload.sent) {
        enqueueSnackbar(`Test sent to ${recipient}`, {
          variant: 'success',
          persist: false,
        })
      } else if (payload.reason === 'unconfigured') {
        enqueueSnackbar(
          'Rendered, but email delivery is not configured here ' +
            '(set RESEND_API_KEY and USAGE_EMAIL_FROM).',
          { variant: 'warning', allowDuplicate: true },
        )
      } else {
        enqueueSnackbar(`Not sent: ${payload.reason ?? 'unknown'}`, {
          variant: 'warning',
          allowDuplicate: true,
        })
      }
    } catch (error) {
      enqueueSnackbar(`Test send failed: ${(error as Error)?.message}`, {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setSending(false)
    }
  }, [definition, values, recipient, user, enqueueSnackbar])

  const recipientValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.trim())

  return (
    <NavigationDrawerComponent
      open={open}
      anchor="right"
      variant="temporary"
      onClose={onClose}
      AppBarProps={{ color: 'surface' }}
      appBarLeft={
        <>
          <IconButton
            color="inherit"
            edge="start"
            onClick={onClose}
            sx={{ mr: 2 }}
          >
            <MdiIcon path={ICON_VARIANT_CLOSE.path} />
            <SrOnly>close drawer</SrOnly>
          </IconButton>
          <Typography variant="h6" component="div">
            {definition ? `Send test — ${definition.name}` : 'Send test email'}
          </Typography>
        </>
      }
      appBarRight={
        <Button variant="outlined" color="inherit" onClick={onClose}>
          {'Cancel'}
        </Button>
      }
    >
      <Container gutterY>
        {definition ? (
          <Stack spacing={2.5}>
            <Typography variant="body2" color="text.secondary">
              {'Sends the email exactly as it would go out now — your ' +
                'designed version if published, otherwise the built-in ' +
                'default. The subject is prefixed with “[Test]”.'}
            </Typography>

            <Stack spacing={1}>
              <Typography variant="subtitle2">{'Populate from'}</Typography>
              {/* An operator who cannot find a host in this picker concludes
                  it does not exist (AGL-2083). Now that the walk is bounded
                  rather than one-page, the one remaining way to be short is
                  the ceiling — and it says so. */}
              {truncated.length > 0 ? (
                <Alert severity="warning">
                  {`This list stopped early for ${truncated.join(' and ')}, ` +
                    'so some entries are missing. Search by name in the ' +
                    'admin list instead.'}
                </Alert>
              ) : null}
              <Autocomplete
                options={[...sources].sort((a, b) =>
                  a.group.localeCompare(b.group),
                )}
                groupBy={(option) => option.group}
                getOptionLabel={(option) => option.label}
                isOptionEqualToValue={(a, b) => a.key === b.key}
                value={selected}
                onChange={(_event, value) => applySource(value)}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    size="small"
                    placeholder="Search organizations, hosts, users"
                  />
                )}
              />
              <Typography variant="caption" color="text.secondary">
                {'Fills the variables below from a real org, host or user. ' +
                  'You can edit any value before sending.'}
              </Typography>
            </Stack>

            {definition.mergeTokens.length ? (
              <Stack spacing={1.5}>
                <Typography variant="subtitle2">{'Variables'}</Typography>
                {definition.mergeTokens.map((token) => (
                  <TextField
                    key={token.name}
                    size="small"
                    label={`{{${token.name}}}`}
                    helperText={token.description}
                    value={values[token.name] ?? ''}
                    onChange={(event) =>
                      setValues((prev) => ({
                        ...prev,
                        [token.name]: event.target.value,
                      }))
                    }
                  />
                ))}
              </Stack>
            ) : (
              <Typography variant="caption" color="text.secondary">
                {'This email uses no variables.'}
              </Typography>
            )}

            <Stack spacing={1}>
              <Typography variant="subtitle2">{'Send test to'}</Typography>
              <TextField
                size="small"
                type="email"
                label="Recipient email"
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                error={Boolean(recipient) && !recipientValid}
                helperText={
                  Boolean(recipient) && !recipientValid
                    ? 'Enter a valid email address'
                    : 'Defaults to you — send the test to your own inbox'
                }
              />
            </Stack>

            {result ? (
              <Alert severity={result.sent ? 'success' : 'info'}>
                <Typography variant="subtitle2">{result.subject}</Typography>
                {result.preview ? (
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    {result.preview}
                    {result.preview.length >= 240 ? '…' : ''}
                  </Typography>
                ) : null}
                {!result.sent ? (
                  <Typography variant="caption" color="text.secondary">
                    {result.reason === 'unconfigured'
                      ? 'Not delivered — email is not configured in this ' +
                        'environment.'
                      : `Not delivered (${result.reason ?? 'unknown'})${
                          result.detail ? `: ${result.detail}` : ''
                        }`}
                  </Typography>
                ) : null}
              </Alert>
            ) : null}

            <Button
              variant="contained"
              onClick={() => void handleSend()}
              disabled={sending || !recipientValid}
              sx={{ alignSelf: 'flex-start' }}
            >
              {sending ? 'Sending…' : 'Send test'}
            </Button>
          </Stack>
        ) : null}
      </Container>
    </NavigationDrawerComponent>
  )
}
SystemEmailTestDrawer.displayName = 'SystemEmailTestDrawer'

export default SystemEmailTestDrawer
