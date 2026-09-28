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
  listLockdownFeatureKeys,
  lockdownFeatureLabel,
  LOCKDOWN_REASON_CODES,
  PLATFORM_BRAND_NAME,
} from '@aglyn/aglyn'
import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import StaffOnly from '../../../../components/staff-only.component'
import {
  SuperStaffOnlyNotice,
  useSuperStaffGate,
} from '../../../../components/staff-super-only.component'
import { useIsStaff } from '../../../../hooks/use-is-staff'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import {
  lockdownCancelsBillingByDefault,
  lockdownPausesSiteMoneyByDefault,
} from '../../../../constants/subscription-cancel'

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
 * Is the signups lock's creation-level valve armed? (AGL-1531)
 *
 * Mirrors `SignupsCreationTriggerStatus`. `unknown` is "we could not check"
 * and is rendered as exactly that — never as armed. During an incident,
 * "creation is refused" and "we could not confirm creation is refused" are
 * different facts and the page must not merge them.
 *
 * A STRING discriminant because `strictNullChecks` is off here: a
 * `boolean | null` union does not narrow, so the unknown arm would quietly
 * stop being distinguishable from the other two.
 */
type SignupsCreationTrigger =
  | { status: 'armed'; functionUri: string | null; updateTime: string | null }
  | { status: 'absent' }
  | { status: 'unknown'; reason: string }

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
  /** `standard` | `takedown` (AGL-1621); absent on an older server. */
  enforcement?: string
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
 * What the signups lever actually reaches, in one line (AGL-1531).
 *
 * The lock refuses the session mint, the acceptance recorder and the signup
 * pages from code that ships with every deploy. Refusing account CREATION
 * needs a `beforeUserCreated` blocking function that lives in
 * `cloud/functions` and is registered in Identity Platform — neither of which
 * a merge performs. The switch on this page looks identical in both worlds,
 * so without this line an operator in a bot wave would believe the wave had
 * been stopped from creating accounts when it had only been stopped from
 * using them.
 *
 * UNKNOWN never reads as armed. A probe that could not run is not evidence
 * of a valve that is running.
 */
