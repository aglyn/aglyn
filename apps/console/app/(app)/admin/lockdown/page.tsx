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
  /** Absent = `full` (AGL-1511) — every record written before the field. */
  mode?: string
  reason?: string
  message?: string
  atMs?: number
  untilMs?: number
  actorUid?: string
}

/**
 * One target's state as the SERVER read it, mirroring `LockState` in
 * /api/admin/lockdown. `readAtMs` is the load-bearing field: it is rendered
 * verbatim so the panel is always a claim about a moment, never an implicit
 * "now" that can quietly go stale.
 */
interface LockState {
  scope: string
  targetId: string
  exists: boolean
  locked: boolean
  mode: string
  reason: string | null
  message: string | null
  untilMs: number | null
  atMs: number | null
  readAtMs: number
}

/**
 * The answer to "what would this caller be told right now", mirroring the
 * verdict probe in /api/admin/lockdown (AGL-1573). `kind` is deliberately
 * on the wire and rendered: this is a COMPUTED verdict, never a wire
 * observation, and the difference is the whole reason the panel exists.
 */
interface VerdictProbe {
  kind: string
  note: string
  computedAtMs: number
  subject: {
    uid: string | null
    orgId: string | null
    hostId: string | null
    uidExists: boolean | null
    orgExists: boolean | null
    hostExists: boolean | null
    staff: boolean | null
  }
  evaluated: string[]
  staffBypass: boolean
  locked: boolean
  verdict: {
    scope: string
    reason: string
    message?: string
    atMs?: number
    untilMs?: number
  } | null
  refusal: { status: number; body: unknown } | null
  /**
   * The verdict asked BOTH ways (AGL-1628). `locked`/`refusal` above are the
   * WRITE case, which is what they always meant; a read-only lock is the case
   * where these two disagree, and that disagreement is the whole answer.
   * Optional so a page served against an older API does not blank out.
   */
  reads?: { locked: boolean; refusal: { status: number; body: unknown } | null }
  writes?: { locked: boolean; refusal: { status: number; body: unknown } | null }
  features: { feature: string; locked: boolean; body: unknown }[]
}

/**
 * The one line an operator needs during an incident: is this caller refused
 * for everything, for writes only, or for nothing? Null when the probe did
 * not report intents, so nothing is asserted that was not measured.
 */
function verdictIntentSummary(probe: VerdictProbe): string | null {
  const { reads, writes } = probe
  if (!reads || !writes) return null
  if (reads.locked && writes.locked)
    return 'Reads AND writes refuse — this caller is fully locked out.'
  if (!reads.locked && writes.locked)
    return 'Reads pass, writes refuse — this workspace is read-only. Their site keeps serving and they can browse the console; saving is what fails.'
  if (reads.locked && !writes.locked)
    // Not reachable through any lock this system can engage; say so rather
    // than render a confident sentence about an impossible state.
    return 'Reads refuse but writes pass — that combination should not be possible; capture this response.'
  return 'Neither reads nor writes are refused for this caller.'
}

