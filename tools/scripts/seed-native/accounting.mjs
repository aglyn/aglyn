/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The workspace's books (AGL-3966), so the Aglyn app's Accounting screen
 * shows a connection, its mapping and a sync log rather than only the
 * connect buttons:
 *
 * - The workspace has Accounting released to it, as staff release it to one workspace: the per-org override
 *   `releaseFlags.release_accounting` (off by default until a deployment has ledger credentials; while it is off the
 *   console hides Accounting and its routes answer 404).
 * - `orgs/{orgId}/accountingConnections/quickbooks`: an
 *   `AccountingConnectionRecord` (connection-store.ts) bound to a sandbox
 *   company. It holds NO tokens: the sealed fields are empty, so anything
 *   that would call QuickBooks (`accounting/options`, a sync) fails closed,
 *   and the screen reads its connection, counts and log from Firestore
 *   through `accounting/status` and `accounting/log`.
 * - `orgs/{orgId}/accountingSyncItems`: `AccountingSyncItemRecord`s
 *   (sync-store.ts) against the store seed's orders, synced and one that
 *   needs attention. None is `pending`, so no sync job ever picks one up.
 */

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

/** `hostCode` (accounting-transforms.ts): four base-36 characters for an id, the prefix of a sale's document number. */
function hostCode(id) {
  let hash = 0x811c9dc5
  for (const char of String(id)) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36).toUpperCase().padStart(4, '0').slice(-4)
}

export async function seedAccounting({ put, uid, orgId, hostId, now: date }) {
  const now = date.getTime()
  const provider = 'quickbooks'
  await put(`orgs/${orgId}`, { releaseFlags: { release_accounting: true } }, { merge: true, fields: ['releaseFlags.release_accounting'] })
  await put(`orgs/${orgId}/accountingConnections/${provider}`, {
    orgId,
    provider,
    status: 'connected',
    tenantId: 'seed-realm-4620816365',
    tenantName: 'Juniper Street Co. (sandbox)',
    connectionId: null,
    tenants: [],
    environment: 'sandbox',
    sealedRefreshToken: '',
    sealedAccessToken: '',
    accessExpiresAtMs: 0,
    refreshExpiresAtMs: null,
    refreshedAtMs: 0,
    refreshLeaseUntilMs: 0,
    scopes: ['com.intuit.quickbooks.accounting'],
    homeCurrency: 'USD',
    multiCurrency: false,
    connectedAtMs: now - 21 * DAY,
    connectedByUid: uid,
    connectedByEmail: 'mobile-owner@example.test',
    mapping: {
      accounts: { income: '79', shippingIncome: '82', clearing: '35', feeExpense: '64', payoutBank: '35', taxLiability: '89' },
      taxCodes: { taxed: 'TAX', untaxed: 'NON' },
      syncMode: 'per-order',
      startDate: new Date(now - 21 * DAY).toISOString().slice(0, 10),
      timeZone: 'America/Chicago',
    },
    extras: {},
    feePayeeId: null,
    seenTaxKeys: ['taxed'],
    payoutCursorMs: now - 2 * DAY,
    callDay: null,
    callCount: 0,
    lastSyncAtMs: now - 3 * 60 * MINUTE,
    lastError: null,
    updatedAtMs: now - 3 * 60 * MINUTE,
  })

  // `orderExternalId`, `feeExternalId`, `refundExternalId` and `payoutExternalId`, as the intake names each.
  const sale = (number) => `${hostCode(hostId)}-${number}`
  const items = [
    ['sale', 'o-1041', sale(1041), 'Order #1041', 'synced', 1, 0, 6730],
    ['sale', 'o-1042', sale(1042), 'Order #1042', 'synced', 2, 0, 4155],
    ['fee', 'o-1042', `${sale(1042)}-F`, 'Card fee on order #1042', 'synced', 2, 0, 151],
    ['sale', 'o-1043', sale(1043), 'Order #1043', 'synced', 3, 0, 2658],
    ['refund', 're_seed_1046', `${sale(1046)}-R${hostCode('re_seed_1046')}`, 'Refund on order #1046', 'needs_attention', 4, 8, 6983],
    ['payout', 'po_seed_1', 'PO-seed_1', 'Payout of $412.36', 'synced', 2, 0, 41236],
  ]
  let index = 0
  for (const [kind, sourceId, externalId, label, status, days, attempts, amountCents] of items) {
    index += 1
    const occurredAtMs = now - days * DAY - index * MINUTE
    const updatedAtMs = occurredAtMs + 10 * MINUTE
    await put(`orgs/${orgId}/accountingSyncItems/seed-sync-${index}`, {
      orgId,
      kind,
      mode: 'per-order',
      sourceId,
      externalId,
      label,
      status,
      attempts,
      generation: 0,
      nextAttemptAtMs: 0,
      lastError: status === 'needs_attention' ? 'QuickBooks refused the refund: the income account is inactive.' : null,
      errorCode: status === 'needs_attention' ? 'retries-exhausted' : null,
      provider,
      providerDocId: status === 'synced' ? String(1200 + index) : null,
      providerDocType: status === 'synced' ? { payout: 'Deposit', fee: 'Purchase' }[kind] ?? 'SalesReceipt' : null,
      amountCents,
      currency: 'USD',
      occurredAtMs,
      summaryDate: null,
      summaryItemId: null,
      dependsOn: null,
      createdAtMs: occurredAtMs,
      updatedAtMs,
      syncedAtMs: status === 'synced' ? updatedAtMs : null,
    })
  }
  return `QuickBooks (sandbox, no tokens), ${items.length} sync items`
}
