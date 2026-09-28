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
 * Every signal source tells people through the ONE seam (AGL-3368).
 *
 * A source-level sweep, because the failure it guards is a new signal that
 * pages staff by hand again and leaves the workspace's owners in the dark.
 * Each source below must call `notifyRiskEvent` (directly, or through the
 * `notifyRisk` dependency it is handed) with its kinds, and none of them may
 * go back to hand-rolling an urgent staff alert. Every kind in the catalog
 * must be sent by somebody. The behavior behind each call is proved in the
 * source's own spec.
 */

import { RISK_EVENT_KINDS, RISK_NOTICE_CLOSING_KINDS } from '@aglyn/shared-util-email/risk-notice-catalog'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..', '..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

/** Each source, and the kinds it sends. */
const SOURCES: Record<string, readonly string[]> = {
  'libs/tenant/data/admin/src/lib/server/outbound-send-review.ts': ['email-held', 'page-held', 'listing-held'],
  'libs/tenant/data/admin/src/lib/server/hosted-page-review.ts': ['domain-flagged', 'link-blocked'],
  'libs/tenant/data/admin/src/lib/server/payment-fraud-signal.ts': ['billing-payment-flagged', 'seller-review'],
  'libs/tenant/data/admin/src/lib/server/payment-risk-record.ts': [
    'sale-fraud-warning',
    'sale-payment-review',
    'sale-dispute',
  ],
  'libs/tenant/data/admin/src/lib/server/card-payment-velocity.ts': ['card-testing'],
  'libs/plugins/commerce/src/lib/server/gift-card-risk.ts': ['gift-card-hold'],
  'libs/plugins/commerce/src/lib/server/billing-webhook.ts': ['sale-dispute'],
  'libs/plugins/marketplace/src/lib/server/sale-risk.ts': [
    'marketplace-sale-review',
    'publisher-payouts-held',
    'publisher-payouts-standard',
  ],
  'libs/plugins/marketplace/src/lib/server/billing-webhook.ts': ['marketplace-sale-warning'],
  'apps/console/utils/server/lockdown-owner-notice.ts': [
    'workspace-locked',
    'workspace-unlocked',
    'site-locked',
    'site-unlocked',
    'domain-locked',
    'domain-unlocked',
    'account-locked',
    'account-unlocked',
    'feature-locked',
    'feature-unlocked',
  ],
  'apps/console/app/api/admin/billing/cancel-subscription/route.ts': ['subscription-canceled'],
}

/** The places that hand a source the seam, or call a lock notice. */
const CALLERS: Record<string, RegExp> = {
  'apps/console/app/api/billing/webhook/route.ts': /notifyRisk: notifyRiskEvent/g,
  'libs/plugins/bookings/src/lib/server/billing-webhook.ts': /notifyRisk: notifyRiskEvent/g,
  'apps/console/app/api/billing/usage-alerts/route.ts': /sendLockdownOwnerNotice\(/g,
  'apps/console/app/api/admin/abuse-reports/route.ts': /closeRiskNotice\(/g,
}

describe('every signal source goes through notifyRiskEvent', () => {
  it.each(Object.entries(SOURCES))('%s sends its kinds through the seam', (path, kinds) => {
    const source = read(path)
    expect(source).toMatch(/notifyRiskEvent|notifyRisk\(|deps\s*\.notifyRisk|input\.notifyRisk/)
    for (const kind of kinds) expect({ path, kind, sent: source.includes(`'${kind}'`) }).toEqual({ path, kind, sent: true })
    // No source goes back to paging staff by hand for a risk event.
    expect(source).not.toMatch(/notifyStaff\(\s*\{\s*type:\s*'system\.abuseReportUrgent'/)
  })

  it.each(Object.entries(CALLERS))('%s hands the seam to its source', (path, pattern) => {
    expect(read(path).match(pattern)?.length ?? 0).toBeGreaterThan(0)
  })

  it('reports an owner notice for every scope a lock names somebody at', () => {
    const route = read('apps/console/app/api/admin/lockdown/route.ts')
    // org, host, domain, user, feature, and each owned workspace of a user lock.
    expect(route.match(/ownerNoticeStep\(\{/g)?.length ?? 0).toBeGreaterThanOrEqual(6)
    expect(route).toContain('const emailOwners = body?.emailOwners !== false')
    expect(route).toContain("action === 'resend-notice'")
  })

  it('sends every kind in the catalog from somewhere', () => {
    const sent = new Set(Object.values(SOURCES).flat())
    const closing = new Set<string>(RISK_NOTICE_CLOSING_KINDS)
    for (const kind of RISK_EVENT_KINDS) {
      expect({ kind, sent: sent.has(kind) || closing.has(kind) }).toEqual({ kind, sent: true })
    }
  })
})
