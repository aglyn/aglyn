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
  NavigationDrawerComponent,
  SrOnly,
} from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import type { SystemEmailTemplateDefinition } from '@aglyn/shared-util-email'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Autocomplete,
  Button,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { collection, limit, query } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import useFirestoreCollection from '../hooks/use-firestore-collection'

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
 * flows. Orgs and hosts are read straight from Firestore (staff-readable);
 * users come from the staff `/api/admin/users` listing.
 */
export function SystemEmailTestDrawer(props: SystemEmailTestDrawerProps) {
  const { open, onClose, definition } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()

  const { data: orgDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'orgs'), limit(200)),
    [firestore],
    { idField: '$id' },
  )
  const { data: hostDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts'), limit(200)),
    [firestore],
    { idField: '$id' },
  )
  const [users, setUsers] = useState<
    { uid: string; email: string | null; displayName: string | null }[]
  >([])

  // Users aren't a plain collection read — the staff endpoint lists them.
  useEffect(() => {
    if (!open || !user) return undefined
    let active = true
    void (async () => {
      const idToken = await (
        user as { getIdToken?: () => Promise<string> }
      )?.getIdToken?.()
      const response = await fetch('/api/admin/users', {
        headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
      })
      if (!response.ok) return
      const payload = await response.json()
      if (active) setUsers(payload?.users ?? [])
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
