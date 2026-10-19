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

import {
  readSiteCareProject,
  siteCareProjectStatus,
  type SiteCareProject,
  type SiteCareProjectInvoiceStatus,
} from '@aglyn/aglyn/app-utils/site-care-project'
import { readOrgBilling } from './org-billing'
import {
  listProjectInvoices,
  readProjectInvoice,
  SITE_CARE_PROJECT_METADATA_KEY,
  type ProjectInvoiceState,
} from './site-care-project-stripe'
import { SITE_CARE_PROJECTS_COLLECTION } from './site-care-projects'
import type { SiteCareStripeOptions } from './site-care-stripe'

/**
 * SITE CARE PROJECTS IN THE DAILY RECONCILIATION (AGL-3970).
 *
 * The same scheduled check as extra time (`reconcileSiteCare` calls this):
 * each project invoice the record holds against the Stripe invoice it
 * names — status, and the amount before tax — and each Stripe invoice that
 * names a project against a record that holds it. Any difference is a
 * finding on `billing.siteCareReconciliation`. It compares and reports and
 * never changes either side: the fix is a person's, from the project.
 */

export type SiteCareProjectFindingCode =
  | 'project-invoice-stuck'
  | 'project-invoice-failed'
  | 'project-invoice-missing'
  | 'project-invoice-status'
  | 'project-invoice-amount'
  | 'project-invoice-without-row'
  | 'project-status'

export interface SiteCareProjectFinding {
  orgId: string
  projectId: string | null
  code: SiteCareProjectFindingCode
  detail: string
}

export interface ProjectRow {
  id: string
  project: SiteCareProject
  /** The status stored on the document, which every write recomputes. */
  storedStatus: string
}

/** The Stripe statuses a recorded invoice status may be in. */
const EXPECTED: Readonly<Partial<Record<SiteCareProjectInvoiceStatus, readonly string[]>>> = {
  open: ['open'],
  paid: ['paid'],
  voided: ['void'],
  // A fully credited open invoice is closed by Stripe as paid at nothing.
  credited: ['paid', 'void'],
  refunded: ['paid'],
}

/** Compares one workspace's projects with its Stripe invoices. Pure. */
export function compareSiteCareProjects(input: {
  orgId: string
  projects: readonly ProjectRow[]
  /** Every Stripe invoice the record names, plus any listed that name a project. */
  invoices: ReadonlyMap<string, ProjectInvoiceState | null>
  /** Listed invoices that name one of this workspace's projects. */
  listed: readonly ProjectInvoiceState[]
}): SiteCareProjectFinding[] {
  const findings: SiteCareProjectFinding[] = []
  const claimed = new Set<string>()
  for (const row of input.projects) {
    const { project } = row
    const at = { orgId: input.orgId, projectId: row.id }
    const derived = siteCareProjectStatus(project)
    if (row.storedStatus && row.storedStatus !== derived) {
      findings.push({ ...at, code: 'project-status', detail: `“${project.title}” is stored as ${row.storedStatus} but its record reads ${derived}.` })
    }
    for (const invoice of project.invoices) {
      if (invoice.invoiceId) claimed.add(invoice.invoiceId)
      const name = `“${project.title}” invoice ${invoice.seq} (${invoice.kind})`
      if (invoice.status === 'creating') {
        findings.push({ ...at, code: 'project-invoice-stuck', detail: `${name} was started and never recorded. Retry it from the project.` })
        continue
      }
      if (invoice.status === 'failed') {
        findings.push({ ...at, code: 'project-invoice-failed', detail: `${name} failed (${invoice.error ?? 'unknown'}). Retry it from the project.` })
        continue
      }
      if (!invoice.invoiceId) {
        findings.push({ ...at, code: 'project-invoice-missing', detail: `${name} is ${invoice.status} with no Stripe invoice.` })
        continue
      }
      const stripe = input.invoices.get(invoice.invoiceId) ?? null
      if (!stripe) {
        findings.push({ ...at, code: 'project-invoice-missing', detail: `${name}: Stripe invoice ${invoice.invoiceId} is gone.` })
        continue
      }
      const expected = EXPECTED[invoice.status] ?? []
      if (!expected.includes(stripe.status)) {
        findings.push({
          ...at,
          code: 'project-invoice-status',
          detail:
            invoice.status === 'open' && stripe.status === 'paid'
              ? `${name} is paid in Stripe but not recorded. Use Check payments on the project.`
              : `${name} is ${invoice.status} here and ${stripe.status} in Stripe (${invoice.invoiceId}).`,
        })
      }
      if (stripe.subtotalCents !== invoice.amountCents) {
        findings.push({
          ...at,
          code: 'project-invoice-amount',
          detail: `${name}: Stripe bills ${stripe.subtotalCents} cents before tax, the record ${invoice.amountCents}.`,
        })
      }
    }
  }
  for (const invoice of input.listed) {
    if (claimed.has(invoice.invoiceId)) continue
    if (invoice.status === 'void') continue
    findings.push({
      orgId: input.orgId,
      projectId: invoice.metadata[SITE_CARE_PROJECT_METADATA_KEY] ?? null,
      code: 'project-invoice-without-row',
      detail: `Stripe invoice ${invoice.invoiceId} (${invoice.status}, ${invoice.subtotalCents} cents) names project ${invoice.metadata[SITE_CARE_PROJECT_METADATA_KEY]}, which does not record it.`,
    })
  }
  return findings
}

