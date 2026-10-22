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
 * THE FILING CONFIGURATION'S TWO LAYERS, read.
 *
 * SERVER-ONLY. This module reads `process.env` and Firestore; the precedence
 * rule it feeds is pure and lives in `utils/tax-filing-config.ts`, which is
 * where it can be asserted without either.
 *
 * ## Why the identifiers may live in Firestore but never in git
 *
 * `tools/scripts/check-no-tax-identifiers.mjs` guards the PUBLISHED
 * repository: a registration or filing id in tracked source is published to
 * everyone who clones it, which is how one was published the first time. A
 * Firestore document in the operator's own project is the opposite — it is
 * their data, in their database, behind a deny-all rule that admits no client
 * at all. Storing them here is the point of the control; writing one into a
 * spec fixture would still be the leak.
 *
 * ## Why the document is deny-all rather than staff-readable
 *
 * `platformSettings/taxFiling` holds a filing credential, and a rule that let
 * a staff browser read it would put that credential in any session holding a
 * staff token — reachable without the audited route and without the masking.
 * Every read goes through the Admin SDK behind the staff gate, and only the
 * return itself is ever handed the whole value.
 */

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  DEFAULT_FIRST_TAXABLE_PERIOD,
  cleanTaxConfigValue,
  resolveTaxFilingConfig,
  type ResolvedTaxFilingConfig,
  type TaxFilingConfigLayer,
} from '../tax-filing-config'
import {
  TAX_FILING_ID_ENV,
  TAX_JURISDICTION_ENV,
  TAX_REGISTRATION_ID_ENV,
  taxFilingJurisdiction,
} from '../tax-jurisdictions'

/** Platform-wide settings nobody's browser may read. One doc per subject. */
export const PLATFORM_SETTINGS_COLLECTION = 'platformSettings'

/** The filing configuration's document id. */
export const TAX_FILING_CONFIG_DOC = 'taxFiling'

/** The stored document's shape. */
export interface StoredTaxFilingConfig extends TaxFilingConfigLayer {
  updatedAtMs?: number | null
  updatedByEmail?: string | null
  note?: string | null
}

/**
 * The environment layer.
 *
 * `env` is injectable so the precedence rule can be exercised against a known
 * environment rather than the one the test runner happens to have.
 *
 * The deprecated Texas names are read through the jurisdiction the ENVIRONMENT
 * declares, not the one in force: they configure a live Texas registration,
 * and which authority they belong to is a fact about how they were set, not
 * about what the console has since been told.
 */
export function taxFilingConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): TaxFilingConfigLayer {
  const read = (name: string): string | null => cleanTaxConfigValue(env[name])
  const jurisdiction = read(TAX_JURISDICTION_ENV)
  const legacy = taxFilingJurisdiction(jurisdiction).legacyEnv
  return {
    jurisdiction,
    registrationId:
      read(TAX_REGISTRATION_ID_ENV) ??
      (legacy ? read(legacy.registrationId) : null),
    filingId: read(TAX_FILING_ID_ENV) ?? (legacy ? read(legacy.filingId) : null),
    // No environment name for the first taxable period. It is a console-only
    // setting: nothing reads it before the console can answer, so adding a
    // variable would add a second place to look for one answer.
    firstTaxablePeriod: null,
  }
}

/**
 * Config cache TTL. 15s, the same number and reasoning as the free-workspace
 * ceiling: an operator moves this rarely and a warm process converges within a
 * quarter of a minute.
 */
const CONFIG_TTL_MS = 15_000

let configCache: { at: number; stored: StoredTaxFilingConfig | null } | undefined
let configPending: Promise<StoredTaxFilingConfig | null> | undefined

/** Drop the in-process cache — called by the console after a write. */
export function invalidateTaxFilingConfigCache(): void {
  configCache = undefined
  configPending = undefined
}

/**
 * The console layer, or null when nobody has stored one.
 *
 * A read FAILURE also returns null, which hands the environment back. That is
 * the safe direction for this particular setting: the failure mode of falling
 * back is a return prepared under the bootstrap registration — visibly, since
 * the card and the return both name the source — while the failure mode of
 * inventing a value would be a return prepared under an authority nobody
 * chose.
 */
export async function readStoredTaxFilingConfig(options?: {
  firestore?: any
  now?: number
}): Promise<StoredTaxFilingConfig | null> {
  const now = options?.now ?? Date.now()
  if (!options?.firestore && configCache && now - configCache.at < CONFIG_TTL_MS) {
    return configCache.stored
  }
  const load = async (): Promise<StoredTaxFilingConfig | null> => {
    try {
      const firestore = options?.firestore ?? firebaseAdmin.app().firestore()
      const snapshot = await firestore
        .collection(PLATFORM_SETTINGS_COLLECTION)
        .doc(TAX_FILING_CONFIG_DOC)
        .get()
      if (!snapshot?.exists) return null
      return (snapshot.data() ?? null) as StoredTaxFilingConfig | null
    } catch (error) {
      console.error('[tax-filing-store] stored configuration unavailable', error)
      return null
    }
  }
  // An injected firestore is a test or a one-off read; never cached, so a spec
  // cannot poison the process cache for the next one.
  if (options?.firestore) return load()
  if (!configPending) {
    configPending = load()
      .then((stored) => {
        configCache = { at: now, stored }
        return stored
      })
      .finally(() => {
        configPending = undefined
      })
  }
  return configPending
}

/** Both layers, resolved. The one entry point every server surface uses. */
export async function resolveTaxFilingSettings(options?: {
  firestore?: any
  env?: NodeJS.ProcessEnv
  now?: number
}): Promise<ResolvedTaxFilingConfig> {
  const stored = await readStoredTaxFilingConfig({
    firestore: options?.firestore,
    now: options?.now,
  })
  return resolveTaxFilingConfig({
    stored,
    env: taxFilingConfigFromEnv(options?.env ?? process.env),
  })
}

/**
 * The document the console writes.
 *
 * Returned rather than written so the route owns the write and the
 * `adminAudit` row beside it, and so a spec can assert the SHAPE without a
 * Firestore. It is written with `merge: false` by the route: this record is
 * the whole configuration, and a merge would leave a previous authority's
 * identifier under a new jurisdiction — the exact pairing the resolver's
 * guard exists to prevent, reintroduced one layer down.
 */
export function taxFilingConfigWrite(input: {
  jurisdiction: string
  registrationId: string | null
  filingId: string | null
  firstTaxablePeriod?: string | null
  actorEmail?: string | null
  note?: string
  now?: number
}): StoredTaxFilingConfig {
  return {
    jurisdiction: input.jurisdiction,
    registrationId: input.registrationId,
    filingId: input.filingId,
    firstTaxablePeriod:
      cleanTaxConfigValue(input.firstTaxablePeriod) ?? DEFAULT_FIRST_TAXABLE_PERIOD,
    updatedAtMs: input.now ?? Date.now(),
    updatedByEmail: input.actorEmail ?? null,
    note: cleanTaxConfigValue(input.note) ?? null,
  }
}
