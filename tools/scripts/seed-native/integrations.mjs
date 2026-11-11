/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The demo site's connected services, each in test mode where the service
 * has one, so the commerce settings screen's Connected services cards
 * (`commerceSettings` zone) show a connection rather than only the connect
 * buttons. Each document is the one the plugin's connect route writes, at its
 * own path and in its own shape:
 *
 * - Couriers: `courierConnections/{hostId}_doordash`, a TEST key only, last test passed.
 * - Delivery apps: `deliveryAppStores/doordash_{digest}`, one store (the Sandbox badge is the deployment's).
 * - Fulfillment networks: `fulfillmentNetworkConnections/{hostId}_shipmonk`, `sandbox: true`.
 * - Inventory sync: `inventorySyncConnections/{hostId}`, Cin7 Core, nothing syncing (the service has no test mode).
 * - Marketplaces: `marketplaceConnections/{hostId}_ebay`, `sandbox: true`, no grant.
 * - Post-purchase: `orgs/{orgId}/postPurchaseHostSettings/{hostId}`, AfterShip, Route and Narvar connected, all off.
 * - Print on demand: `podConnections/{hostId}__printful`, orders sent as drafts for review.
 * - Review platforms: `orgs/{orgId}/reviewPlatformsHostSettings/{hostId}`, Trustpilot by invitation copy.
 * - Sales channels: `hosts/{hostId}/salesChannels/feed-{google,meta}`, both feeds on.
 * - Shipping: `orgs/{orgId}/shippingConnections/easyship` with a sandbox key, and the site's ship-from address.
 * - Tax engines: `taxEngineConnections/{hostId}`, Avalara sandbox, last test passed.
 *
 * Accounting is the workspace's, not the site's, and `./accounting.mjs`
 * connects it (QuickBooks sandbox).
 *
 * No secret here is real, and none is sealed: each `sealed*` field holds a
 * `seed-test-sealed-…` placeholder, non-empty because the readers drop a
 * connection whose sealed field is empty. The routes the cards load never
 * open a sealed field or call the service. An action that would (Test keys,
 * a sync, a label) fails to open the placeholder and says so, so nothing
 * here reaches a vendor. Every due time is a year out, so no scheduled sync
 * picks a connection up.
 *
 * Seeding is not the whole of it: most of these cards draw only when the
 * console serving the stack holds that plugin's sealing key
 * (`COURIERS_TOKEN_KEY`, `TAX_ENGINES_TOKEN_KEY` and the rest), and some only
 * when the deployment offers the service. An emulated console blanks every
 * such key (`tools/scripts/lib/emulated-env.mjs`), so there sales channels
 * and review platforms draw, and the rest wait on those keys.
 *
 * Idempotent: every document has a fixed id and is written whole.
 */

import { createHash } from 'node:crypto'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const YEAR = 365 * DAY

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const sealed = (label) => `seed-test-sealed-${label}`
const KEY_ID = 'seed-test'

export async function seedIntegrations({ put, uid, orgId, hostId, now: date }) {
  const now = date.getTime()
  const connectedAtMs = now - 6 * DAY
  const far = now + YEAR
  const shipFrom = { line1: '100 Main St', city: 'Austin', postalCode: '78701', country: 'US' }

  // Couriers (DoorDash Drive): the merchant's own TEST key, tested.
  await put(`courierConnections/${hostId}_doordash`, {
    id: `${hostId}_doordash`,
    orgId,
    hostId,
    provider: 'doordash',
    live: null,
    test: {
      developerId: 'seed-test-developer',
      keyId: 'seed-test-key',
      sealedSigningSecret: sealed('doordash-signing-secret'),
      sealedWith: KEY_ID,
      lastTestOk: true,
      lastTestAtMs: now - HOUR,
      lastError: null,
    },
    pickupPhone: null,
    pickupNote: null,
    webhookTokenHash: sha256('seed-test-courier-webhook-token'),
    connectedByUid: uid,
    createdAtMs: connectedAtMs,
    updatedAtMs: now - HOUR,
  })

  // Delivery apps (DoorDash Marketplace): one store, nothing imported yet.
  const externalStoreId = 'seed-test-store-1'
  await put(`deliveryAppStores/doordash_${sha256(externalStoreId).slice(0, 24)}`, {
    orgId,
    hostId,
    service: 'doordash',
    externalStoreId,
    settings: { autoAccept: false, prepMinutes: 15 },
    connectedAtMs,
    connectedBy: uid,
    updatedAtMs: connectedAtMs,
    itemMatches: {},
    unmatched: {},
    menu: { publishedAtMs: null, items: 0, error: null },
  })

  // Fulfillment networks (ShipMonk sandbox): manual routing, no inventory sync.
  const networkId = `${hostId}_shipmonk`
  await put(`fulfillmentNetworkConnections/${networkId}`, {
    orgId,
    hostId,
    provider: 'shipmonk',
    status: 'active',
    sandbox: true,
    accountName: 'Juniper Street (ShipMonk sandbox)',
    channelId: null,
    marketplaces: [],
    marketplaceId: null,
    storeId: '12345',
    sealedWebhookSecret: sealed('shipmonk-webhook-secret'),
    routing: 'automatic',
    shippingMethod: 'Standard',
    shippingSpeed: 'Standard',
    syncInventory: false,
    sealedAccessToken: sealed('shipmonk-access-token'),
    sealedRefreshToken: null,
    accessTokenExpiresAtMs: null,
    tokenKeyId: KEY_ID,
    webhookTokenHash: null,
    stock: {},
    inventory: { syncedAtMs: null, skus: 0, updated: 0, unchanged: 0, unknown: 0, untracked: 0, perLocation: 0 },
    inventoryDueAtMs: far,
    inventoryLeaseUntilMs: 0,
    lastError: null,
    totals: { sent: 0, shipped: 0, canceled: 0 },
    connectedAtMs,
    connectedByUid: uid,
    pendingOAuth: null,
    updatedAtMs: connectedAtMs,
  })
  await put(`fulfillmentNetworkConnections/${networkId}/log/seed-connected`, {
    atMs: connectedAtMs,
    kind: 'connected',
    message: 'Connected to ShipMonk',
  })

  // Inventory sync (Cin7 Core): connected, every direction off.
  await put(`inventorySyncConnections/${hostId}`, {
    orgId,
    hostId,
    provider: 'cin7-core',
    status: 'active',
    accountName: 'Juniper Street (Cin7 Core test account)',
    stockSource: 'off',
    productSync: 'off',
    sendOrders: false,
    locationId: null,
    orderCustomer: '',
    taxRule: '',
    sealedCredential: sealed('cin7-credential'),
    credentialKeyId: KEY_ID,
    accountCode: null,
    apiDomain: null,
    accessTokenExpiresAtMs: null,
    holdUntilMs: 0,
    stock: { syncedAtMs: null, direction: 'off', skus: 0, updated: 0, unchanged: 0, unknown: 0, untracked: 0, perLocation: 0, failed: 0 },
    lastCounts: {},
    stockDueAtMs: far,
    stockFullDueAtMs: far,
    stockLeaseUntilMs: 0,
    products: { syncedAtMs: null, created: 0, updated: 0, unchanged: 0, failed: 0, more: false },
    productsDueAtMs: far,
    productsLeaseUntilMs: 0,
    productsCursor: null,
    productsSinceMs: null,
    productsRunStartedAtMs: null,
    lastError: null,
    totals: { ordersSent: 0, ordersFailed: 0 },
    connectedAtMs,
    connectedByUid: uid,
    pendingOAuth: null,
    updatedAtMs: connectedAtMs,
  })
  await put(`inventorySyncConnections/${hostId}/log/seed-connected`, {
    atMs: connectedAtMs,
    kind: 'connected',
    message: 'Connected to Cin7 Core',
  })

  // Marketplaces (eBay sandbox): connected, no grant held, so nothing syncs.
  const marketplaceId = `${hostId}_ebay`
  await put(`marketplaceConnections/${marketplaceId}`, {
    orgId,
    hostId,
    marketplace: 'ebay',
    status: 'active',
    sandbox: true,
    accountName: 'seed-test-sandbox-seller',
    account: { sellerId: 'seed-test-seller' },
    sites: [{ id: 'EBAY_US', name: 'eBay US', currency: 'USD' }],
    settings: {
      listingMode: 'link',
      syncPrices: false,
      priceAdjustPercent: 0,
      stockBuffer: 0,
      untrackedQuantity: 10,
      importOrders: true,
      confirmShipments: true,
      marketplaceId: 'EBAY_US',
    },
    sealedAccessToken: null,
    sealedRefreshToken: null,
    accessTokenExpiresAtMs: null,
    refreshTokenExpiresAtMs: null,
    tokenKeyId: null,
    pendingOAuth: null,
    ordersSinceMs: connectedAtMs,
    ordersPage: null,
    ordersDueAtMs: far,
    listingsDueAtMs: far,
    listingsDirtyAtMs: 0,
    dueAtMs: far,
    leaseUntilMs: 0,
    failures: 0,
    listings: { syncedAtMs: null, offers: 0, updated: 0, created: 0, unchanged: 0, notListed: 0, failed: 0 },
    orders: { imported: 0, skipped: 0, lastImportedAtMs: null },
    shipments: { confirmed: 0, failed: 0 },
    lastError: null,
    connectedAtMs,
    connectedByUid: uid,
    updatedAtMs: connectedAtMs,
  })
  await put(`marketplaceConnections/${marketplaceId}/log/seed-connected`, {
    atMs: connectedAtMs,
    kind: 'connected',
    message: 'Connected to eBay (seed-test-sandbox-seller)',
  })

  // Post-purchase: each vendor connected and switched off, so the cards read
  // "Connected" and no cart offer or parcel follow-up runs on a placeholder.
  await put(`orgs/${orgId}/postPurchaseHostSettings/${hostId}`, {
    orgId,
    hostId,
    aftership: {
      enabled: false,
      sealedApiKey: sealed('aftership-api-key'),
      sealedWebhookSecret: sealed('aftership-webhook-secret'),
      trackingPageUrl: 'https://juniper-street.example.test/track',
    },
    route: { enabled: false, sealedToken: sealed('route-token'), defaultSelected: false },
    narvar: {
      enabled: false,
      accountId: 'seed-test-narvar-account',
      sealedAuthToken: sealed('narvar-auth-token'),
      retailerMoniker: 'juniper-street',
    },
    updatedAtMs: connectedAtMs,
    updatedBy: uid,
  })

  // Print on demand (Printful): orders go as drafts for review, never made.
  await put(`podConnections/${hostId}__printful`, {
    orgId,
    hostId,
    provider: 'printful',
    storeId: 'seed-test-store-1',
    storeName: 'Juniper Street (test store)',
    currency: 'USD',
    sealedApiToken: sealed('printful-api-token'),
    apiTokenKeyId: KEY_ID,
    sealedWebhookToken: sealed('printful-webhook-token'),
    submitMode: 'review',
    syncPrices: false,
    webhooks: 'polling',
    webhookDetail: null,
    lastError: null,
    connectedByUid: uid,
    connectedAtMs,
    updatedAtMs: connectedAtMs,
  })

  // Review platforms: Trustpilot by invitation copy (it has no test mode; its
  // reader accepts only an address at Trustpilot's invitation domain), and
  // Yotpo's keys stored but off.
  await put(`orgs/${orgId}/reviewPlatformsHostSettings/${hostId}`, {
    orgId,
    hostId,
    trustpilot: {
      mode: 'bcc',
      sendOn: 'shipped',
      bccAddress: 'seed-test-juniper-street@invite.trustpilot.com',
      businessUnitId: null,
      businessUserId: null,
      locale: null,
      templateId: null,
    },
    yotpo: { enabled: false, appKey: 'seedTestYotpoAppKey01', sealedSecretKey: sealed('yotpo-secret-key') },
    updatedAtMs: connectedAtMs,
    updatedBy: uid,
  })

  // Sales channels: the Google and Meta product feeds on, one already read.
  const feeds = [
    ['google', now - 3 * HOUR, 'Google-Merchant (seed)'],
    ['meta', null, null],
  ]
  for (const [channel, lastFetchAtMs, lastFetchAgent] of feeds) {
    await put(`hosts/${hostId}/salesChannels/feed-${channel}`, {
      channel,
      enabled: true,
      token: `seed-test-${channel}-feed-0001`,
      createdAtMs: connectedAtMs,
      createdBy: uid,
      ...(lastFetchAtMs ? { lastFetchAtMs, lastFetchAgent } : {}),
    })
  }

  // Shipping: the workspace's own Easyship account with a sandbox key, and the
  // site's ship-from address and default box.
  await put(`orgs/${orgId}/shippingConnections/easyship`, {
    kind: 'easyship',
    orgId,
    status: 'active',
    sealedApiKey: sealed('easyship-sandbox-api-key'),
    keyId: KEY_ID,
    accountName: 'Juniper Street Co. (Easyship sandbox)',
    testMode: true,
    settings: {},
    connectedAtMs,
    connectedByUid: uid,
  })
  await put(`orgs/${orgId}/shippingHostSettings/${hostId}`, {
    packages: [{ id: 'default', name: 'Medium box', lengthCm: 30, widthCm: 23, heightCm: 15, emptyWeightGrams: 200 }],
    labelFormat: 'pdf_4x6',
    insurance: 'none',
    signature: 'none',
    checkoutServices: [],
    shipFromAddress: { name: 'Juniper Street Bakery', ...shipFrom, state: 'TX' },
    updatedAtMs: connectedAtMs,
    updatedByUid: uid,
  })

  // Tax engines (Avalara sandbox): tested, recording transactions.
  await put(`taxEngineConnections/${hostId}`, {
    orgId,
    hostId,
    provider: 'avalara',
    environment: 'sandbox',
    accountId: '2000000001',
    companyCode: 'DEFAULT',
    sealedApiToken: sealed('avalara-license-key'),
    apiTokenKeyId: KEY_ID,
    shipFrom: { ...shipFrom, region: 'TX' },
    shipFromValidated: true,
    defaultTaxCode: 'P0000000',
    recordTransactions: true,
    lastTestOk: true,
    lastTestAtMs: now - HOUR,
    lastError: null,
    connectedByUid: uid,
    createdAtMs: connectedAtMs,
    updatedAtMs: now - HOUR,
  })

  return '11 services connected (test mode where offered)'
}