interface ActionLogEntry {
  atMs: number
  text: string
  /** The server's post-write read-back agreed with what was asked for. */
  confirmed: boolean
}

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString()

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
  /** Server clock at the last successful state load — shown, never assumed. */
  const [readAtMs, setReadAtMs] = useState<number | null>(null)
  /**
   * Every action that actually reached the server, newest first (AGL-1571).
   *
   * This exists so that a click which never landed is VISIBLE. During the
   * drill two clicks hit empty space after the page re-flowed under the
   * pointer, and nothing on the page distinguished that from success — one
   * of them a lift, which left a feature locked for another 90 seconds while
   * the operator believed it was released. A log the operator can look at
   * turns "no new line appeared" into the answer.
   */
  const [log, setLog] = useState<ActionLogEntry[]>([])

  // Platform form.
  // `full` by default (AGL-1511): the wider, shipped behaviour is what the
  // existing muscle memory expects from this button.
  const [platformMode, setPlatformMode] = useState('full')
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
  const [mode, setMode] = useState('full')
  const [reason, setReason] = useState('manual')
  const [message, setMessage] = useState('')
  const [until, setUntil] = useState('')
  /**
   * The scoped card's verified state, read back from the server. Org and
   * host locks live on their own docs, so before this the panic page showed
   * NOTHING about the two widest scopes — an operator who locked an org had
   * no way to confirm it, or to notice a lift that never happened, without
   * leaving the page they were standing on.
   */
  const [scopedState, setScopedState] = useState<LockState | null>(null)
  /**
   * A panel describing a DIFFERENT target is the same bug wearing a
   * reassuring face, so it is only trusted while it still matches the form.
   */
  const scopedStateIsCurrent =
    scopedState?.scope === scope && scopedState?.targetId === targetId.trim()

  // Verdict probe form (AGL-1573).
  const [verdictUid, setVerdictUid] = useState('')
  const [verdictOrgId, setVerdictOrgId] = useState('')
  const [verdictHostId, setVerdictHostId] = useState('')
  const [verdict, setVerdict] = useState<VerdictProbe | null>(null)

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
      setReadAtMs(Date.now())
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Loading lockdown state failed', { variant: 'error' })
    }
  }, [user, enqueueSnackbar])

  /**
   * Re-read ONE target from the server — the drill's own safety move, which
   * is the only reason the missed lift was ever noticed, made a button.
   */
  const checkScoped = useCallback(async () => {
    const idToken = await (user as any)?.getIdToken?.()
    if (!idToken || !targetId.trim()) return
    setBusy(true)
    try {
      const response = await fetch(
        `/api/admin/lockdown?scope=${encodeURIComponent(scope)}&targetId=${encodeURIComponent(targetId.trim())}`,
        { headers: { Authorization: `Bearer ${idToken}` } },
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error ?? `Failed (${response.status})`)
      }
      setScopedState(payload.state ?? null)
    } catch (error: any) {
      console.error(error)
      // Clear rather than keep the old panel: a stale reading presented as
      // current is exactly the belief this whole issue is about.
      setScopedState(null)
      enqueueSnackbar(error?.message ?? 'Reading the target state failed', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }, [user, scope, targetId, enqueueSnackbar])

  /**
   * Ask the server what a DESCRIBED caller would be told (AGL-1573). Staff
   * cannot be that caller — the un-panic invariant makes their own verdict
   * null on every scope — so the only way to see a customer's refusal from
   * this page is to have the server evaluate it for them.
   */
  const evaluateVerdict = useCallback(async () => {
    const idToken = await (user as any)?.getIdToken?.()
    if (!idToken) return
    const params = new URLSearchParams({ verdict: '1' })
    if (verdictUid.trim()) params.set('uid', verdictUid.trim())
    if (verdictOrgId.trim()) params.set('orgId', verdictOrgId.trim())
    if (verdictHostId.trim()) params.set('hostId', verdictHostId.trim())
    setBusy(true)
    try {
      const response = await fetch(`/api/admin/lockdown?${params.toString()}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error ?? `Failed (${response.status})`)
      }
      setVerdict(payload as VerdictProbe)
    } catch (error: any) {
      console.error(error)
      // Clear rather than keep: a verdict about a previous subject, shown
      // beside a new one, is the stale-panel bug wearing a new face.
      setVerdict(null)
      enqueueSnackbar(error?.message ?? 'Evaluating the verdict failed', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }, [user, verdictUid, verdictOrgId, verdictHostId, enqueueSnackbar])

  useEffect(() => {
    if (isStaff) void refresh()
  }, [isStaff, refresh])

  const act = useCallback(
    async (
      body: Record<string, unknown>,
      done: (payload: Record<string, any>) => void,
    ) => {
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
        // The route answers with a fresh read of what it just wrote. A 200
        // means the request was accepted; only `confirmed` means the state
        // actually changed, and the two are not the same claim.
        const confirmed = payload.confirmed !== false
        const what = `${body['action'] === 'lock' ? 'Locked' : 'Unlocked'} ${body['scope']}${
          body['targetId'] ? ` ${body['targetId']}` : ''
        }`
        setLog((entries) =>
          [{ atMs: Date.now(), text: what, confirmed }, ...entries].slice(0, 25),
        )
        enqueueSnackbar(
          confirmed
            ? `${what} — verified on the server (audited)`
            : `${what} was accepted, but re-reading the target shows the OPPOSITE state. Do not walk away.`,
          {
            variant: confirmed ? 'success' : 'error',
            allowDuplicate: true,
          },
        )
        done(payload)
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

  /**
   * How hard the lock bites (AGL-1511). Two options, and the labels do the
   * teaching rather than a paragraph above them: an operator reaching for
   * this control during an incident reads the dropdown, not the card.
   *
   * Defaults to `full` everywhere, so the button an operator has used before
   * still does what it did before — a control whose default changed under a
   * panic button would be its own incident.
   */
  const modeField = (value: string, onChange: (next: string) => void) => (
    <TextField
      select
      size="small"
      label="Mode"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      sx={{ minWidth: 210 }}
      slotProps={{ select: { native: true } }}
      helperText={
        value === 'read-only'
          ? 'Sites keep serving; writes refuse'
          : 'Everything refuses'
      }
    >
      <option value="full">{'Full — take it down'}</option>
      <option value="read-only">{'Read-only — freeze writes'}</option>
    </TextField>
  )

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
            {/* The banner names the MODE first when it is read-only
                (AGL-1511): "PLATFORM LOCKDOWN IS ACTIVE" in front of an
                operator whose customers' sites are all still serving would
                send them hunting an outage that is not happening. */}
            <Alert
              severity={
                platformRecord
                  ? platformRecord.mode === 'read-only'
                    ? 'warning'
                    : 'error'
                  : 'info'
              }
            >
              {platformRecord
                ? platformRecord.mode === 'read-only'
                  ? `PLATFORM IS READ-ONLY (${platformRecord.reason ?? 'manual'}) — sites keep serving and everyone can read; every write is refused. Staff writes bypass it, which is the point.`
                  : `PLATFORM LOCKDOWN IS ACTIVE (${platformRecord.reason ?? 'manual'}) — every non-staff user is refused. Staff sessions (yours included) bypass every scope.`
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
                    {modeField(platformMode, setPlatformMode)}
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
                            mode: platformMode,
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
                    onChange={(event) => {
                      setScope(event.target.value)
                      // The panel below described the OLD target. Keeping it
                      // visible next to a new one is how an operator ends up
                      // reading a reassuring "NOT LOCKED" about something
                      // nobody checked.
                      setScopedState(null)
                    }}
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
                    onChange={(event) => {
                      setTargetId(event.target.value)
                      setScopedState(null)
                    }}
                    sx={{ minWidth: 240 }}
                  />
                  {/* Read-only is refused server-side on the user scope
                      (AGL-1511) — a user lock's teeth are the Auth disable
                      and token revoke, which have no milder setting — so the
                      control is hidden there rather than offering a choice
                      the route will reject. */}
                  {scope !== 'user' ? modeField(mode, setMode) : null}
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
                          mode: scope === 'user' ? 'full' : mode,
                          reason,
                          message: message || undefined,
                          untilMs: untilMsOf(until),
                        },
                        // The id STAYS. Clearing it used to disable both
                        // buttons the moment a lock landed, so the obvious
                        // next click — Unlock — was on a dead control and
                        // read as "the unlock button doesn't work".
                        (payload) => setScopedState(payload.verified ?? null),
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
                        (payload) => setScopedState(payload.verified ?? null),
                      )
                    }
                  >
                    {'Unlock'}
                  </Button>
                  <Button
                    variant="text"
                    disabled={busy || !targetId.trim()}
                    onClick={() => void checkScoped()}
                  >
                    {'Check state'}
                  </Button>
                </Stack>

                {scopedStateIsCurrent && scopedState ? (
                  <Alert
                    severity={
                      !scopedState.exists
                        ? 'warning'
                        : scopedState.locked
                          ? 'error'
                          : 'success'
                    }
                  >
                    <Stack spacing={0.5}>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                      >
                        <Chip
                          label={
                            !scopedState.exists
                              ? 'NO SUCH TARGET'
                              : scopedState.locked
                                ? 'LOCKED'
                                : 'NOT LOCKED'
                          }
                          color={
                            !scopedState.exists
                              ? 'warning'
                              : scopedState.locked
                                ? 'error'
                                : 'success'
                          }
                          size="small"
                        />
                        <Typography
                          variant="body2"
                          sx={{ fontFamily: 'monospace' }}
                        >
                          {`${scopedState.scope} ${scopedState.targetId}`}
                        </Typography>
                        {scopedState.locked ? (
                          <Typography variant="body2">
                            {`${scopedState.reason ?? 'manual'}${
                              scopedState.untilMs
                                ? ` — until ${new Date(scopedState.untilMs).toLocaleString()}`
                                : ' — no expiry set'
                            }${
                              scopedState.atMs
                                ? ` — since ${new Date(scopedState.atMs).toLocaleString()}`
                                : ''
                            }`}
                          </Typography>
                        ) : null}
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {`Read from the server at ${timeOf(scopedState.readAtMs)}. This is a snapshot, not a live view — press "Check state" to re-read it.`}
                      </Typography>
                    </Stack>
                  </Alert>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {
                      'No verified state for this target. Press "Check state" to read it from the server — never take a lock or a lift on trust, including your own click.'
                    }
                  </Typography>
                )}
              </Stack>
            </CardDisplay>

            <CardDisplay
              header={'What would this caller be told?'}
              help={docsHelp('lockdown', { anchor: '#what-a-caller-is-told' })}
              contentGutterX
              contentGutterY
            >
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  {
                    'You cannot be the refused caller: staff bypass every scope, and dropping your credential gets you a 401 before the verdict runs. So describe the caller instead — a uid, a workspace, a site — and the server runs the same verdict every API route runs, and shows you the exact 423 it would return. Use it during an incident to answer "what is this customer actually seeing right now".'
                  }
                </Typography>
                <Alert severity="info">
                  {
                    'This is a COMPUTED verdict, not a wire observation. It is what this server derives from state it reads now — it does not prove any route returned it, and other server processes can be up to 15 seconds behind.'
                  }
                </Alert>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ flexWrap: 'wrap', rowGap: 1 }}
                >
                  <TextField
                    size="small"
                    label="User uid (optional)"
                    value={verdictUid}
                    onChange={(event) => {
                      setVerdictUid(event.target.value)
                      setVerdict(null)
                    }}
                    sx={{ minWidth: 240 }}
                  />
                  <TextField
                    size="small"
                    label="Org id (optional)"
                    value={verdictOrgId}
                    onChange={(event) => {
                      setVerdictOrgId(event.target.value)
                      setVerdict(null)
                    }}
                    sx={{ minWidth: 240 }}
                  />
                  <TextField
                    size="small"
                    label="Host id (optional)"
                    value={verdictHostId}
                    onChange={(event) => {
                      setVerdictHostId(event.target.value)
                      setVerdict(null)
                    }}
                    sx={{ minWidth: 240 }}
                  />
                  <Button
                    variant="contained"
                    disabled={
                      busy ||
                      (!verdictUid.trim() &&
                        !verdictOrgId.trim() &&
                        !verdictHostId.trim())
                    }
                    onClick={() => void evaluateVerdict()}
                  >
                    {'Evaluate'}
                  </Button>
                </Stack>

                {verdict ? (
                  <Stack spacing={1}>
                    <Alert
                      severity={
                        verdict.staffBypass
                          ? 'warning'
                          : verdict.locked
                            ? 'error'
                            : 'success'
                      }
                    >
                      <Stack spacing={0.5}>
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                        >
                          <Chip
                            label={
                              verdict.staffBypass
                                ? 'STAFF — BYPASSES EVERY SCOPE'
                                : verdict.locked
                                  ? // Name WHICH half is refused when only
                                    // one is: "REFUSED" alone reads as an
                                    // outage on a site that is still serving.
                                    `${
                                      verdict.reads && !verdict.reads.locked
                                        ? 'WRITES REFUSED'
                                        : 'REFUSED'
                                    } ${verdict.refusal?.status ?? 423}`
                                  : 'NOT REFUSED'
                            }
                            color={
                              verdict.staffBypass
                                ? 'warning'
                                : verdict.locked
                                  ? 'error'
                                  : 'success'
                            }
                            size="small"
                          />
                          {verdict.verdict ? (
                            <Typography variant="body2">
                              {`${verdict.verdict.scope} — ${verdict.verdict.reason}${
                                verdict.verdict.untilMs
                                  ? ` — until ${new Date(verdict.verdict.untilMs).toLocaleString()}`
                                  : ''
                              }`}
                            </Typography>
                          ) : null}
                        </Stack>
                        {verdict.staffBypass ? (
                          <Typography variant="body2">
                            {
                              'That account carries the staff claim, so it is never refused by any lockdown — this answer says nothing about whether a lock is engaged.'
                            }
                          </Typography>
                        ) : (
                          (() => {
                            const summary = verdictIntentSummary(verdict)
                            return summary ? (
                              <Typography variant="body2">{summary}</Typography>
                            ) : null
                          })()
                        )}
                        <Typography variant="caption" color="text.secondary">
                          {`Scopes evaluated: ${verdict.evaluated.join(', ')}. Anything you left blank was NOT evaluated — a "not refused" here is not a claim about a scope nobody asked about.`}
                        </Typography>
                      </Stack>
                    </Alert>

                    {verdict.subject.uid && verdict.subject.uidExists === false ? (
                      <Alert severity="warning">
                        {'No account with that uid — check the id.'}
                      </Alert>
                    ) : null}
                    {verdict.subject.orgId && !verdict.subject.orgExists ? (
                      <Alert severity="warning">
                        {'No workspace with that org id — the org scope was skipped, not cleared.'}
                      </Alert>
                    ) : null}
                    {verdict.subject.hostId && !verdict.subject.hostExists ? (
                      <Alert severity="warning">
                        {'No site with that host id — the host scope was skipped, not cleared.'}
                      </Alert>
                    ) : null}

                    {verdict.refusal ? (
                      <Stack spacing={0.5}>
                        <Typography variant="body2">
                          {verdict.reads && !verdict.reads.locked
                            ? `The exact response that caller's WRITE receives (HTTP ${verdict.refusal.status}). Their reads get the real data.`
                            : `The exact response that caller receives (HTTP ${verdict.refusal.status}):`}
                        </Typography>
                        <Typography
                          component="pre"
                          variant="caption"
                          sx={{
                            fontFamily: 'monospace',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            bgcolor: 'action.hover',
                            borderRadius: 1,
                            p: 1,
                            m: 0,
                          }}
                        >
                          {JSON.stringify(verdict.refusal.body, null, 2)}
                        </Typography>
                      </Stack>
                    ) : null}

                    <Typography variant="body2">
                      {verdict.features.some((entry) => entry.locked)
                        ? `Capabilities refused for this caller: ${verdict.features
                            .filter((entry) => entry.locked)
                            .map((entry) => entry.feature)
                            .join(', ')}.`
                        : 'No capability is refused for this caller.'}
                    </Typography>

                    <Typography variant="caption" color="text.secondary">
                      {`Computed at ${timeOf(verdict.computedAtMs)}. ${verdict.note}`}
                    </Typography>
                  </Stack>
                ) : null}
              </Stack>
            </CardDisplay>

            <CardDisplay
              header={'Actions taken in this session'}
              contentGutterX
              contentGutterY
            >
              {log.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {
                    'Nothing yet. Every lock and lift that reaches the server lands here, stamped with the time it landed — so if you clicked and no line appeared, the click did not register.'
                  }
                </Typography>
              ) : (
                <Stack spacing={1}>
                  {log.map((entry) => (
                    <Stack
                      key={`${entry.atMs}-${entry.text}`}
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <Chip
                        label={entry.confirmed ? 'verified' : 'NOT CONFIRMED'}
                        color={entry.confirmed ? 'success' : 'error'}
                        size="small"
                      />
                      <Typography variant="body2">
                        {`${timeOf(entry.atMs)} — ${entry.text}`}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              )}
            </CardDisplay>

            <CardDisplay
              header={'Active platform, feature & account lockdowns'}
              contentGutterX
              contentGutterY
            >
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1 }}
              >
                <Typography variant="caption" color="text.secondary">
                  {readAtMs
                    ? `As read at ${timeOf(readAtMs)} — a snapshot, not a live view.`
                    : 'Not loaded yet.'}
                </Typography>
                <Button size="small" disabled={busy} onClick={() => void refresh()}>
                  {'Refresh'}
                </Button>
              </Stack>
              {records.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {
                    'None. Workspace and site lockdowns live on their own documents — check one with "Check state" above, or see its org/site staff page.'
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
