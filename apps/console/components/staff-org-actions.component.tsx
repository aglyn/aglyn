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
  PLAN_ENTITLEMENTS,
  PLAN_LABELS,
  RELEASE_FLAGS,
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
  addDoc,
  collection,
  deleteField,
  doc,
  setDoc,
} from 'firebase/firestore'
import { useCallback, useState } from 'react'
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
 * Override and erasure write the org doc through the scoped Firestore rules
 * (the server-side gate: super-staff for erasure keys, billing-staff for
 * plan and entitlements — a non-staff caller is denied by the rules, not by
 * this UI) and log an `adminAudit` entry with the actor uid.
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
    before: any
  } | null>(null)

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
      await setDoc(
        doc(firestore, 'orgs', org.$id),
        {
          erasureRequestedAt: requesting ? Timestamp.now() : deleteField(),
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      )
      await addDoc(collection(firestore, 'adminAudit'), {
        actorUid: (user as any)?.uid ?? 'unknown',
        action: requesting ? 'org.erasureRequested' : 'org.erasureCanceled',
        target: `orgs/${org.$id}`,
        before: { erasureRequested: !requesting },
        after: { erasureRequested: requesting },
        at: Timestamp.now(),
      })
      // Acknowledge to the owner at request time (AGL-768 follow-up). Fire-
      // and-forget: the request already succeeded, and the endpoint is
      // best-effort. The completion confirmation is sent later by
      // run-erasures.
      if (requesting) {
        const idToken = await (user as any)?.getIdToken?.()
        void fetch('/api/admin/erasure-request', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ orgId: org.$id }),
        }).catch(() => undefined)
      }
      enqueueSnackbar(
        requesting
          ? 'Erasure requested — deletable via script after 7 days (audited)'
          : 'Erasure request canceled (audited)',
        { variant: 'success', persist: false },
      )
      onChanged()
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
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
      before: {
        plan: org.plan ?? null,
        entitlements: org.entitlements ?? null,
        releaseFlags: org.releaseFlags ?? null,
      },
    })
  }, [org])

  const handleSave = useCallback(async () => {
    if (!editor) return
    const plan = editor.plan as OrgPlan | ''
    // Full override build (AGL-201): only explicit entries persist —
    // empty quota fields and 'inherit' flags fall back to plan defaults.
    const entitlements: Record<string, unknown> = {}
    for (const field of QUOTA_FIELDS) {
      const raw = (editor.quotas[field.key] ?? '').trim()
      if (raw === '') continue
      const value = Number(raw)
      if (Number.isFinite(value) && value >= 0) {
        entitlements[field.key] = value
      }
    }
    // "Inherit" has to DELETE the key, not omit it (AGL-1109).
    //
    // The write below is `{ merge: true }`, and a merge writes nested maps by
    // key rather than replacing them. So a `features` map that simply left out
    // an inherited flag changed nothing: the stored `true` survived, the org
    // kept the feature, and the override count stayed put. Only "Force off"
    // appeared to work, because writing an explicit `false` is a change a
    // merge can see. That made a clean revert impossible — you could turn an
    // override off, but never remove it.
    //
    // `deleteField()` is the sentinel a merge does act on.
    const features: Record<string, boolean | ReturnType<typeof deleteField>> = {}
    // Tracked separately from `features`, which now contains delete sentinels
    // and can therefore be non-empty while expressing no override at all.
    const explicitFeatures: Record<string, boolean> = {}
    for (const key of FLAG_FIELDS) {
      const state = editor.flags[key] ?? ''
      if (state === 'on') {
        features[key] = true
        explicitFeatures[key] = true
      } else if (state === 'off') {
        features[key] = false
        explicitFeatures[key] = false
      } else {
        features[key] = deleteField()
      }
    }
    // Whether anything is actually overridden — quotas, or a flag forced
    // either way. Deletes do not count, or clearing the last override would
    // leave an empty `entitlements` map behind instead of removing it.
    const hasOverrides =
      Object.keys(entitlements).length > 0 ||
      Object.keys(explicitFeatures).length > 0
    if (hasOverrides) entitlements['features'] = features
    // Release-flag overrides (AGL-1635) use the same inherit/on/off contract
    // and the same `deleteField()` sentinel as the features above, for the
    // same AGL-1109 reason: this write is `{ merge: true }`, so an inherited
    // flag that is merely omitted keeps whatever was stored. "Inherit" has
    // to DELETE.
    const releaseFlags: Record<
      string,
      boolean | ReturnType<typeof deleteField>
    > = {}
    const explicitReleaseFlags: Record<string, boolean> = {}
    for (const field of RELEASE_FLAG_FIELDS) {
      const state = editor.releaseFlags[field.key] ?? ''
      if (state === 'on') {
        releaseFlags[field.key] = true
        explicitReleaseFlags[field.key] = true
      } else if (state === 'off') {
        releaseFlags[field.key] = false
        explicitReleaseFlags[field.key] = false
      } else {
        releaseFlags[field.key] = deleteField()
      }
    }
    const hasReleaseOverrides = Object.keys(explicitReleaseFlags).length > 0
    const after = {
      plan: plan || null,
      // The audit row records the resulting STATE, never the sentinels — a
      // `deleteField()` does not serialise to anything a reader can act on.
      entitlements: hasOverrides
        ? { ...entitlements, features: explicitFeatures }
        : null,
      releaseFlags: hasReleaseOverrides ? explicitReleaseFlags : null,
    }
    try {
      await setDoc(
        doc(firestore, 'orgs', editor.id),
        {
          plan: plan || deleteField(),
          entitlements: hasOverrides ? entitlements : deleteField(),
          releaseFlags: hasReleaseOverrides ? releaseFlags : deleteField(),
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      )
      await addDoc(collection(firestore, 'adminAudit'), {
        actorUid: (user as any)?.uid ?? 'unknown',
        action: 'org.override',
        target: `orgs/${editor.id}`,
        before: editor.before ?? null,
        after,
        at: Timestamp.now(),
      })
      enqueueSnackbar('Organization updated (audited)', {
        variant: 'success',
        persist: false,
      })
      setEditor(null)
      onChanged()
    } catch (error) {
      console.error(error)
      enqueueSnackbar(
        'Write failed — are the scoped Firestore rules deployed and is ' +
          'your account staff?',
        { variant: 'error', allowDuplicate: true },
      )
    }
  }, [editor, firestore, user, enqueueSnackbar, onChanged])

  return (
    <>
      <Button size="small" disabled={!org} onClick={handleOverrideOpen}>
        {'Override'}
      </Button>
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
            {'Empty = plan default. Only filled fields persist as ' +
              'per-organization overrides.'}
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
          <Button variant="contained" color="primary" onClick={handleSave}>
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