function creationValveLine(
  trigger: SignupsCreationTrigger | null,
): string {
  if (!trigger) {
    return 'Account creation: not reported by this server — treat as sessions-only.'
  }
  if (trigger.status === 'armed') {
    return `Account creation is REFUSED too — Identity Platform has a beforeCreate blocking function registered${
      trigger.functionUri ? ` (${trigger.functionUri})` : ''
    }.`
  }
  if (trigger.status === 'absent') {
    return (
      'Account creation is NOT refused — no beforeCreate blocking function is ' +
      'registered in Identity Platform. Locking signups turns away the session ' +
      'and the signup pages; the Auth records are still created. Deploy ' +
      'cloud/functions (firebase deploy --only functions) and confirm the ' +
      'trigger in Identity Platform.'
    )
  }
  return `Account creation: UNKNOWN — ${
    trigger.status === 'unknown' ? trigger.reason : ''
  } Treat as sessions-only until this reads as registered.`
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

/**
 * The scopes where `mode: 'read-only'` is a real, enforced choice — the
 * three the route accepts it on. Everywhere else the route returns 400, so
 * the control is HIDDEN rather than offered and rejected.
 *
 * `user` (AGL-1511): a user lock's teeth are the Auth `disabled` flag and
 * token revocation, which have no milder setting.
 * `feature` (AGL-1511): every feature key names a write; "read-only
 * checkout" describes nothing. (Not selectable in this card anyway — the
 * feature checklist above owns that scope.)
 * `domain` (AGL-1621): a domain lock stops serving ONE NAME; read-only is
 * defined as continuing to serve. Nothing anywhere would refuse, and this
 * card used to offer the choice, send it, and be told 200 for a full
 * takedown.
 */
const READ_ONLY_SCOPES = new Set(['platform', 'org', 'host'])

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString()

/**
 * The site-money steps an org or host lock or lift reported (AGL-3364):
 * membership renewals paused or resumed, and the seller's payouts paused or
 * restored. One line each, each with its own verified/NOT CONFIRMED chip —
 * a lock that landed and a pause that did not are two facts.
 */
function siteMoneyLogLines(
  payload: Record<string, any>,
): Array<{ text: string; confirmed: boolean }> {
  const lines: Array<{ text: string; confirmed: boolean }> = []
  const problems = (step: Record<string, any>) => [
    ...((step['lookupErrors'] as string[]) ?? []),
    ...((step['subscriptions'] as Array<Record<string, any>>) ?? [])
      .filter((entry) => !entry['confirmed'])
      .map((entry) => `${entry['id']}: ${entry['error'] ?? entry['outcome']}`),
    ...(step['error'] ? [String(step['error'])] : []),
  ]
  const count = (step: Record<string, any>, outcome: string) =>
    ((step['subscriptions'] as Array<Record<string, any>>) ?? []).filter(
      (entry) => entry['outcome'] === outcome,
    ).length
  const pause = payload['renewalsPause'] as Record<string, any> | undefined
  if (pause) {
    lines.push(
      pause['confirmed'] === true
        ? {
            text:
              `Paused ${count(pause, 'paused')} membership renewal(s) — nothing canceled or refunded, customers not told` +
              (count(pause, 'held') ? `; ${count(pause, 'held')} already held by another lock` : '') +
              (count(pause, 'already-paused')
                ? `; ${count(pause, 'already-paused')} already paused by the merchant, left alone`
                : ''),
            confirmed: true,
          }
        : {
            text: `Membership renewal pause NOT confirmed — the lock stands. ${problems(pause).join('; ')}`,
            confirmed: false,
          },
    )
  }
  const resume = payload['renewalsResume'] as Record<string, any> | undefined
  if (resume) {
    lines.push(
      resume['confirmed'] === true
        ? {
            text:
              `Resumed ${count(resume, 'resumed')} membership renewal(s) this lock paused` +
              (count(resume, 'still-held')
                ? `; ${count(resume, 'still-held')} still held by another lock`
                : ''),
            confirmed: true,
          }
        : {
            text: `Membership renewal resume NOT confirmed — some stay paused. ${problems(resume).join('; ')}`,
            confirmed: false,
          },
    )
  }
  const payouts = payload['payoutsPause'] as Record<string, any> | undefined
  if (payouts) {
    const account = payouts['accountId'] ?? 'no account'
    lines.push(
      payouts['outcome'] === 'not-controllable'
        ? {
            text: `Payouts for ${account}: not controllable (Standard account) — pause them in the Stripe Dashboard`,
            confirmed: false,
          }
        : payouts['confirmed'] === true
          ? {
              text:
                payouts['outcome'] === 'no-account'
                  ? 'Payouts: the seller has no connected account — nothing pays out'
                  : payouts['outcome'] === 'held'
                    ? `Payouts for ${account} already held manual by another lock`
                    : `Payouts for ${account} set to manual (was ${payouts['schedule']?.['interval'] ?? 'unknown'}; saved for the lift)`,
              confirmed: true,
            }
          : {
              text: `Payout pause for ${account} NOT confirmed — the lock stands. ${payouts['error'] ?? ''}`.trim(),
              confirmed: false,
            },
    )
  }
  const restore = payload['payoutsRestore'] as Record<string, any> | undefined
  if (restore) {
    const account = restore['accountId'] ?? 'the account'
    lines.push(
      restore['confirmed'] === true
        ? {
            text:
              restore['outcome'] === 'still-held'
                ? `Payouts for ${account} stay manual — another lock still holds them`
                : `Payouts for ${account} restored to ${restore['schedule']?.['interval'] ?? 'the saved schedule'}`,
            confirmed: true,
          }
        : {
            text: `Payout restore for ${account} NOT confirmed — payouts may still be manual. ${restore['error'] ?? ''}`.trim(),
            confirmed: false,
          },
    )
  }
  return lines
}

/**
 * The owners' email a lock or lift reported (AGL-3368), as a line of its own
 * with its own verified/NOT CONFIRMED chip — a lock can never skip its email
 * silently. Unticked "Email the owners" reads as a deliberate, verified
 * "not sent", never as silence.
 */
function ownerNoticeLine(
  notice: Record<string, any> | undefined,
  label: string,
): { text: string; confirmed: boolean } | null {
  if (!notice) return null
  const emailed = Number(notice['emailed'] ?? 0)
  const recipients = Number(notice['recipients'] ?? 0)
  const failed = Number(notice['emailFailed'] ?? 0)
  if (notice['error']) {
    return { text: `Owner email for ${label} FAILED — ${notice['error']}`, confirmed: false }
  }
  if (emailed === 0) {
    return {
      text: `Owner email for ${label} NOT sent — ${notice['skipped'] ?? 'nobody was emailed'}`,
      confirmed: notice['confirmed'] === true,
    }
  }
  return {
    text:
      `Emailed ${label}'s owners the ${String(notice['kind'] ?? 'lock')} notice — ${emailed} of ${recipients}` +
      (failed ? `, ${failed} FAILED` : ''),
    confirmed: notice['confirmed'] === true,
  }
}

/**
 * The billing steps a lock reported (AGL-3359), as log lines of their own.
 *
 * Separate lines, never folded into the lock's: a lock that landed and a
 * cancel that did not are two facts, and the log must show the first as
 * verified and the second as NOT CONFIRMED rather than blur them into one.
 */
function billingLogLines(
  payload: Record<string, any>,
): Array<{ text: string; confirmed: boolean }> {
  const cancelLine = (
    cancel: Record<string, any> | undefined,
    label: string,
  ): { text: string; confirmed: boolean } | null => {
    if (!cancel) return null
    const problems = [
      ...((cancel['lookupErrors'] as string[]) ?? []),
      ...((cancel['subscriptions'] as Array<Record<string, any>>) ?? [])
        .filter((step) => !step['confirmed'])
        .map((step) => `${step['id']}: ${step['error'] ?? step['outcome']}`),
    ]
    const found = ((cancel['subscriptions'] as unknown[]) ?? []).length
    return cancel['confirmed'] === true
      ? {
          text: found
            ? `Cancelled billing for ${label} — ${cancel['changed'] ?? 0} of ${found} subscription(s) changed, no refund`
            : `Billing for ${label}: nothing was billing`,
          confirmed: true,
        }
      : {
          text: `Billing cancel for ${label} NOT confirmed — the lock stands. ${problems.join('; ')}`,
          confirmed: false,
        }
  }
  const lines: Array<{ text: string; confirmed: boolean } | null> = []
  if (payload['subscriptionCancel']) {
    lines.push(
      cancelLine(
        payload['subscriptionCancel'],
        `workspace ${payload['subscriptionCancel']['orgId'] ?? ''}`.trim(),
      ),
    )
  }
  lines.push(...siteMoneyLogLines(payload))
  lines.push(
    ownerNoticeLine(
      payload['ownerNotice'],
      `${payload['ownerNotice']?.['scope'] ?? 'target'} ${payload['ownerNotice']?.['targetId'] ?? ''}`.trim(),
    ),
  )
  const owned = payload['ownedWorkspaces'] as Record<string, any> | undefined
  if (owned) {
    if (owned['error']) {
      lines.push({ text: String(owned['error']), confirmed: false })
    }
    const workspaces = (owned['workspaces'] as Array<Record<string, any>>) ?? []
    if (!owned['error'] && workspaces.length === 0) {
      lines.push({
        text: 'This account owns no workspaces — nothing else to lock or cancel',
        confirmed: true,
      })
    }
    for (const workspace of workspaces) {
      const label = `owned workspace ${workspace['slug'] ?? workspace['orgId']}`
      lines.push({
        text: workspace['lockError']
          ? `Locking ${label} failed: ${workspace['lockError']}`
          : workspace['alreadyLocked']
            ? `${label} was already locked — left as it was`
            : `Locked ${label}`,
        confirmed: workspace['confirmed'] === true,
      })
      lines.push(cancelLine(workspace['subscriptionCancel'], label))
      lines.push(ownerNoticeLine(workspace['ownerNotice'], label))
    }
    if (owned['truncated']) {
      lines.push({
        text: 'This account owns more workspaces than one lock handles — lock the rest by org id',
        confirmed: false,
      })
    }
  }
  return lines.filter(Boolean) as Array<{ text: string; confirmed: boolean }>
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
  // AGL-2131. Every lock and lift on this page POSTs to /api/admin/lockdown,
  // which is super-only; GET (Check state) is open to all staff and stays
  // enabled. `blocked` is false while the claim resolves, so no control
  // flickers disabled for the super staff who use this page under pressure.
  const { blocked: notSuper } = useSuperStaffGate()
  /** Server clock at the last successful state load — shown, never assumed. */
  const [readAtMs, setReadAtMs] = useState<number | null>(null)
  /**
   * Has the state ever loaded? (AGL-1531)
   *
   * The feature checklist read `records.find(...)` directly, and `records`
   * starts empty — so for the whole first paint, and forever after a failed
   * load, every capability rendered a green "on". That is the loading-default
   * trap on the panic page itself: an UNRESOLVED lock state must never read
   * as unlocked, least of all to the operator deciding whether the lever they
   * just pulled took.
   */
  const loaded = readAtMs !== null
  /** Creation-level valve status, from Identity Platform (AGL-1531). */
  const [signupsTrigger, setSignupsTrigger] =
    useState<SignupsCreationTrigger | null>(null)
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
  /**
   * Stop the workspace's billing too (AGL-3359). Follows the reason: on for
   * `security`, off for everything else — a billing, maintenance or manual
   * lock must never end a subscription unless someone ticks the box.
   * Changing the reason resets it to that default.
   */
  const [cancelBilling, setCancelBilling] = useState(
    lockdownCancelsBillingByDefault('manual'),
  )
  /** User scope: lock and cancel the workspaces the account owns. */
  const [lockOwned, setLockOwned] = useState(
    lockdownCancelsBillingByDefault('manual'),
  )
  /**
   * Org and host locks: pause the membership renewals the sites sell, and
   * the seller's payouts (AGL-3364). Same default rule as the cancel: on for
   * `security`, off for everything else, reset when the reason changes.
   */
  const [pauseRenewals, setPauseRenewals] = useState(
    lockdownPausesSiteMoneyByDefault('manual'),
  )
  const [pausePayouts, setPausePayouts] = useState(
    lockdownPausesSiteMoneyByDefault('manual'),
  )
  /**
   * Email the owners (AGL-3368). On for EVERY reason, and reset to on when
   * the reason changes: the one case for unticking it is a legal hold, and
   * that is a decision somebody makes, never a default.
   */
  const [emailOwners, setEmailOwners] = useState(true)
  /**
   * Resend owner notice (AGL-3368): standing locks to announce, one
   * `scope:targetId` per line, and whether to send a (lock, person) pair
   * that already went out.
   */
  const [resendTargets, setResendTargets] = useState('')
  const [resendAgain, setResendAgain] = useState(false)
  const changeReason = (next: string) => {
    setReason(next)
    setEmailOwners(true)
    setCancelBilling(lockdownCancelsBillingByDefault(next))
    setLockOwned(lockdownCancelsBillingByDefault(next))
    setPauseRenewals(lockdownPausesSiteMoneyByDefault(next))
    setPausePayouts(lockdownPausesSiteMoneyByDefault(next))
  }
  const [message, setMessage] = useState('')
  const [until, setUntil] = useState('')
  // AGL-1621. Defaults to the fail-OPEN class for the same reason the
  // route does: an operator who does not make a choice must get the
  // availability-preserving one.
  const [enforcement, setEnforcement] = useState('standard')
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
    try {
      const response = await authorizedFetch(user, '/api/admin/lockdown')
      if (!response.ok) throw new Error(`Load failed (${response.status})`)
      const payload = await response.json()
      setRecords(payload.records ?? [])
      setSignupsTrigger(payload.signupsCreationTrigger ?? null)
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
    if (!targetId.trim()) return
    setBusy(true)
    try {
      const response = await authorizedFetch(
        user,
        `/api/admin/lockdown?scope=${encodeURIComponent(scope)}&targetId=${encodeURIComponent(targetId.trim())}`,
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
    const params = new URLSearchParams({ verdict: '1' })
    if (verdictUid.trim()) params.set('uid', verdictUid.trim())
    if (verdictOrgId.trim()) params.set('orgId', verdictOrgId.trim())
    if (verdictHostId.trim()) params.set('hostId', verdictHostId.trim())
    setBusy(true)
    try {
      const response = await authorizedFetch(
        user,
        `/api/admin/lockdown?${params.toString()}`,
      )
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

  /**
   * Pre-filled from a risk notice's Lock action (AGL-3368):
   * `?scope=org|host|domain|user&targetId=…`. It only fills the form; the
   * lock still waits for someone to read the target and press Lock.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const linkedScope = params.get('scope')
    const linkedTarget = params.get('targetId')
    if (linkedScope && ['org', 'host', 'domain', 'user'].includes(linkedScope)) {
      setScope(linkedScope)
    }
    if (linkedTarget) setTargetId(linkedTarget)
  }, [])

  const act = useCallback(
    async (
      body: Record<string, unknown>,
      done: (payload: Record<string, any>) => void,
    ) => {
      setBusy(true)
      try {
        const response = await authorizedFetch(user, '/api/admin/lockdown', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
        // The billing steps (AGL-3359) land as lines of their own, above the
        // lock they followed, each with its own verified/NOT CONFIRMED chip.
        const billing = billingLogLines(payload)
        const atMs = Date.now()
        setLog((entries) =>
          [
            ...billing.map((line) => ({ atMs, ...line })).reverse(),
            { atMs, text: what, confirmed },
            ...entries,
          ].slice(0, 25),
        )
        if (billing.some((line) => !line.confirmed)) {
          enqueueSnackbar(
            'The lock is in place, but a billing or owner-email step did NOT confirm — read "Actions taken in this session".',
            { variant: 'error', allowDuplicate: true },
          )
        }
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

  /**
   * Announce standing locks to the people they locked (AGL-3368): one email
   * per person listing every lock of theirs, each outcome its own line.
   */
  const resendNotices = useCallback(async () => {
    const targets = resendTargets
      .split(/\n|,/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const at = line.indexOf(':')
        return at > 0
          ? { scope: line.slice(0, at).trim(), targetId: line.slice(at + 1).trim() }
          : { scope: scope, targetId: line }
      })
    if (!targets.length) return
    setBusy(true)
    try {
      const response = await authorizedFetch(user, '/api/admin/lockdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resend-notice', targets, sendAgain: resendAgain }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? `Failed (${response.status})`)
      const atMs = Date.now()
      const lines: Array<{ text: string; confirmed: boolean }> = [
        ...((payload.targets as Array<Record<string, any>>) ?? [])
          .filter((target) => target['error'])
          .map((target) => ({
            text: `Resend for ${target['scope']} ${target['targetId']}: ${target['error']}`,
            confirmed: false,
          })),
        ...((payload.recipients as Array<Record<string, any>>) ?? []).map((recipient) => ({
          text:
            recipient['outcome'] === 'sent'
              ? `Owner notice sent to ${recipient['email']} for ${(recipient['sentLockKeys'] as string[]).length} lock(s)`
              : recipient['outcome'] === 'already-sent'
                ? `Owner notice for ${recipient['email']} already sent at ${new Date(
                    Number(recipient['alreadySentAtMs'] ?? 0),
                  ).toLocaleString()} — tick "Send again" to resend`
                : `Owner notice to ${recipient['email']} FAILED — ${recipient['error'] ?? 'unknown'}`,
          confirmed: recipient['outcome'] !== 'failed',
        })),
      ]
      setLog((entries) =>
        [...lines.map((line) => ({ atMs, ...line })).reverse(), ...entries].slice(0, 25),
      )
      enqueueSnackbar(
        payload.confirmed
          ? 'Owner notices resent — read "Actions taken in this session"'
          : 'Some owner notices did NOT confirm — read "Actions taken in this session"',
        { variant: payload.confirmed ? 'success' : 'error', allowDuplicate: true },
      )
    } catch (error: any) {
      enqueueSnackbar(error?.message ?? 'Resending the owner notices failed', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }, [resendTargets, resendAgain, scope, user, enqueueSnackbar])

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

  /**
   * AGL-1621 — the fail-open/fail-closed choice, made VISIBLE and
   * DELIBERATE. An operator issuing a takedown has to know they are issuing
   * one: this is the only control on the page whose effect shows up during
   * an unrelated incident, weeks later, when Firestore is unreachable and
   * this lock is the one that keeps holding.
   *
   * The labels say what HAPPENS rather than naming the class, because
   * "takedown" alone does not tell an operator that picking it changes
   * behaviour during a database outage — and that is the entire difference
   * between the two options.
   */
  const enforcementField = (value: string, onChange: (next: string) => void) => (
    <TextField
      select
      size="small"
      label={`If ${PLATFORM_BRAND_NAME} can't reach the database`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      sx={{ minWidth: 250 }}
      slotProps={{ select: { native: true } }}
      color={value === 'takedown' ? 'error' : undefined}
      focused={value === 'takedown' ? true : undefined}
      helperText={
        value === 'takedown'
          ? 'Keeps holding through an outage. Legal/abuse orders only.'
          : 'Releases during an outage (default)'
      }
    >
      <option value="standard">{'Release — standard lock'}</option>
      <option value="takedown">{'Keep holding — takedown'}</option>
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
            <SuperStaffOnlyNotice what="Locking and lifting" />
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
                    disabled={busy || notSuper}
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
                      disabled={
                        busy || notSuper || platformConfirm !== PLATFORM_CONFIRM_PHRASE
                      }
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
                    'Kill one capability platform-wide while everything else keeps serving — signups off during a bot wave, uploads off on a malware report, checkout off over a billing bug. A platform lock implies every feature; a feature lock touches nothing else. No type-to-confirm: one named capability is the narrow lever, and it confirms like an org or site lock. Staff bypass: uploads, installs and AI assist stay usable to staff for verification; checkout does not (a staff checkout is still a real charge); signups is decided by account age, not claims. Signups also refuses account CREATION itself, through a Firebase Auth blocking function — which lives outside this repo, so the line under the row says whether it is actually registered.'
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
                  {listLockdownFeatureKeys().map((feature) => {
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
                          label={
                            !loaded ? 'checking…' : record ? 'LOCKED' : 'on'
                          }
                          color={
                            !loaded ? 'default' : record ? 'error' : 'success'
                          }
                          size="small"
                        />
                        <Typography variant="body2" sx={{ minWidth: 220 }}>
                          {lockdownFeatureLabel(feature)}
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
                            {/* Who pulled it (AGL-1531). The uid was already
                                on the wire and in this type, and was the one
                                thing the page never showed — so "who turned
                                signups off?" was a question only the audit
                                log could answer, at the moment nobody has
                                time to go and read it. */}
                            {`${record.reason ?? 'manual'}${
                              record.untilMs
                                ? ` — until ${new Date(record.untilMs).toLocaleString()}`
                                : ''
                            }${record.actorUid ? ` — set by ${record.actorUid}` : ''}`}
                          </Typography>
                        ) : null}
                        {record ? (
                          <Button
                            size="small"
                            variant="outlined"
                            color="success"
                            disabled={busy || notSuper || !loaded}
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
                            disabled={busy || notSuper || !loaded}
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
                        {feature === 'signups' ? (
                          <Typography
                            variant="caption"
                            sx={{ width: '100%' }}
                            color={
                              signupsTrigger?.status === 'armed'
                                ? 'success.main'
                                : signupsTrigger?.status === 'absent'
                                  ? 'warning.main'
                                  : 'text.secondary'
                            }
                          >
                            {creationValveLine(signupsTrigger)}
                          </Typography>
                        ) : null}
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
                      const next = event.target.value
                      setScope(next)
                      // A stale `read-only` left over from another scope
                      // would hide the ENFORCEMENT control too (it hides
                      // whenever the mode is read-only) and quietly force
                      // `standard` on a lock the operator may have meant as a
                      // takedown. Snap back to the shipped default instead.
                      if (!READ_ONLY_SCOPES.has(next)) setMode('full')
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
                    {/* AGL-1513. Deliberately listed AFTER the site scope so
                        the wider lever reads first: a domain lock leaves the
                        site serving on its platform subdomain, and an
                        operator reaching for a takedown wants `host`. */}
                    <MenuItem value="domain">{'Custom domain'}</MenuItem>
                    <MenuItem value="user">{'Account (user)'}</MenuItem>
                  </TextField>
                  <TextField
                    size="small"
                    label={
                      scope === 'org'
                        ? 'Org id'
                        : scope === 'host'
                          ? 'Host id'
                          : scope === 'domain'
                            ? 'Domain (e.g. acme.com)'
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
                      and token revoke, which have no milder setting — and on
                      the domain scope (AGL-1621) — a domain lock stops
                      serving ONE NAME, and read-only is defined as continuing
                      to serve it, so nothing anywhere would refuse. Both
                      hide the control rather than offering a choice the route
                      will reject.

                      Hiding it here is half the fix: this card used to offer
                      read-only for `domain`, send it, and get a 200 back for
                      a full takedown, because the route dropped the field on
                      the floor. The route refuses it now; this stops the
                      operator being walked into the refusal. */}
                  {READ_ONLY_SCOPES.has(scope) ? modeField(mode, setMode) : null}
                  {/* Hidden — not merely disabled — while the lock is
                      read-only, because the route refuses that combination
                      outright (a read-only takedown would keep serving the
                      very content it was issued over). Same posture as the
                      mode control on the user scope: do not offer a choice
                      that will be rejected. */}
                  {mode !== 'read-only'
                    ? enforcementField(enforcement, setEnforcement)
                    : null}
                  {reasonField(reason, changeReason)}
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
                {/* Billing (AGL-3359). A lock never touched Stripe, so a
                    locked fraudster's subscription kept renewing on a card
                    that was probably stolen. These run AFTER the lock lands
                    and report on their own line; a failed cancel never
                    undoes the lock. */}
                {scope === 'org' ? (
                  <Stack spacing={0.5}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          size="small"
                          checked={cancelBilling}
                          onChange={(event) =>
                            setCancelBilling(event.target.checked)
                          }
                        />
                      }
                      label="Also cancel its subscription now (no refund)"
                    />
                    <Typography variant="caption" color="text.secondary">
                      {
                        'On by default for security locks only. Cancels every subscription the workspace has in Stripe, immediately, with no final invoice, no proration and no refund. Unlocking never recreates a subscription — the customer would have to subscribe again.'
                      }
                    </Typography>
                  </Stack>
                ) : null}
                {/* The sites' money (AGL-3364): after the lock lands, each on
                    its own line, and a failed pause never undoes the lock.
                    Unlocking restores exactly what this lock paused. */}
                {scope === 'org' || scope === 'host' ? (
                  <Stack spacing={0.5}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          size="small"
                          checked={pauseRenewals}
                          onChange={(event) =>
                            setPauseRenewals(event.target.checked)
                          }
                        />
                      }
                      label="Also pause the membership renewals it sells"
                    />
                    <FormControlLabel
                      control={
                        <Checkbox
                          size="small"
                          checked={pausePayouts}
                          onChange={(event) => setPausePayouts(event.target.checked)}
                        />
                      }
                      label="Also pause the seller's payouts"
                    />
                    <Typography variant="caption" color="text.secondary">
                      {
                        'On by default for security locks only. Renewals: every live subscription the site sells stops collecting (invoices are voided); nothing is canceled or refunded and customers are not told. Payouts: the owner’s connected account moves to manual payouts, which also holds payouts for any other workspace that owner runs. Unlocking resumes exactly the renewals this lock paused and restores the saved payout schedule. A Standard account cannot be paused from here; the result says so.'
                      }
                    </Typography>
                  </Stack>
                ) : null}
                {/* The owners' email (AGL-3368): every lock and lift tells
                    the people it locked, from the platform's own sender,
                    with the message above. Reported on its own line. */}
                <Stack spacing={0.5}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        size="small"
                        checked={emailOwners}
                        onChange={(event) => setEmailOwners(event.target.checked)}
                      />
                    }
                    label="Email the owners"
                  />
                  <Typography variant="caption" color="text.secondary">
                    {
                      'On for every reason. Emails the workspace’s owners and admins (a site or domain lock: its workspace’s, and the site’s managers; an account lock: the person, at their sign-in address) from the platform’s own sender — it arrives even though the lock stops the workspace sending. It carries the message above, what the lock affects, and how to appeal; never why. Untick it only for a legal hold. Unlock sends the “restored” notice the same way.'
                    }
                  </Typography>
                </Stack>
                {scope === 'user' ? (
                  <Stack spacing={0.5}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          size="small"
                          checked={lockOwned}
                          onChange={(event) => setLockOwned(event.target.checked)}
                        />
                      }
                      label="Also lock and cancel workspaces this user solely owns"
                    />
                    <Typography variant="caption" color="text.secondary">
                      {
                        'On by default for security locks only. Every workspace this account owns (the owner seat is single; workspaces they only belong to are untouched) is locked with the same reason and its subscriptions cancelled now, no refund. Unlocking the account does not unlock those workspaces and never recreates a subscription.'
                      }
                    </Typography>
                  </Stack>
                ) : null}
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="contained"
                    color="error"
                    disabled={busy || notSuper || !targetId.trim()}
                    onClick={() =>
                      void act(
                        {
                          action: 'lock',
                          scope,
                          targetId: targetId.trim(),
                          mode: READ_ONLY_SCOPES.has(scope) ? mode : 'full',
                          // Sent explicitly on every lock, including the
                          // default: the route would infer `standard` from
                          // an absent field anyway, but stating it keeps
                          // the request a full description of the intent
                          // rather than one that relies on a default two
                          // layers away.
                          enforcement: mode === 'read-only' ? 'standard' : enforcement,
                          reason,
                          message: message || undefined,
                          untilMs: untilMsOf(until),
                          // Sent only on the scope that has it, and only as
                          // an explicit boolean: the route never infers a
                          // cancellation from a reason.
                          ...(scope === 'org'
                            ? { cancelSubscription: cancelBilling }
                            : {}),
                          ...(scope === 'user'
                            ? { lockOwnedWorkspaces: lockOwned }
                            : {}),
                          ...(scope === 'org' || scope === 'host'
                            ? { pauseRenewals, pausePayouts }
                            : {}),
                          // Explicit on every lock, like the billing flags.
                          emailOwners,
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
                    disabled={busy || notSuper || !targetId.trim()}
                    onClick={() =>
                      void act(
                        {
                          action: 'unlock',
                          scope,
                          targetId: targetId.trim(),
                          emailOwners,
                        },
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
                        {/* AGL-1621: a takedown is called out on its own
                            rather than folded into the line below, because
                            it is the one property of a lock that changes
                            what happens during an UNRELATED incident. An
                            operator checking state weeks later needs to see
                            it without reading for it. */}
                        {scopedState.locked &&
                        scopedState.enforcement === 'takedown' ? (
                          <Chip
                            label="TAKEDOWN — holds through an outage"
                            color="error"
                            variant="outlined"
                            size="small"
                          />
                        ) : null}
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
              header={'Resend owner notice'}
              help={docsHelp('lockdown', { anchor: '#owner-notices' })}
              HeaderProps={{
                action: (
                  <Stack direction="row" spacing={1}>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={busy || !targetId.trim()}
                      onClick={() =>
                        setResendTargets((current) =>
                          [current.trim(), `${scope}:${targetId.trim()}`].filter(Boolean).join('\n'),
                        )
                      }
                    >
                      {'Add the target above'}
                    </Button>
                    <Button
                      size="small"
                      variant="contained"
                      disabled={busy || notSuper || !resendTargets.trim()}
                      onClick={() => void resendNotices()}
                    >
                      {'Resend owner notice'}
                    </Button>
                  </Stack>
                ),
              }}
              contentGutterX
              contentGutterY
            >
              <Stack spacing={1.5}>
                <Typography variant="body2" color="text.secondary">
                  {
                    'For locks that already stand — placed before owner notices existed, or whose email failed. Sends the lock email the lock would have sent, with its stored message. Each person gets ONE email listing everything locked for them. A person already told about a lock is reported, not emailed again, unless you tick Send again.'
                  }
                </Typography>
                <TextField
                  label="Locks to announce"
                  placeholder={'org:ORG_ID\nhost:HOST_ID\ndomain:shop.example.com\nuser:UID'}
                  helperText="One scope:id per line (org, host, domain or user)."
                  multiline
                  minRows={3}
                  size="small"
                  value={resendTargets}
                  onChange={(event) => setResendTargets(event.target.value)}
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={resendAgain}
                      onChange={(event) => setResendAgain(event.target.checked)}
                    />
                  }
                  label="Send again to people already told"
                />
              </Stack>
            </CardDisplay>

            <CardDisplay
              header={'Actions taken in this session'}
              help={docsHelp('lockdown', {
                excerpt:
                  'What you changed since this page loaded, so a session of edits can ' +
                  'be read back before you leave it.',
              })}
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
              help={docsHelp('lockdown', {
                excerpt:
                  'Every lock currently in force, at every scope. This is the list to ' +
                  'check before asking why a customer is refused.',
              })}
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
                        }${record.atMs ? ` — since ${new Date(record.atMs).toLocaleString()}` : ''}${
                          record.actorUid ? ` — set by ${record.actorUid}` : ''
                        }`}
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
