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

/**
 * WHAT STAFF MAY OVERRIDE ON ONE ORGANIZATION, as data (moved out of
 * `staff-org-actions.component.tsx` so the native staff screens' generator can
 * read the same lists the override dialog renders).
 *
 * Pure: no React, no fetch, no Firestore.
 */

import { PLAN_ENTITLEMENTS } from '../plan-entitlements'
import { RELEASE_FLAGS } from '../release-flags'
import { pluginPlanQuotas } from '../../plugin-manager/plugin-plan-entitlements'

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
 * and anything absent from this map falls back to the label the owning
 * plugin declares, then to a humanized key, rather than dropping out. A key
 * a plugin owns has no row here: its plan declaration labels it.
 */
export const QUOTA_LABELS: Readonly<Record<string, string>> = {
  hostLimit: 'Sites',
  screensPerHost: 'Pages / site',
  sharedLayoutsPerHost: 'Layouts / site',
  storagePerHostMb: 'Storage MB',
  membersPerHost: 'Members / site',
  managersPerOrg: 'Team seats',
  maxManagersPerOrg: 'Max team seats',
  maxMembersPerHost: 'Max member seats',
  bandwidthGb: 'Bandwidth GB',
  // The catalog, not the traffic: the submissions a month are the forms
  // plugin's key, and its plan declaration labels them.
  formsPerHost: 'Saved forms / site',
  componentsPerHost: 'Reusable components / site',
  variablesPerHost: 'Variables',
  functionsPerHost: 'Functions',
  workflowsPerHost: 'Workflows',
  servicesPerHost: 'Booking services',
  redirectsPerHost: 'Redirects',
  // Contacts + companies + deals (AGL-2611); the key keeps its persisted name.
  contactsPerHost: 'CRM records',
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
}

/**
 * A key a plugin owns, in the plugin's own words: the label its plan
 * declaration gives a staff page (AGL-3080).
 */
const pluginQuotaLabel = (key: string): string | undefined =>
  pluginPlanQuotas().find((quota) => quota.key === key)?.label

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
    .map(([key]) => ({
      key,
      label: QUOTA_LABELS[key] ?? pluginQuotaLabel(key) ?? humanizeKey(key),
    }))

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
