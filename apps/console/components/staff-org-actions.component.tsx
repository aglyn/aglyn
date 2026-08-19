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
  isLockdownReasonCode,
  LOCKDOWN_REASON_CODES,
  normalizeOrgOverrideReason,
  ORG_OVERRIDE_NOTE_MAX,
  ORG_OVERRIDE_REASON_CODES,
  ORG_OVERRIDE_REASON_LABELS,
  orgOverrideReasonNeedsNote,
  PLAN_ENTITLEMENTS,
  PLAN_LABELS,
  RELEASE_FLAGS,
  type OrgOverrideReasonCode,
  type OrgPlan,
} from '@aglyn/aglyn'
import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
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
import {
  collection,
  deleteField,
  doc,
  writeBatch,
} from 'firebase/firestore'
import { useCallback, useState } from 'react'
import {
  StaffRoleOnly,
  SuperStaffOnly,
} from './staff-super-only.component'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'

/**
 * Every plan staff can assign, derived from `PLAN_LABELS` so a new tier can
 * never go missing here (this list was stuck at Business — Scale, Advanced and
 * Agency shipped without it, and `enterprise` would have been the fourth).
 * Enterprise is included on purpose: it is the ONE plan with no self-serve
 * path, so a staff override is the only way an org gets onto it.
 */
export const PLAN_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'No plan (dark launch — everything on)' },
  ...(Object.keys(PLAN_LABELS) as OrgPlan[]).map((plan) => ({
    value: plan,
    label: PLAN_LABELS[plan],
  })),
]

/**
 * Wording for the numeric entitlements. Labels ONLY — never the list
 * itself (AGL-1635).
 *
 * The list used to live here as a hand-written array, and had drifted eight
 * keys behind the plan model: `templatesPerHost`, `apiRequestsPerMonth`,
 * `productsPerHost`, `inventoryLocations`, `posRegisters` and the three fee
 * percentages were unreachable from this dialog, so setting a negotiated
 * transaction fee meant hand-writing a Firestore document.
 *
 * That is exactly the AGL-549 bug, which was fixed for the feature booleans
 * by deriving them and never fixed here. `QUOTA_FIELDS` is now derived too,
 * and anything absent from this map falls back to a humanised key rather
 * than dropping out.
 */
const QUOTA_LABELS: Readonly<Record<string, string>> = {
  hostLimit: 'Sites',
  screensPerHost: 'Screens / site',
  sharedLayoutsPerHost: 'Layouts / site',
  storagePerHostMb: 'Storage MB',
  totalSiteSizeMb: 'Site size MB',
  membersPerHost: 'Members / site',
  managersPerOrg: 'Team seats',
  maxManagersPerOrg: 'Max team seats',
  maxMembersPerHost: 'Max member seats',
  bandwidthGb: 'Bandwidth GB',
  formSubmissionsPerMonth: 'Form subs / mo',
  variablesPerHost: 'Variables',
  functionsPerHost: 'Functions',
  workflowsPerHost: 'Workflows',
  workflowRunsPerMonth: 'Workflow runs / mo',
  servicesPerHost: 'Booking services',
  redirectsPerHost: 'Redirects',
  contactsPerHost: 'Contacts',
  // Campaign sends only (AGL-1438); transactional mail is uncapped.
  emailSendsPerMonth: 'Campaign email sends / mo',
  actionRunsPerMonth: 'Action runs / mo',
  datasetsPerOrg: 'Datasets (org)',
  maxDatasetsPerOrg: 'Max datasets (org)',
  recordsPerDataset: 'Records / dataset',
  dataStorageMbPerOrg: 'Data storage MB (org)',
  templatesPerHost: 'Templates / site',
  apiRequestsPerMonth: 'API requests / mo',
  productsPerHost: 'Products / site',
  inventoryLocations: 'Inventory locations',
  posRegisters: 'POS registers (base)',
  transactionFeePhysicalPct: 'Txn fee physical %',
  transactionFeeDigitalPct: 'Txn fee digital %',
  marketplaceFeePct: 'Marketplace fee %',
}

