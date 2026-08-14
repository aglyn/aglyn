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
  LOCKDOWN_FEATURE_KEYS,
  LOCKDOWN_FEATURE_LABELS,
  LOCKDOWN_REASON_CODES,
} from '@aglyn/aglyn'
import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Chip,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import StaffOnly from '../../../../components/staff-only.component'
import { useIsStaff } from '../../../../hooks/use-is-staff'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'

/** Mirrors the route's server-side type-to-confirm — both must be typed. */
const PLATFORM_CONFIRM_PHRASE = 'LOCK PLATFORM'

interface LockdownRecord {
  id: string
  scope?: string
  reason?: string
  message?: string
  atMs?: number
  untilMs?: number
  actorUid?: string
}

/**
 * THE PANIC BUTTON (AGL-1501): platform/org/host/user lockdown controls.
 * Reads are open to all staff; locking and lifting require the super role
 * (enforced server-side by /api/admin/lockdown, which is the only writer —
 * it also revokes sessions, fans out projections, evicts tenant caches and
 * writes the audit rows). Runbook: docs → Staff console → Lockdown.
 */
const AdminLockdown: NextPageWithLayout<Record<string, never>> = () => {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const isStaff = useIsStaff()
  const [records, setRecords] = useState<LockdownRecord[]>([])
  const [busy, setBusy] = useState(false)

  // Platform form.
  const [platformReason, setPlatformReason] = useState('maintenance')
  const [platformMessage, setPlatformMessage] = useState('')
  const [platformUntil, setPlatformUntil] = useState('')
  const [platformConfirm, setPlatformConfirm] = useState('')

  // Feature form (AGL-1510) — one reason/message/until trio shared by the
  // checklist rows; the feature key itself is the target.
  const [featureReason, setFeatureReason] = useState('security')
  const [featureMessage, setFeatureMessage] = useState('')
  const [featureUntil, setFeatureUntil] = useState('')

  // Scoped form.
  const [scope, setScope] = useState('org')
  const [targetId, setTargetId] = useState('')
  const [reason, setReason] = useState('manual')
  const [message, setMessage] = useState('')
  const [until, setUntil] = useState('')

  const platformRecord = records.find((record) => record.id === 'platform')

  const refresh = useCallback(async () => {
    const idToken = await (user as any)?.getIdToken?.()
    if (!idToken) return
    try {
      const response = await fetch('/api/admin/lockdown', {
        headers: { Authorization: `Bearer ${idToken}` },
      })
      if (!response.ok) throw new Error(`Load failed (${response.status})`)
      const payload = await response.json()
      setRecords(payload.records ?? [])
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Loading lockdown state failed', { variant: 'error' })
    }
  }, [user, enqueueSnackbar])

  useEffect(() => {
    if (isStaff) void refresh()
  }, [isStaff, refresh])

  const act = useCallback(
    async (body: Record<string, unknown>, done: () => void) => {
      const idToken = await (user as any)?.getIdToken?.()
      if (!idToken) return
      setBusy(true)
      try {
        const response = await fetch('/api/admin/lockdown', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${idToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(payload.error ?? `Failed (${response.status})`)
        }
        enqueueSnackbar(
          `${body['action'] === 'lock' ? 'Locked' : 'Unlocked'} ${body['scope']} (audited)`,
          { variant: 'success' },
        )
        done()
        await refresh()
      } catch (error: any) {
        console.error(error)
        enqueueSnackbar(error?.message ?? 'Lockdown action failed', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        setBusy(false)
      }
    },
    [user, enqueueSnackbar, refresh],
  )

  const untilMsOf = (value: string): number | undefined => {
    if (!value) return undefined
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? undefined : parsed
  }

  const reasonField = (
    value: string,
    onChange: (next: string) => void,
    label = 'Reason',
  ) => (
    <TextField
      select
      size="small"
      label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      sx={{ minWidth: 180 }}
    >
      {LOCKDOWN_REASON_CODES.map((code) => (
        <MenuItem key={code} value={code}>
          {code}
        </MenuItem>
      ))}
    </TextField>
  )

  return (
    <DashboardLayout
      breadcrumbItems={[
        { children: 'Staff', href: buildRoute(Route.ADMIN_OVERVIEW) },
        { children: 'Lockdown', href: buildRoute(Route.ADMIN_LOCKDOWN) },
      ]}
      help="lockdown"
      header={{
        children: 'Lockdown',
        icon: { path: ICON_VARIANT_SYMBOL_SECURE.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <StaffOnly>
          <Stack spacing={2}>
            <Alert severity={platformRecord ? 'error' : 'info'}>
              {platformRecord
                ? `PLATFORM LOCKDOWN IS ACTIVE (${platformRecord.reason ?? 'manual'}) — every non-staff user is refused. Staff sessions (yours included) bypass every scope.`
                : 'The panic button. Locks are enforced server-side (sessions, sites, APIs), log the affected users out, and show them a per-reason notice. Staff are never locked out. Locking requires the super role; every action is audited.'}
            </Alert>

            <CardDisplay
              header={'Platform'}
              help={docsHelp('lockdown', {
                anchor: '#who-keeps-access-the-un-panic-invariant',
              })}
              contentGutterX
              contentGutterY
            >
              {platformRecord ? (
                <Stack spacing={2}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Chip label="LOCKED" color="error" size="small" />
                    <Typography variant="body2">
                      {`Reason: ${platformRecord.reason ?? 'manual'}`}
                      {platformRecord.untilMs
                        ? ` — until ${new Date(platformRecord.untilMs).toLocaleString()}`
                        : ''}
                    </Typography>
                  </Stack>
                  <Button
                    variant="contained"
                    color="success"
                    disabled={busy}
                    onClick={() =>
                      void act({ action: 'unlock', scope: 'platform' }, () => {
                        setPlatformConfirm('')
                      })
                    }
                    sx={{ alignSelf: 'flex-start' }}
                  >
                    {'Lift the platform lockdown'}
                  </Button>
                </Stack>
              ) : (
                <Stack spacing={2}>
                  <Typography variant="body2" color="text.secondary">
                    {
                      'Locks every non-staff user out of the console and refuses every session mint. Staff sessions keep working — that is how it gets lifted.'
                    }
                  </Typography>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ flexWrap: 'wrap', rowGap: 1 }}
                  >
                    {reasonField(platformReason, setPlatformReason)}
                    <TextField
                      size="small"
                      label="Customer-facing message (optional)"
                      value={platformMessage}
                      onChange={(event) => setPlatformMessage(event.target.value)}
                      sx={{ flexGrow: 1, minWidth: 260 }}
                    />
                    <TextField
                      size="small"
                      type="datetime-local"
                      label="Until (optional)"
                      value={platformUntil}
                      onChange={(event) => setPlatformUntil(event.target.value)}
                      slotProps={{ inputLabel: { shrink: true } }}
                    />
                  </Stack>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <TextField
                      size="small"
                      label={`Type "${PLATFORM_CONFIRM_PHRASE}" to arm`}
                      value={platformConfirm}
                      onChange={(event) => setPlatformConfirm(event.target.value)}
                      sx={{ minWidth: 260 }}
                    />
                    <Button
                      variant="contained"
                      color="error"
                      disabled={busy || platformConfirm !== PLATFORM_CONFIRM_PHRASE}
                      onClick={() =>
                        void act(
                          {
                            action: 'lock',
                            scope: 'platform',
                            reason: platformReason,
                            message: platformMessage || undefined,
                            untilMs: untilMsOf(platformUntil),
                            confirm: platformConfirm,
                          },
                          () => setPlatformConfirm(''),
                        )
                      }
                    >
                      {'Lock the platform'}
                    </Button>
                  </Stack>
                </Stack>
              )}
            </CardDisplay>

            <CardDisplay
              header={'Features'}
              help={docsHelp('lockdown', { anchor: '#feature-scope' })}
              contentGutterX
              contentGutterY
            >
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  {
                    'Kill one capability platform-wide while everything else keeps serving — signups off during a bot wave, uploads off on a malware report, checkout off over a billing bug. A platform lock implies every feature; a feature lock touches nothing else. No type-to-confirm: one named capability is the narrow lever, and it confirms like an org or site lock. Staff bypass: uploads, installs and AI assist stay usable to staff for verification; checkout does not (a staff checkout is still a real charge); signups is decided by account age, not claims.'
                  }
                </Typography>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ flexWrap: 'wrap', rowGap: 1 }}
                >
                  {reasonField(featureReason, setFeatureReason)}
                  <TextField
                    size="small"
                    label="Customer-facing message (optional)"
                    value={featureMessage}
                    onChange={(event) => setFeatureMessage(event.target.value)}
                    sx={{ flexGrow: 1, minWidth: 260 }}
                  />
                  <TextField
                    size="small"
                    type="datetime-local"
                    label="Until (optional)"
                    value={featureUntil}
                    onChange={(event) => setFeatureUntil(event.target.value)}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                </Stack>
                <Stack spacing={1}>
                  {LOCKDOWN_FEATURE_KEYS.map((feature) => {
                    const record = records.find(
                      (candidate) => candidate.id === `feature--${feature}`,
                    )
                    return (
                      <Stack
                        key={feature}
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                      >
                        <Chip
                          label={record ? 'LOCKED' : 'on'}
                          color={record ? 'error' : 'success'}
                          size="small"
                        />
                        <Typography variant="body2" sx={{ minWidth: 220 }}>
                          {LOCKDOWN_FEATURE_LABELS[feature]}
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{ fontFamily: 'monospace' }}
                          color="text.secondary"
                        >
                          {feature}
                        </Typography>
                        {record ? (
                          <Typography variant="body2" color="text.secondary">
                            {`${record.reason ?? 'manual'}${
                              record.untilMs
                                ? ` — until ${new Date(record.untilMs).toLocaleString()}`
                                : ''
                            }`}
                          </Typography>
                        ) : null}
                        {record ? (
                          <Button
                            size="small"
                            variant="outlined"
                            color="success"
                            disabled={busy}
                            onClick={() =>
                              void act(
                                {
                                  action: 'unlock',
                                  scope: 'feature',
                                  targetId: feature,
                                },
                                () => undefined,
                              )
                            }
                          >
                            {'Restore'}
                          </Button>
                        ) : (
                          <Button
                            size="small"
                            variant="contained"
                            color="error"
                            disabled={busy}
                            onClick={() =>
                              void act(
                                {
                                  action: 'lock',
                                  scope: 'feature',
                                  targetId: feature,
                                  reason: featureReason,
                                  message: featureMessage || undefined,
                                  untilMs: untilMsOf(featureUntil),
                                },
                                () => undefined,
                              )
                            }
                          >
                            {'Disable'}
                          </Button>
                        )}
                      </Stack>
                    )
                  })}
                </Stack>
              </Stack>
            </CardDisplay>

            <CardDisplay
              header={'Workspace, site or account'}
              help={docsHelp('lockdown', { anchor: '#operating-it' })}
              contentGutterX
              contentGutterY
            >
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  {
                    'Org locks suspend the workspace (sites 503, writes refused; security/manual also revoke member sessions). Host locks take one site down. User locks disable the account and revoke its sessions. Lifting restores access and is audited too.'
                  }
                </Typography>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ flexWrap: 'wrap', rowGap: 1 }}
                >
                  <TextField
                    select
                    size="small"
                    label="Scope"
                    value={scope}
                    onChange={(event) => setScope(event.target.value)}
                    sx={{ minWidth: 140 }}
                  >
                    <MenuItem value="org">{'Workspace (org)'}</MenuItem>
                    <MenuItem value="host">{'Site (host)'}</MenuItem>
                    <MenuItem value="user">{'Account (user)'}</MenuItem>
                  </TextField>
                  <TextField
                    size="small"
                    label={
                      scope === 'org'
                        ? 'Org id'
                        : scope === 'host'
                          ? 'Host id'
                          : 'User uid'
                    }
                    value={targetId}
                    onChange={(event) => setTargetId(event.target.value)}
                    sx={{ minWidth: 240 }}
                  />
                  {reasonField(reason, setReason)}
                  <TextField
                    size="small"
                    label="Customer-facing message (optional)"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    sx={{ flexGrow: 1, minWidth: 260 }}
                  />
                  <TextField
                    size="small"
                    type="datetime-local"
                    label="Until (optional)"
                    value={until}
                    onChange={(event) => setUntil(event.target.value)}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                </Stack>
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="contained"
                    color="error"
                    disabled={busy || !targetId.trim()}
                    onClick={() =>
                      void act(
                        {
                          action: 'lock',
                          scope,
                          targetId: targetId.trim(),
                          reason,
                          message: message || undefined,
                          untilMs: untilMsOf(until),
                        },
                        () => setTargetId(''),
                      )
                    }
                  >
                    {'Lock'}
                  </Button>
                  <Button
                    variant="outlined"
                    color="success"
                    disabled={busy || !targetId.trim()}
                    onClick={() =>
                      void act(
                        { action: 'unlock', scope, targetId: targetId.trim() },
                        () => setTargetId(''),
                      )
                    }
                  >
                    {'Unlock'}
                  </Button>
                </Stack>
              </Stack>
            </CardDisplay>

            <CardDisplay
              header={'Active platform, feature & account lockdowns'}
              contentGutterX
              contentGutterY
            >
              {records.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {
                    'None. Workspace and site lockdowns are visible on their org/site staff pages (they live on those documents).'
                  }
                </Typography>
              ) : (
                <Stack spacing={1}>
                  {records.map((record) => (
                    <Stack
                      key={record.id}
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <Chip
                        label={
                          record.id === 'platform'
                            ? 'platform'
                            : record.id.startsWith('feature--')
                              ? 'feature'
                              : 'user'
                        }
                        color="error"
                        size="small"
                      />
                      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                        {record.id}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {`${record.reason ?? 'manual'}${
                          record.untilMs
                            ? ` — until ${new Date(record.untilMs).toLocaleString()}`
                            : ''
                        }${record.atMs ? ` — since ${new Date(record.atMs).toLocaleString()}` : ''}`}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              )}
            </CardDisplay>
          </Stack>
        </StaffOnly>
      </Container>
    </DashboardLayout>
  )
}
AdminLockdown.displayName = 'Page:AdminLockdown'

export default AdminLockdown
