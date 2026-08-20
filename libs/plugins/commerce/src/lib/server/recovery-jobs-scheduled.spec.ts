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
 * AGL-2227: the two commerce recovery passes are SCHEDULED, and the merchant
 * can see the queues they drain.
 *
 * The defect this closes is precisely a green-looking absence. Both handlers
 * existed, both were registered as API routes, both had specs, and
 * `server.ts` called them "the scheduler-driven jobs" in a comment — and no
 * scheduler existed. Every test in the repo passed throughout.
 *
 * So this asserts the WIRE, not the handler:
 *
 * 1. `registerPluginJob` is called for both passes, at module scope (the
 *    runner reaches jobs through `ensureAll(['tenantApi'])`; a registration
 *    inside a `register*` function depends on which entry point loaded).
 * 2. Each job body calls the exported scan, so a registration that runs an
 *    empty handler cannot satisfy it.
 * 3. The console card that shows the two queues exists AND is mounted on a
 *    real page — a component nobody renders is the same gap with more code.
 *
 * Source-text assertions rather than an import: `server.ts` pulls in
 * firebase-admin and Stripe at module scope, so importing it here would be a
 * closed-world `jest.mock` of the entire commerce backend to observe one
 * registry call — the shape that manufactured four defects on 2026-08-18.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const LIB = join(__dirname, '..')

function source(relative: string): string {
  return readFileSync(join(LIB, relative), 'utf8')
}

/** Body only — an import names a symbol without scheduling anything. */
function body(relative: string): string {
  return source(relative)
    .split('\n')
    .filter((line) => !/^\s*import\b/.test(line) && !/^\s*}\s*from\s/.test(line))
    .join('\n')
}

/** job name → the exported scan its handler must drive. */
const JOBS: Array<{ name: string; scan: string; module: string }> = [
  {
    name: 'abandoned-checkout-recovery',
    scan: 'scanAbandonedCheckouts',
    module: 'server/process-abandoned.ts',
  },
  {
    name: 'back-in-stock-alerts',
    scan: 'scanRestockAlerts',
    module: 'server/process-restock.ts',
  },
  // AGL-2473. The dropship supplier POST left the webhook's response path and
  // became a queue row; if nothing drains it, a paid order is never routed and
  // the change has made the bug WORSE rather than better — silent before,
  // silent now, with a row nobody reads. This is the same shape as the two
  // above, which is why it is asserted in the same table.
  {
    name: 'supplier-webhook-delivery',
    scan: 'scanSupplierDeliveries',
    module: 'server/supplier-outbox.ts',
  },
]

describe('AGL-2227 · the commerce recovery passes are actually scheduled', () => {
  const serverBarrel = source('server.ts')

  it('asserts over a real, non-empty job table', () => {
    expect(JOBS.length).toBe(3)
    expect(new Set(JOBS.map((job) => job.scan)).size).toBe(3)
  })

  it.each(JOBS)('$name is registered as a plugin job', ({ name }) => {
    expect(serverBarrel).toMatch(
      new RegExp(`registerPluginJob\\(\\{[\\s\\S]*?name:\\s*'${name}'`),
    )
  })

  it.each(JOBS)('$name drives $scan', ({ name, scan }) => {
    // The registration and the call must be in the SAME object literal. A
    // job registered with an empty handler beside an unrelated call to the
    // scan would satisfy two separate greps and schedule nothing.
    const block = new RegExp(
      `registerPluginJob\\(\\{[\\s\\S]*?name:\\s*'${name}'[\\s\\S]*?\\n\\}\\)`,
    ).exec(serverBarrel)
    expect(block).not.toBeNull()
    expect(block?.[0]).toContain(`${scan}(`)
  })

  it.each(JOBS)('$scan is exported from $module', ({ scan, module }) => {
    expect(source(module)).toContain(`export async function ${scan}(`)
  })

  it('registers at module scope, not inside a register* function', () => {
    // `registerPluginJob(` must appear BEFORE the first `export function
    // register` — the runner route only calls `ensureAll(['tenantApi'])`, so
    // a job registered inside `registerCommerceConsoleApi` would never enter
    // the registry the beat reads.
    const firstJob = serverBarrel.indexOf('registerPluginJob({')
    const firstRegisterFn = serverBarrel.indexOf('export function register')
    expect(firstJob).toBeGreaterThan(-1)
    expect(firstRegisterFn).toBeGreaterThan(-1)
    expect(firstJob).toBeLessThan(firstRegisterFn)
  })

  it('the barrel no longer claims a scheduler it does not have', () => {
    // The exact sentence that let this stay dark: a comment asserting the
    // wiring instead of having it.
    expect(serverBarrel).not.toContain('the scheduler-driven jobs (abandoned-cart')
  })

  it('the HTTP doors survive the extraction', () => {
    // The cron-secret routes stay for ops/manual invocation. Losing them
    // while gaining the beat would be a different regression.
    expect(serverBarrel).toContain(
      `registerPluginApiRoute('commerce/process-abandoned'`,
    )
    expect(serverBarrel).toContain(
      `registerPluginApiRoute('commerce/process-restock'`,
    )
    // The two AGL-2227 passes only. The AGL-2473 supplier drain has NO HTTP
    // door and deliberately so: the other two predate the beat and kept their
    // routes for manual invocation, while a public door onto a queue that
    // POSTs merchant-configured endpoints is attack surface bought for nothing
    // — the beat is the only caller, and a stuck row is retried on the next
    // tick without anyone pressing anything.
    for (const modulePath of [
      'server/process-abandoned.ts',
      'server/process-restock.ts',
    ]) {
      expect(source(modulePath)).toContain(`x-cron-secret`)
    }
    expect(source('server/supplier-outbox.ts')).not.toContain('x-cron-secret')
  })
})

describe('AGL-2227 · the merchant can see both queues', () => {
  const card = body('components/console/recovery-queue-card.component.tsx')

  it('reads the same two collections the scans drain', () => {
    expect(card).toContain(`'checkouts'`)
    expect(card).toContain(`'restockAlerts'`)
  })

  it('waits for the plan before refusing the abandoned half', () => {
    // `checkEntitlement(undefined)` resolves the FREE tier, so a refusal
    // rendered before the org doc lands accuses a paying customer.
    expect(card).toContain('abandonedCart')
    expect(card).toContain('EntitlementUpsell')
    // Both halves of the wire, because `/\bready\b/` alone was NOT enough:
    // the docblock explains why `ready` matters, so a card that destructured
    // it away and branched on `false` still matched. Proven by mutating it
    // that way and watching this test pass. So: destructured from the hook,
    // AND branched on.
    expect(card).toMatch(/const \{\s*ready,[\s\S]*?\} = useCommerceEntitlement\(/)
    expect(card).toContain('{!ready ? (')
  })

  it('does not gate the free half behind the paid one', () => {
    // Back-in-stock alerts are on every commerce plan. Wrapping the card in
    // `EntitlementGatedCard` would have hidden them behind Pro.
    // `<` matters: the docblock explains WHY the whole-card gate is wrong,
    // and asserting on the bare name would fail on the explanation.
    expect(card).not.toContain('<EntitlementGatedCard')
  })

  it('is MOUNTED on the commerce console page, not merely written', () => {
    const page = body('components/commerce-console-page.tsx')
    expect(page).toContain('<RecoveryQueueCard')
    expect(source('components/commerce-console-page.tsx')).toContain(
      "import RecoveryQueueCard from './console/recovery-queue-card.component'",
    )
  })
})