export interface SiteCareProjectReconcileResult {
  projects: number
  findings: SiteCareProjectFinding[]
  errors: string[]
}

/** How far back a settled project is still compared. */
const SETTLED_WINDOW_MS = 70 * 24 * 60 * 60 * 1000

/**
 * Reads every project still open, or settled within the window, and
 * compares each workspace's with Stripe.
 */
export async function reconcileSiteCareProjects(
  firestore: FirebaseFirestore.Firestore,
  input: { nowMs: number; stripe?: SiteCareStripeOptions },
): Promise<SiteCareProjectReconcileResult> {
  const snapshot = await firestore.collectionGroup(SITE_CARE_PROJECTS_COLLECTION).limit(2000).get()
  const byOrg = new Map<string, ProjectRow[]>()
  for (const doc of snapshot.docs) {
    const project = readSiteCareProject(doc.data())
    if (!project?.orgId) continue
    const settled = project.status === 'paid' || project.status === 'refunded' || project.status === 'quoted'
    if (settled && input.nowMs - project.updatedAtMs > SETTLED_WINDOW_MS) continue
    const rows = byOrg.get(project.orgId) ?? []
    rows.push({ id: doc.id, project, storedStatus: String(doc.get('status') ?? '') })
    byOrg.set(project.orgId, rows)
  }
  const result: SiteCareProjectReconcileResult = { projects: 0, findings: [], errors: [] }
  for (const [orgId, rows] of byOrg) {
    result.projects += rows.length
    try {
      const invoiced = rows.filter((row) => row.project.invoices.length)
      if (!invoiced.length) {
        result.findings.push(...compareSiteCareProjects({ orgId, projects: rows, invoices: new Map(), listed: [] }))
        continue
      }
      const billing = await readOrgBilling(orgId)
      const customerId = String((billing as { stripeCustomerId?: unknown }).stripeCustomerId ?? '')
      if (!customerId) {
        result.findings.push({
          orgId,
          projectId: null,
          code: 'project-invoice-missing',
          detail: 'Project invoices are recorded but the workspace has no Stripe customer.',
        })
        continue
      }
      const sinceMs = Math.min(...invoiced.map((row) => row.project.createdAtMs))
      const list = await listProjectInvoices({ customerId, sinceMs }, input.stripe)
      if (list.ok === false) {
        result.errors.push(`${orgId}: ${list.error}`)
        continue
      }
      const projectIds = new Set(rows.map((row) => row.id))
      const listed = list.invoices.filter((row) => projectIds.has(row.metadata[SITE_CARE_PROJECT_METADATA_KEY] ?? ''))
      const invoices = new Map<string, ProjectInvoiceState | null>(list.invoices.map((row) => [row.invoiceId, row]))
      for (const row of invoiced) {
        for (const invoice of row.project.invoices) {
          if (!invoice.invoiceId || invoices.has(invoice.invoiceId)) continue
          const read = await readProjectInvoice(invoice.invoiceId, input.stripe)
          if (read.ok === false) {
            result.errors.push(`${orgId}/${row.id}: ${read.error}`)
            continue
          }
          invoices.set(invoice.invoiceId, read.state)
        }
      }
      result.findings.push(...compareSiteCareProjects({ orgId, projects: rows, invoices, listed }))
    } catch (error) {
      result.errors.push(`${orgId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return result
}
