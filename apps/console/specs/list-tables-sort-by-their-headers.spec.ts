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
 * Every table sorts by its column headers (AGL-3680).
 *
 * The query-served lists switched header sorting off with
 * `disableColumnSorting` (AGL-3352, AGL-3321), because a header click sorted
 * only the page on screen and read as the whole list's order. The fix is not
 * to switch sorting off but to sort honestly: `useListColumnSort` handed to
 * `ListTable` as `columnSort` sorts a stored column on the QUERY and a joined
 * one over the page, saying so — see `list-column-sort.ts` in
 * `@aglyn/shared-util-tools` for which strategy a column takes. A list that
 * loads all its rows just lets the grid sort.
 *
 * So no table may pass `disableColumnSorting`. `NOT_YET_CONVERTED` holds the
 * callers the phase-2 lanes have still to convert, and it may only SHRINK: a
 * listed file that no longer passes the flag fails here until its line is
 * deleted, and an unlisted one fails until it is converted.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { code } from './source-text'

const REPO = join(__dirname, '..', '..', '..')

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'coverage', 'tmp', '.nx'])

function tsxFilesUnder(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...tsxFilesUnder(path))
      continue
    }
    if (entry.name.endsWith('.tsx') && !entry.name.includes('.spec.')) found.push(path)
  }
  return found
}

/** Whether a component switches a grid's header sorting off. */
const switchesSortingOff = (source: string): boolean => /\bdisableColumnSorting\b/.test(source)

/**
 * The callers not converted yet (AGL-3680 phase 2). ⛔ Only ever DELETE a
 * line here — convert the list instead of adding one.
 */
const NOT_YET_CONVERTED: readonly string[] = [
  'apps/console/app/(app)/[orgSlug]/billing/(sections)/invoices/page.tsx',
  'apps/console/app/(app)/[orgSlug]/hosts/[host]/layouts/page.tsx',
  'apps/console/app/(app)/admin/audit/page.tsx',
  'apps/console/app/(app)/admin/coupons/page.tsx',
  'apps/console/app/(app)/admin/health/page.tsx',
  'apps/console/app/(app)/admin/media-quarantine/page.tsx',
  'apps/console/components/activity-table.component.tsx',
  'apps/console/components/actor-activity-table.component.tsx',
  'apps/console/components/content/collection-entries-page.component.tsx',
  'apps/console/components/host-activity-table.component.tsx',
  'apps/console/components/host-components-card.component.tsx',
  'apps/console/components/host-members-card.component.tsx',
  'apps/console/components/idempotency-claims-card.component.tsx',
  'apps/console/components/mail-gateway-ledger-card.component.tsx',
  'apps/console/components/notifications-table.component.tsx',
  'apps/console/components/org-activity-card.component.tsx',
  'apps/console/components/org-members-card.component.tsx',
  'apps/console/components/pending-erasures-card.component.tsx',
  'apps/console/components/site-accounts-card.component.tsx',
  'apps/console/components/staff-doc-table.component.tsx',
  'apps/console/components/staff-email-deliveries-card.component.tsx',
  'apps/console/components/staff-email-suppressions-card.component.tsx',
  'apps/console/components/staff-tax-findings-card.component.tsx',
  'apps/console/components/staff-user-email-history-card.component.tsx',
  'apps/console/components/templates/host-templates-card.component.tsx',
  'libs/plugins/commerce/src/lib/components/console/host-orders-card.component.tsx',
  'libs/plugins/commerce/src/lib/components/console/pos-ops/pos-shift-history-card.component.tsx',
  'libs/plugins/commerce/src/lib/components/console/products-hub-card.component.tsx',
  'libs/plugins/commerce/src/lib/components/console/stock-movements-card.component.tsx',
  'libs/plugins/crm/src/lib/components/contacts-section.tsx',
  'libs/plugins/crm/src/lib/components/leads-section.tsx',
  'libs/plugins/crm/src/lib/components/tasks-section.tsx',
  'libs/plugins/data/src/lib/components/host-datasets-card.component.tsx',
  'libs/plugins/email/src/lib/components/email-screens-card.tsx',
  'libs/plugins/email/src/lib/components/list-members-panel.tsx',
  'libs/plugins/email/src/lib/components/lists-card.tsx',
  'libs/plugins/email/src/lib/components/org-email-templates-card.tsx',
  'libs/plugins/email/src/lib/components/suppressions-card.tsx',
  'libs/plugins/forms/src/lib/components/host-forms-card.component.tsx',
  'libs/plugins/inbox/src/lib/components/contacts-card.component.tsx',
  'libs/plugins/inbox/src/lib/components/submissions-card.component.tsx',
  'libs/plugins/marketing/src/lib/components/campaign-conversions-card.tsx',
  'libs/plugins/marketing/src/lib/components/campaign-detail-card.tsx',
  'libs/plugins/marketing/src/lib/components/campaign-members-section.tsx',
  'libs/plugins/marketing/src/lib/components/campaigns-card.tsx',
  'libs/plugins/marketing/src/lib/components/email-recipients-card.tsx',
  'libs/plugins/marketing/src/lib/components/emails-list-card.tsx',
  'libs/plugins/marketing/src/lib/components/host-experiments-card.component.tsx',
  'libs/plugins/marketing/src/lib/components/staff-org-email-card.component.tsx',
  'libs/plugins/marketplace/src/lib/components/org-licences-panel.component.tsx',
  'libs/plugins/outreach/src/lib/components/do-not-contact-domains.tsx',
  'libs/plugins/outreach/src/lib/components/enrollments-table.tsx',
  'libs/plugins/outreach/src/lib/components/sequences-section.tsx',
  'libs/plugins/workflows/src/lib/components/host-run-history-card.component.tsx',
  'libs/plugins/workflows/src/lib/components/staff-automations-card.component.tsx',
]

describe('every table sorts by its column headers (AGL-3680)', () => {
  it('THE CONTROL: the shape check catches what it is meant to catch', () => {
    expect(switchesSortingOff('<ListTable rows={rows} disableColumnSorting />')).toBe(true)
    expect(switchesSortingOff('<ListTable rows={rows} columnSort={columnSort} />')).toBe(false)
  })

  const files = [
    ...tsxFilesUnder(join(REPO, 'apps')),
    ...tsxFilesUnder(join(REPO, 'libs')),
  ]
  const offenders = files
    .filter((file) => switchesSortingOff(code(readFileSync(file, 'utf8'), file, 0)))
    .map((file) => relative(REPO, file).split('\\').join('/'))
    .sort()

  it('reads the whole tree', () => {
    expect(files.length).toBeGreaterThan(500)
  })

  it('no table outside the allowlist switches header sorting off', () => {
    expect(offenders.filter((file) => !NOT_YET_CONVERTED.includes(file))).toEqual([])
  })

  it('the allowlist only shrinks: a converted file leaves it', () => {
    expect(NOT_YET_CONVERTED.filter((file) => !offenders.includes(file))).toEqual([])
  })
})