/** `maxDatasetsPerOrg` → `Max datasets per org`, for a key nobody labelled. */
const humanizeKey = (key: string): string => {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * Every numeric entitlement staff may override (AGL-201), derived from the
 * plan model so a new quota cannot silently drop out (AGL-1635).
 *
 * `free` is the source because every plan carries the same key set; the
 * resolver applies any numeric key found on `org.entitlements`, so the set
 * it accepts and the set shown here are now the same set by construction.
 */
export const QUOTA_FIELDS: Array<{ key: string; label: string }> =
  Object.entries(PLAN_ENTITLEMENTS.free)
    .filter(([, value]) => typeof value === 'number')
    .map(([key]) => ({ key, label: QUOTA_LABELS[key] ?? humanizeKey(key) }))

/** Every boolean feature flag, overridable as inherit / on / off. */
// Every feature key, derived from the plan model so new flags (the
// commerce wave added 9) can never silently drop out of the staff
// override dialog again (AGL-549).
export const FLAG_FIELDS: string[] = Object.keys(PLAN_ENTITLEMENTS.free.features)

/**
 * Per-org RELEASE-flag overrides (AGL-1635) — a THIRD family, and not the
 * same question as `FLAG_FIELDS`.
 *
 * A feature override asks whether the org's plan includes something that
 * exists. A release override asks whether an unreleased feature is switched
 * on for this one customer, and is the only way to grant one org early
 * access: the platform-wide flag is all-or-nothing, and its percentage
 * rollout picks its members by hash, not by choice.
 *
 * Derived from the registry, so a flag added later appears here without
 * anyone remembering to add it — the reason the admin bar
 * (`release_edit_bar`) was missing was that no such surface existed at all.
 */
export const RELEASE_FLAG_FIELDS: ReadonlyArray<{
  key: string
  label: string
  defaultEnabled: boolean
}> = RELEASE_FLAGS.map((definition) => ({
  key: definition.key,
  label: definition.label,
  defaultEnabled: definition.defaultEnabled,
}))

/** Count of explicit overrides on an org doc, for the row chip. */
export const overrideCount = (org: any): number =>
  Object.keys(org?.entitlements ?? {}).filter((key) => key !== 'features')
    .length +
  Object.keys(org?.entitlements?.features ?? {}).length +
  Object.keys(org?.releaseFlags ?? {}).length

/**
 * The staff org actions — plan/entitlement OVERRIDE, SUSPEND/unsuspend and
 * GDPR ERASURE request — extracted verbatim from the Organizations list page
 * (AGL-201/202/206) so the org DETAIL page can carry them too (AGL-939)
 * without staff bouncing back to the list to act.
 *
 * OVERRIDE IS A ROUTE (AGL-1786): `POST /api/admin/org-override`, which
 * validates the reason and commits the org document and its `adminAudit` row
 * with the Admin SDK in one batch. This component posts the operator's
 * INTENT — the plan, and only the quotas/features/release flags explicitly
 * forced — and never builds the Firestore payload: `deleteField()`, the
 * sentinel "inherit" needs (AGL-1109), has no JSON form, so a serialised one
 * would arrive as `{}` and quietly restore the very no-op that sentinel
 * exists to prevent. Absence is the inherit signal, and the route expands it
 * against the same registries rendered here — for the numeric quotas too
 * since AGL-1789, which is why an unreadable quota field refuses the save
 * rather than being skipped: skipping it now CLEARS the stored override.
 *
 * That move is what makes the REASON (AGL-1652) a boundary rather than a
 * dialog gate. `adminAudit` validates no shape at all
 * (`allow create: if isStaff()`), and policing one action's field in the
 * rules would imply the others are enforced when they are not — so before
 * this, a staff session driving Firestore directly could change a fee
 * percentage and write no row at all. `normalizeOrgOverrideReason` still
 * runs here so Save can be disabled with a reason the operator can act on;
 * the route runs the same predicate, and the route is the one that decides.
 *
 * ATOMICITY IS KEPT (AGL-1784), not given back: the two documents commit
 * together or neither lands, now in the route's `firestore.batch()`. What a
 * route cannot inherit is the client batch's other guarantee — a rejected
 * commit PROVED nothing was written, and a request that dies in the network
 * proves nothing at all. So the route stamps every response it produces with
 * `written`, and `handleSave` claims "unchanged" only on `written: false`;
 * a transport failure or a gateway error page is reported as UNKNOWN. That
 * distinction is the whole AGL-1784 lesson: the harm was never the failed
 * write, it was the retry a wrong "nothing happened" invited.
 *
 * ERASURE IS STILL A CLIENT BATCH (AGL-1784), deliberately: it writes one
 * boolean the rules already gate on super staff, it is visible on the page
 * and reversible, and the destructive step is a separate 7-day-hold job. It
 * is the last client writer of a staff key — see AGL-1786 for the decision
 * to leave it. Anything added to that handler belongs in the same batch: a
 * write appended after `commit()` reopens the gap it closed.
 *
 * Suspension is DIFFERENT (AGL-1505): it goes through the lockdown core —
 * `POST /api/admin/lockdown { scope: 'org' }` — never a direct Firestore
 * write, because an org suspension is four effects, not a flag: the org
 * doc's `suspendedAt` family, the `orgSuspended` member projection the
 * rules and API routes read, member refresh-token revocation (security/
 * manual reasons), and tenant ISR cache eviction. The route writes the
 * audit row and is super-staff-only server-side.
 *
 * Suspension and erasure sit behind their existing confirmation gates: a
 * reason dialog for suspend, and the two-step request → confirm dialog for
 * erasure, which
 * only flags `erasureRequestedAt` — the hard delete happens after a 7-day
 * hold, from the `/api/admin/run-erasures` cron or by hand with
 * tools/scripts/erase-tenant.mjs, both of which are `eraseOrg` (AGL-1481).
 */
export interface StaffOrgActionsProps {
  /** The org doc, with `$id`. Null/undefined disables every action. */
  org: any
  /** Called after a successful mutation so the owner can re-read the org. */
  onChanged: () => void
}

const StaffOrgActions = ({ org, onChanged }: StaffOrgActionsProps) => {
  const { data: user } = useUser()
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()

  const [editor, setEditor] = useState<{
    id: string
    plan: string
    quotas: Record<string, string>
    flags: Record<string, '' | 'on' | 'off'>
    releaseFlags: Record<string, '' | 'on' | 'off'>
    /**
     * WHY (AGL-1652). Starts EMPTY on every open, deliberately: a select
     * that opened on a valid default would be satisfied by not touching it,
     * and a reason nobody chose is the same empty record with a code on it.
     */
    reason: '' | OrgOverrideReasonCode
    /** Free-text rationale; required only for `other`. */
    note: string
  } | null>(null)
  /**
   * The ONE gate — the same predicate a server-side check would use, so the
   * disabled Save and the written row can never disagree about what counts
   * as a reason.
   */
  const overrideReason = editor
    ? normalizeOrgOverrideReason(editor.reason, editor.note)
    : null

  // Suspension (AGL-202, rewired by AGL-1505): reversible, but NOT a flag
  // write — the lockdown core behind /api/admin/lockdown does the org doc,
  // the `orgSuspended` member projection, token revocation and tenant cache
  // eviction together, and writes the audit row. This component must never
  // write suspension state to Firestore directly (the old path set the flag
  // and nothing else, so the projection-based blocks never engaged).
  const [suspender, setSuspender] = useState<{
    id: string
    suspended: boolean
    /** Lockdown reason CODE (security | billing | maintenance | manual). */
    reason: string
    /** Customer-facing notice, shown on the 503 page and to the owner. */
    message: string
  } | null>(null)
  const handleSuspendSave = useCallback(async () => {
    if (!suspender) return
    try {
      const suspending = !suspender.suspended
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/admin/lockdown', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          scope: 'org',
          targetId: suspender.id,
          action: suspending ? 'lock' : 'unlock',
          ...(suspending
            ? {
                reason: suspender.reason,
                ...(suspender.message.trim()
                  ? { message: suspender.message.trim() }
                  : {}),
              }
            : {}),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(
          payload?.error ?? `Lockdown failed (${response.status})`,
        )
      }
      enqueueSnackbar(
        suspending
          ? 'Organization suspended — sites offline now, member writes ' +
              'blocked' +
              (payload?.tokensRevoked
                ? `, ${payload.tokensRevoked} member session(s) revoked`
                : '') +
              ' (audited)'
          : 'Organization unsuspended — sites come back online (audited)',
        { variant: 'success', persist: false },
      )
      setSuspender(null)
      onChanged()
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [suspender, user, enqueueSnackbar, onChanged])

  // GDPR erasure request (AGL-206): sets/clears the flag only — the hard
  // delete is a deliberate, separately-run script after a 7-day hold.
  const handleToggleErasure = useCallback(async () => {
    if (!org) return
    const requesting = !org.erasureRequestedAt
    const confirmed = await confirm({
      title: requesting
        ? 'Request erasure for this organization?'
        : 'Cancel the erasure request?',
      description: requesting
        ? 'Marks the organization for GDPR deletion. Nothing is deleted ' +
          'now: after a 7-day hold the erasure runs automatically, or ' +
          'staff run tools/scripts/erase-tenant.mjs to hard-delete all ' +
          'data. No copy is kept — the hold is the window to export ' +
          'anything the customer still needs. Audited.'
        : 'The organization is no longer marked for deletion. Audited.',
      confirmationText: requesting ? 'Request erasure' : 'Cancel request',
      confirmationButtonProps: { color: requesting ? 'error' : 'primary' },
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    try {
      // ONE atomic commit (AGL-1784) — the flag and its audit row, or
      // neither. Sequential awaits meant a failure on the second left the
      // org flagged with nothing recording who flagged it, while the catch
      // below told the operator the write had failed.
      const batch = writeBatch(firestore)
      batch.set(
        doc(firestore, 'orgs', org.$id),
        {
          erasureRequestedAt: requesting ? Timestamp.now() : deleteField(),
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      )
      // `doc(collection(...))` is the client-side auto-id `addDoc` would have
      // generated; a batch needs the reference up front.
      batch.set(doc(collection(firestore, 'adminAudit')), {
        actorUid: (user as any)?.uid ?? 'unknown',
        action: requesting ? 'org.erasureRequested' : 'org.erasureCanceled',
        target: `orgs/${org.$id}`,
        before: { erasureRequested: !requesting },
        after: { erasureRequested: requesting },
        at: Timestamp.now(),
      })
      await batch.commit()
    } catch (error) {
      console.error(error)
      // Says what actually happened (AGL-1784). The batch is all-or-nothing
      // and this `try` holds NOTHING ELSE, so reaching here means the server
      // refused it and the organization is exactly as it was — which is what
      // makes a retry safe to suggest.
      enqueueSnackbar(
        'Nothing was written — the erasure flag and its audit row commit ' +
          'together, so the request is unchanged. Safe to retry.',
        { variant: 'error', allowDuplicate: true },
      )
      return
    }
    // Committed. Everything below is after the fact and deliberately OUTSIDE
    // the try: a token refresh or a parent re-read failing here would have
    // told the operator nothing was written, about a write that landed.
    //
    // Acknowledge to the owner at request time (AGL-768 follow-up). Fire-
    // and-forget: the request already succeeded, and the endpoint is
    // best-effort. The completion confirmation is sent later by run-erasures.
    if (requesting) {
      void (async () => {
        const idToken = await (user as any)?.getIdToken?.()
        await fetch('/api/admin/erasure-request', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ orgId: org.$id }),
        })
      })().catch(() => undefined)
    }
    enqueueSnackbar(
      requesting
        ? 'Erasure requested — deletable via script after 7 days (audited)'
        : 'Erasure request canceled (audited)',
      { variant: 'success', persist: false },
    )
    onChanged()
  }, [org, confirm, firestore, user, enqueueSnackbar, onChanged])

  const handleOverrideOpen = useCallback(() => {
    if (!org) return
    const quotas: Record<string, string> = {}
    for (const field of QUOTA_FIELDS) {
      const value = org.entitlements?.[field.key]
      if (typeof value === 'number') {
        quotas[field.key] = String(value)
      }
    }
    const flags: Record<string, '' | 'on' | 'off'> = {}
    for (const key of FLAG_FIELDS) {
      const value = org.entitlements?.features?.[key]
      if (value === true) flags[key] = 'on'
      if (value === false) flags[key] = 'off'
    }
    const releaseFlags: Record<string, '' | 'on' | 'off'> = {}
    for (const field of RELEASE_FLAG_FIELDS) {
      const value = org.releaseFlags?.[field.key]
      if (value === true) releaseFlags[field.key] = 'on'
      if (value === false) releaseFlags[field.key] = 'off'
    }
    setEditor({
      id: org.$id,
      plan: org.plan ?? '',
      quotas,
      flags,
      releaseFlags,
      // Never carried over from the previous override — the reason belongs
      // to THIS act, and a pre-filled one would be inherited, not given.
      reason: '',
      note: '',
      // No `before` snapshot is carried any more (AGL-1786): the route reads
      // it from the live document at write time. A snapshot taken when the
      // dialog opened is exactly the stale `before` AGL-1784 was about.
    })
  }, [org])

  const handleSave = useCallback(async () => {
    if (!editor) return
    // Checked here too, though the GATE now lives in the route (AGL-1786):
    // this saves a round trip and gives a message about the field the
    // operator is looking at. `/api/admin/org-override` refuses the same
    // request with the same predicate, so a caller that skips the dialog
    // gets the same answer.
    const reason = normalizeOrgOverrideReason(editor.reason, editor.note)
    if (!reason) {
      enqueueSnackbar(
        orgOverrideReasonNeedsNote(editor.reason as OrgOverrideReasonCode)
          ? 'Say what "other" means — the code alone records nothing.'
          : 'Pick a reason. Overrides change what a customer is billed ' +
              'against, and the audit row cannot be back-filled later.',
        { variant: 'warning', allowDuplicate: true },
      )
      return
    }
    const plan = editor.plan as OrgPlan | ''
    // WHAT THE WIRE CARRIES IS INTENT, NOT A FIRESTORE PAYLOAD (AGL-1786).
    //
    // "Inherit" has to DELETE the key rather than omit it (AGL-1109): the
    // org write is `{ merge: true }`, and a merge writes nested maps key by
    // key, so a `features` map that simply left out an inherited flag
    // changed nothing — the stored `true` survived and the override could
    // never be cleared. `deleteField()` is the sentinel a merge acts on, and
    // it HAS NO JSON FORM: posting it would arrive as `{}` and reinstate
    // exactly that no-op, silently.
    //
    // So only the EXPLICIT overrides go over the wire, and absence is the
    // inherit signal. The route expands it against the same registries this
    // dialog renders from and mints `FieldValue.delete()` on the side that
    // can hold one — for the numeric quotas as well as the two boolean
    // families since AGL-1789.
    //
    // AN EMPTY QUOTA FIELD IS A CLEARED OVERRIDE (AGL-1789), not a field to
    // skip: the route deletes every quota absent from this map. So a value
    // that cannot be read must NOT fall through to absence — dropping it
    // silently used to mean "nothing happens", and now it would mean
    // "remove the override the operator was in the middle of changing". It
    // refuses instead, naming the field. A typed `0` is a real cap of none
    // and goes over the wire as one.
    const quotas: Record<string, number> = {}
    for (const field of QUOTA_FIELDS) {
      const raw = (editor.quotas[field.key] ?? '').trim()
      if (raw === '') continue
      const value = Number(raw)
      if (!Number.isFinite(value) || value < 0) {
        enqueueSnackbar(
          `${field.label} has to be a number of 0 or more, or empty to ` +
            'inherit the plan default. Nothing was sent.',
          { variant: 'warning', allowDuplicate: true },
        )
        return
      }
      quotas[field.key] = value
    }
    const features: Record<string, boolean> = {}
    for (const key of FLAG_FIELDS) {
      const state = editor.flags[key] ?? ''
      if (state === 'on') features[key] = true
      else if (state === 'off') features[key] = false
    }
    // Release-flag overrides (AGL-1635) ride the same inherit/on/off
    // contract, and are super-staff-only — enforced by the route, which is
    // where the Firestore rules' own split now has to be restated.
    const releaseFlags: Record<string, boolean> = {}
    for (const field of RELEASE_FLAG_FIELDS) {
      const state = editor.releaseFlags[field.key] ?? ''
      if (state === 'on') releaseFlags[field.key] = true
      else if (state === 'off') releaseFlags[field.key] = false
    }

    // Refreshed BEFORE the request and outside its try, so a failed refresh
    // is reported as what it is: nothing left the browser.
    let idToken: string | undefined
    try {
      idToken = await (user as any)?.getIdToken?.()
    } catch (error) {
      console.error(error)
      enqueueSnackbar(
        'Could not refresh your staff session, so nothing was sent — the ' +
          'organization is unchanged. Safe to retry.',
        { variant: 'error', allowDuplicate: true },
      )
      return
    }

    // THE OVERRIDE IS A ROUTE (AGL-1786), like suspension (AGL-1505).
    //
    // It used to be a client `writeBatch` of the org doc plus its audit row
    // — atomic since AGL-1784, and that property is kept: the route commits
    // both documents in one Admin SDK batch. What the batch could not do is
    // make the reason a BOUNDARY. `adminAudit` validates no shape at all, so
    // the gate was the dialog, and a staff session driving Firestore
    // directly could change a fee percentage with no row at all. A batch
    // that is never issued is still atomic.
    //
    // WHAT THIS COSTS, stated plainly because AGL-1784 was about a message
    // that lied: a rejected client commit proved nothing was written. A
    // request that dies in the network does not. So the outcome is read from
    // an explicit `written` flag the route puts on every response it
    // produces, and anything else — a transport failure, a gateway error
    // page — is reported as UNKNOWN rather than as safe to retry, because a
    // blind retry is how the `before` on the eventual row stops describing
    // the state the change was made against.
    let response: Response
    try {
      response = await fetch('/api/admin/org-override', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          orgId: editor.id,
          plan: plan || null,
          quotas,
          features,
          releaseFlags,
          reason: reason.reason,
          note: reason.note,
        }),
      })
    } catch (error) {
      console.error(error)
      enqueueSnackbar(
        'The request did not complete, so it is NOT known whether the ' +
          'override was applied. Check the organization and /admin/audit ' +
          'before saving again — a blind retry would record a before-state ' +
          'that is already overridden.',
        { variant: 'error', allowDuplicate: true },
      )
      return
    }
    const payload: any = await response.json().catch(() => ({}))
    if (!response.ok) {
      // `written === false` is the route's own word, and the ONLY thing that
      // licenses "unchanged". A 502 from a gateway, an HTML error page or
      // anything else that never reached the handler carries no such field,
      // and is reported as unknown.
      enqueueSnackbar(
        payload?.written === false
          ? `Nothing was written — the organization is unchanged. Safe to ` +
              `retry. ${payload?.error ?? `The request was refused (${response.status}).`}`
          : 'The request failed and it is NOT known whether the override ' +
              'was applied. Check the organization and /admin/audit before ' +
              'saving again — a blind retry would record a before-state ' +
              'that is already overridden.',
        { variant: 'error', allowDuplicate: true },
      )
      return
    }
    // Applied — the dialog closes and the owner re-reads. Outside the branch
    // above on purpose: a parent re-read that threw must never be reported
    // as an override that never landed.
    enqueueSnackbar('Organization updated (audited)', {
      variant: 'success',
      persist: false,
    })
    setEditor(null)
    onChanged()
  }, [editor, user, enqueueSnackbar, onChanged])

  return (
    <>
      {/* AGL-2131. Gated at the TRIGGER, not at the dialog's confirm button:
          a support engineer who can open the override editor, pick a plan,
          write a reason and only then find Save dead has done the work twice
          for nothing. The role sets mirror the routes exactly —
          /api/admin/org-override admits billing for plan and quota writes
          (releaseFlags stay super-only and are refused there), while
          /api/admin/lockdown is super-only for every scope. */}
      <StaffRoleOnly roles={['super', 'billing']}>
        <Button size="small" disabled={!org} onClick={handleOverrideOpen}>
          {'Override'}
        </Button>
      </StaffRoleOnly>
      <SuperStaffOnly>
        <Button
          size="small"
          disabled={!org}
          color={org?.suspendedAt ? 'success' : 'error'}
          onClick={() =>
            org &&
            setSuspender({
              id: org.$id,
              suspended: Boolean(org.suspendedAt),
              reason: isLockdownReasonCode(org.suspendedReasonCode)
                ? org.suspendedReasonCode
                : 'manual',
              message: org.suspendedMessage ?? '',
            })
          }
        >
          {org?.suspendedAt ? 'Unsuspend' : 'Suspend'}
        </Button>
      </SuperStaffOnly>
      <Button
        size="small"
        disabled={!org}
        color={org?.erasureRequestedAt ? 'primary' : 'error'}
        onClick={() => void handleToggleErasure()}
      >
        {org?.erasureRequestedAt ? 'Cancel erasure' : 'Erasure'}
      </Button>
      <Dialog
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>{'Override organization'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
        >
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
            {editor?.id}
          </Typography>
          {/*
            WHY comes FIRST (AGL-1652), before the fields it explains. A
            reason asked after the change has been composed is a rubber
            stamp; asked before, it is the framing of the decision.
          */}
          <TextField
            select
            required
            size="small"
            label="Reason"
            value={editor?.reason ?? ''}
            error={Boolean(editor) && !editor?.reason}
            helperText={
              'Written to the audit row beside the before/after. The row is ' +
              'append-only — a reason not given now cannot be added later.'
            }
            onChange={(event) =>
              setEditor((prev) =>
                prev
                  ? { ...prev, reason: event.target.value as OrgOverrideReasonCode }
                  : prev,
              )
            }
          >
            {ORG_OVERRIDE_REASON_CODES.map((code) => (
              <MenuItem key={code} value={code}>
                {ORG_OVERRIDE_REASON_LABELS[code]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            multiline
            minRows={2}
            label={
              editor?.reason &&
              orgOverrideReasonNeedsNote(editor.reason as OrgOverrideReasonCode)
                ? 'Note (required for "other")'
                : 'Note (optional — the deal, ticket or thread)'
            }
            value={editor?.note ?? ''}
            error={
              Boolean(editor?.reason) &&
              orgOverrideReasonNeedsNote(
                editor?.reason as OrgOverrideReasonCode,
              ) &&
              !editor?.note.trim()
            }
            slotProps={{ htmlInput: { maxLength: ORG_OVERRIDE_NOTE_MAX } }}
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, note: event.target.value } : prev,
              )
            }
          />
          <TextField
            select
            size="small"
            label="Plan"
            value={editor?.plan ?? ''}
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, plan: event.target.value } : prev,
              )
            }
          >
            {PLAN_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          <Typography variant="subtitle2">{'Quota overrides'}</Typography>
          <Typography variant="caption" color="text.secondary">
            {'Empty = plan default: only filled fields persist as ' +
              'per-organization overrides, and emptying one REMOVES that ' +
              'override on save. 0 is an override too — a cap of none, not ' +
              'an inherit.'}
          </Typography>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
            {QUOTA_FIELDS.map((field) => {
              const plan = editor?.plan as OrgPlan | ''
              const fallback = plan
                ? (PLAN_ENTITLEMENTS[plan] as any)?.[field.key]
                : undefined
              return (
                <TextField
                  key={field.key}
                  size="small"
                  label={field.label}
                  type="number"
                  value={editor?.quotas[field.key] ?? ''}
                  placeholder={
                    fallback === undefined
                      ? ''
                      : Number.isFinite(fallback)
                        ? String(fallback)
                        : '∞'
                  }
                  onChange={(event) =>
                    setEditor((prev) =>
                      prev
                        ? {
                            ...prev,
                            quotas: {
                              ...prev.quotas,
                              [field.key]: event.target.value,
                            },
                          }
                        : prev,
                    )
                  }
                  sx={{ width: 168 }}
                />
              )
            })}
          </Stack>
          <Typography variant="subtitle2">{'Feature overrides'}</Typography>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
            {FLAG_FIELDS.map((key) => {
              const plan = editor?.plan as OrgPlan | ''
              const fallback = plan
                ? Boolean((PLAN_ENTITLEMENTS[plan]?.features as any)?.[key])
                : undefined
              return (
                <TextField
                  key={key}
                  select
                  size="small"
                  label={key}
                  value={editor?.flags[key] ?? ''}
                  onChange={(event) =>
                    setEditor((prev) =>
                      prev
                        ? {
                            ...prev,
                            flags: {
                              ...prev.flags,
                              [key]: event.target.value as any,
                            },
                          }
                        : prev,
                    )
                  }
                  sx={{ width: 168 }}
                >
                  <MenuItem value="">
                    {fallback === undefined
                      ? 'Inherit'
                      : `Inherit (${fallback ? 'on' : 'off'})`}
                  </MenuItem>
                  <MenuItem value="on">{'Force on'}</MenuItem>
                  <MenuItem value="off">{'Force off'}</MenuItem>
                </TextField>
              )
            })}
          </Stack>
          <Typography variant="subtitle2">
            {'Release flag overrides'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {'Early access to an UNRELEASED feature for this organization ' +
              'only — a different question from the plan features above. ' +
              'Inherit follows the platform flag and its rollout; forcing ' +
              'wins over both. Super staff only.'}
          </Typography>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
            {RELEASE_FLAG_FIELDS.map((field) => (
              <TextField
                key={field.key}
                select
                size="small"
                label={field.label}
                value={editor?.releaseFlags[field.key] ?? ''}
                onChange={(event) =>
                  setEditor((prev) =>
                    prev
                      ? {
                          ...prev,
                          releaseFlags: {
                            ...prev.releaseFlags,
                            [field.key]: event.target.value as any,
                          },
                        }
                      : prev,
                  )
                }
                sx={{ width: 168 }}
              >
                <MenuItem value="">
                  {/*
                    The registry default, NOT the live Remote Config value:
                    this dialog does not read the template, and a percentage
                    rollout has no single answer for one org anyway. Naming
                    it "default" rather than "on"/"off" keeps it from
                    reading as the current verdict.
                  */}
                  {`Inherit (default ${field.defaultEnabled ? 'on' : 'off'})`}
                </MenuItem>
                <MenuItem value="on">{'Force on'}</MenuItem>
                <MenuItem value="off">{'Force off'}</MenuItem>
              </TextField>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditor(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={!overrideReason}
            onClick={handleSave}
          >
            {'Save (audited)'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(suspender)}
        onClose={() => setSuspender(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {suspender?.suspended
            ? 'Unsuspend organization?'
            : 'Suspend organization?'}
        </DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {suspender?.suspended
              ? 'Their published sites come back online within a minute.'
              : 'Every published site of this organization returns 503 ' +
                'now, member writes are blocked, and members see a ' +
                'suspension notice. Security and manual suspensions also ' +
                'log the members out. No data is deleted; this is ' +
                'reversible. Audited.'}
          </Typography>
          {!suspender?.suspended ? (
            <>
              <TextField
                select
                size="small"
                label="Reason"
                value={suspender?.reason ?? 'manual'}
                onChange={(event) =>
                  setSuspender((previous) =>
                    previous
                      ? { ...previous, reason: event.target.value }
                      : previous,
                  )
                }
              >
                {LOCKDOWN_REASON_CODES.map((code) => (
                  <MenuItem key={code} value={code}>
                    {code}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                label="Notice (shown to the owner and visitors)"
                value={suspender?.message ?? ''}
                onChange={(event) =>
                  setSuspender((previous) =>
                    previous
                      ? { ...previous, message: event.target.value }
                      : previous,
                  )
                }
              />
            </>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSuspender(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color={suspender?.suspended ? 'success' : 'error'}
            onClick={handleSuspendSave}
          >
            {suspender?.suspended ? 'Unsuspend' : 'Suspend'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
StaffOrgActions.displayName = 'StaffOrgActions'

export default StaffOrgActions
