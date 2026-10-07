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

import { pluginShipmentRecords } from '@aglyn/aglyn/plugin-manager/plugin-shipment-records'
import {
  firebaseAdmin,
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { SHIPPING_COLLECTIONS } from '../constants/bundle-common'
import { LABEL_MARKUP_PCT } from '../model/label-billing'
import { serviceCatalog } from '../model/service-catalog'
import { normalizeShippingAddress } from '../model/shipping-settings'
import type { ConnectableCarrier, RateBadge } from '../providers/types'
import { ShippingProviderError } from '../providers/types'
import {
  ensureShippingAccount,
  LABEL_DEBIT_CONSENT_TEXT,
  openShippingAccount,
  readDebitConsent,
  writeDebitConsent,
} from './account-store'
import { readAddressCheck, writeAddressCheck, type StoredAddressCheck } from './address-checks'
import { readShippingConfig } from './config'
import { isDocumentId, orgRef } from './db'
import {
  buyLabel,
  forgetCarrierAccounts,
  listRecordLabels,
  rateRecord,
  readRecord,
  ShippingFlowError,
  voidLabel,
  type LabelKind,
  type QuotedRate,
  type StoredLabel,
} from './labels'
import { shippingError, shippingGate, shippingJson } from './route-gate'
import { readHostSettings, resolveShipFrom, writeHostSettings } from './settings-store'
import { resolveShippingSite } from './site-context'

/**
 * The console routes (AGL-3612). Each climbs `shippingGate` — the role it
 * needs on the site, and for a workspace-level change the org permission —
 * and answers a flow's refusal in the flow's own words and status.
 */

type Handler = (request: Request) => Promise<Response>

function flowRefusal(error: unknown): Response {
  if (error instanceof ShippingFlowError) return shippingError(error.status, error.message)
  if (error instanceof ShippingProviderError) {
    return shippingError(502, error.detail || error.message)
  }
  const status = Number((error as { status?: unknown })?.status)
  if (status === 409) return shippingError(409, String((error as Error).message))
  console.error('[shipping] route failed', error)
  return shippingError(500, 'Something went wrong. Try again.')
}

const methods =
  (allowed: string[], handler: Handler): Handler =>
  async (request) =>
    allowed.includes(request.method) ? handler(request) : shippingError(405, 'Method not allowed')

/** A label as the console reads it: never the provider's ids. */
export function publicLabel(label: StoredLabel) {
  return {
    labelId: label.labelId,
    recordId: label.recordId,
    recordRef: label.recordRef,
    kind: label.kind,
    status: label.status,
    carrier: label.carrier ?? null,
    serviceLabel: label.serviceLabel ?? null,
    trackingNumber: label.trackingNumber ?? null,
    trackingUrl: label.trackingUrl ?? null,
    trackingStatus: label.trackingStatus ?? null,
    labelUrl: label.labelUrl ?? null,
    commercialInvoiceUrl: label.commercialInvoiceUrl ?? null,
    costCents: label.costCents,
    chargeCents: label.billing?.chargeCents ?? 0,
    currency: label.currency,
    billingMethod: label.billing?.method ?? null,
    billingState: label.billing?.state ?? null,
    billingFailure: label.billing?.failure ?? null,
    lines: label.lines,
    weightGrams: label.weightGrams,
    packageName: label.packageName ?? null,
    recordShipmentRefusal: label.recordShipmentRefusal ?? null,
    failure: label.failure ?? null,
    createdAtMs: label.createdAtMs,
    purchasedAtMs: label.purchasedAtMs ?? null,
    voidedAtMs: label.voidedAtMs ?? null,
  }
}

/** A kept address check as the console reads it. */
export function publicAddressCheck(entry: StoredAddressCheck | null) {
  if (!entry) return null
  return {
    verdict: entry.check.verdict,
    messages: entry.check.messages ?? [],
    suggested: entry.check.suggested ?? null,
    source: entry.source,
    checkedAtMs: entry.checkedAtMs,
  }
}

function publicRate(rate: QuotedRate) {
  return {
    rateId: rate.rateId,
    serviceKey: rate.serviceKey,
    carrier: rate.carrier,
    label: rate.label,
    amountCents: rate.amountCents,
    currency: rate.currency,
    estimatedDays: rate.estimatedDays ?? null,
    badges: rate.badges as RateBadge[],
    merchantCarrierAccount: rate.merchantCarrierAccount,
  }
}

export const availabilityRoute: Handler = methods(['GET'], async (request) => {
  const configured = readShippingConfig()
  const hostId = new URL(request.url).searchParams.get('hostId') ?? ''
  if (!configured.configured || !isDocumentId(hostId)) return shippingJson({ available: false })
  const site = await resolveShippingSite(hostId)
  return shippingJson({
    available: Boolean(site),
    ...(site ? { provider: configured.config.provider.displayName, testMode: configured.config.testMode } : {}),
  })
})

export const settingsRoute: Handler = methods(['GET', 'POST'], async (request) => {
  const gate = await shippingGate(request, { role: request.method === 'GET' ? 'editor' : 'admin' })
  if (gate instanceof Response) return gate
  const { actor, config, body } = gate
  try {
    const settings =
      request.method === 'POST'
        ? await writeHostSettings(actor.orgId, actor.hostId, body['settings'], actor.uid)
        : await readHostSettings(actor.orgId, actor.hostId)
    const places = (await pluginShipmentRecords()?.shipFromAddresses(actor.hostId).catch(() => [])) ?? []
    const shipFrom = await resolveShipFrom(actor.hostId, settings)
    return shippingJson({
      settings,
      places,
      shipFromResolved: Boolean(shipFrom),
      services: serviceCatalog(config.providerId),
      provider: config.provider.displayName,
      testMode: config.testMode,
    })
  } catch (error) {
    return flowRefusal(error)
  }
})

export const accountRoute: Handler = methods(['GET', 'POST'], async (request) => {
  const gate = await shippingGate(request, {
    role: 'admin',
    ...(request.method === 'POST' ? { orgPermission: 'billing.manage' } : {}),
  })
  if (gate instanceof Response) return gate
  const { actor, config, body } = gate
  try {
    if (request.method === 'POST') {
      await writeDebitConsent(actor.orgId, config, actor.uid, body['accepted'] === true)
    }
    const [account, consent] = await Promise.all([
      openShippingAccount(actor.orgId, config).catch(() => null),
      readDebitConsent(actor.orgId, config),
    ])
    return shippingJson({
      opened: Boolean(account),
      provider: config.provider.displayName,
      testMode: config.testMode,
      consent: consent ? { acceptedAtMs: consent.acceptedAtMs } : null,
      consentText: LABEL_DEBIT_CONSENT_TEXT,
      markupPct: LABEL_MARKUP_PCT,
    })
  } catch (error) {
    return flowRefusal(error)
  }
})

async function openedAccount(gate: Exclude<Awaited<ReturnType<typeof shippingGate>>, Response>) {
  return ensureShippingAccount(gate.actor.orgId, gate.config, {
    name: gate.actor.name,
    email: gate.actor.email,
    company: String(gate.actor.org['name'] ?? gate.actor.name),
    uid: gate.actor.uid,
  })
}

export const carrierAccountsRoute: Handler = methods(['GET'], async (request) => {
  const gate = await shippingGate(request, { role: 'admin' })
  if (gate instanceof Response) return gate
  try {
    const account = await openedAccount(gate)
    const accounts = await gate.config.provider.listCarrierAccounts(account)
    return shippingJson({
      accounts,
      canConnect: Boolean(gate.config.provider.connectCarrierAccount),
    })
  } catch (error) {
    return flowRefusal(error)
  }
})

const CONNECTABLE: readonly ConnectableCarrier[] = ['ups', 'fedex']

export const carrierAccountsConnectRoute: Handler = methods(['POST'], async (request) => {
  const gate = await shippingGate(request, { role: 'admin', orgPermission: 'billing.manage' })
  if (gate instanceof Response) return gate
  const { body, config } = gate
  const carrier = String(body['carrier'] ?? '') as ConnectableCarrier
  const accountNumber = String(body['accountNumber'] ?? '').trim().slice(0, 40)
  const contact = (body['contact'] ?? {}) as Record<string, unknown>
  const address = normalizeShippingAddress(body['address'])
  if (!CONNECTABLE.includes(carrier) || !accountNumber || !address) {
    return shippingError(400, 'Name the carrier, the account number and its billing address.')
  }
  if (!config.provider.connectCarrierAccount) {
    return shippingError(409, `${config.provider.displayName} does not connect carrier accounts here.`)
  }
  const returnTo = String(body['returnTo'] ?? '')
  try {
    const account = await openedAccount(gate)
    const connected = await config.provider.connectCarrierAccount(account, {
      carrier,
      accountNumber,
      contact: {
        name: String(contact['name'] ?? '').slice(0, 80),
        ...(contact['company'] ? { company: String(contact['company']).slice(0, 80) } : {}),
        email: String(contact['email'] ?? gate.actor.email).slice(0, 120),
        phone: String(contact['phone'] ?? '').slice(0, 40),
      },
      address,
      ...(/^https:\/\//.test(returnTo) ? { redirectUri: returnTo } : {}),
      state: gate.actor.hostId,
    })
    forgetCarrierAccounts(gate.actor.orgId)
    return shippingJson(connected)
  } catch (error) {
    return flowRefusal(error)
  }
})

export const carrierAccountsActiveRoute: Handler = methods(['POST'], async (request) => {
  const gate = await shippingGate(request, { role: 'admin', orgPermission: 'billing.manage' })
  if (gate instanceof Response) return gate
  const carrierAccountId = String(gate.body['carrierAccountId'] ?? '')
  if (!isDocumentId(carrierAccountId)) return shippingError(400, 'Missing carrierAccountId')
  if (!gate.config.provider.setCarrierAccountActive) {
    return shippingError(409, 'This provider does not switch carrier accounts here.')
  }
  try {
    const account = await openedAccount(gate)
    await gate.config.provider.setCarrierAccountActive(account, carrierAccountId, gate.body['active'] === true)
    forgetCarrierAccounts(gate.actor.orgId)
    return shippingJson({ ok: true })
  } catch (error) {
    return flowRefusal(error)
  }
})

function readKind(value: unknown): LabelKind {
  return value === 'return' ? 'return' : 'outbound'
}

function readLines(value: unknown): Array<{ lineIndex: number; quantity: number }> | undefined {
  if (!Array.isArray(value)) return undefined
  return value
    .map((line) => ({
      lineIndex: Math.floor(Number((line as Record<string, unknown>)?.['lineIndex'])),
      quantity: Math.floor(Number((line as Record<string, unknown>)?.['quantity'])),
    }))
    .filter((line) => Number.isInteger(line.lineIndex) && line.lineIndex >= 0 && line.quantity > 0)
    .slice(0, 200)
}

function readPackage(value: unknown) {
  const raw = (value ?? {}) as Record<string, unknown>
  const number = (field: string) => {
    const parsed = Number(raw[field])
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, field === 'weightGrams' ? 70_000 : 300) : undefined
  }
  return {
    ...(typeof raw['presetId'] === 'string' ? { presetId: raw['presetId'].slice(0, 40) } : {}),
    ...(number('lengthCm') ? { lengthCm: number('lengthCm') } : {}),
    ...(number('widthCm') ? { widthCm: number('widthCm') } : {}),
    ...(number('heightCm') ? { heightCm: number('heightCm') } : {}),
    ...(number('weightGrams') ? { weightGrams: number('weightGrams') } : {}),
  }
}

export const ratesRoute: Handler = methods(['POST'], async (request) => {
  const gate = await shippingGate(request, { role: 'editor' })
  if (gate instanceof Response) return gate
  const recordId = String(gate.body['recordId'] ?? '')
  if (!isDocumentId(recordId)) return shippingError(400, 'Missing recordId')
  try {
    const signature = String(gate.body['signature'] ?? '')
    const quote = await rateRecord(gate.actor, gate.config, {
      recordId,
      kind: readKind(gate.body['kind']),
      package: readPackage(gate.body['package']),
      ...(readLines(gate.body['lines']) ? { lines: readLines(gate.body['lines']) } : {}),
      ...(typeof gate.body['insure'] === 'boolean' ? { insure: gate.body['insure'] } : {}),
      ...(signature === 'none' || signature === 'standard' || signature === 'adult' ? { signature } : {}),
      ...(normalizeShippingAddress(gate.body['shipTo']) ? { shipTo: normalizeShippingAddress(gate.body['shipTo']) } : {}),
    })
    return shippingJson({
      shipmentId: quote.shipmentId,
      rates: quote.rates.map(publicRate),
      messages: quote.messages,
      weightGrams: quote.weightGrams,
      packageName: quote.packageName,
      lines: quote.lines,
      international: quote.international,
    })
  } catch (error) {
    return flowRefusal(error)
  }
})

export const labelsRoute: Handler = methods(['GET'], async (request) => {
  const gate = await shippingGate(request, { role: 'editor' })
  if (gate instanceof Response) return gate
  const recordId = new URL(request.url).searchParams.get('recordId') ?? ''
  if (!isDocumentId(recordId)) return shippingError(400, 'Missing recordId')
  try {
    const [labels, addressCheck] = await Promise.all([
      listRecordLabels(gate.actor.orgId, gate.actor.hostId, recordId),
      readAddressCheck(gate.actor.orgId, gate.actor.hostId, recordId),
    ])
    return shippingJson({ labels: labels.map(publicLabel), addressCheck: publicAddressCheck(addressCheck) })
  } catch (error) {
    return flowRefusal(error)
  }
})

export const labelsBuyRoute: Handler = methods(['POST'], async (request) => {
  const gate = await shippingGate(request, { role: 'editor' })
  if (gate instanceof Response) return gate
  const recordId = String(gate.body['recordId'] ?? '')
  const shipmentId = String(gate.body['shipmentId'] ?? '')
  const rateId = String(gate.body['rateId'] ?? '')
  if (!isDocumentId(recordId) || !isDocumentId(shipmentId) || !isDocumentId(rateId)) {
    return shippingError(400, 'Missing recordId, shipmentId or rateId')
  }
  try {
    const result = await buyLabel(gate.actor, gate.config, {
      recordId,
      shipmentId,
      rateId,
      attemptKey: String(gate.body['attemptKey'] ?? request.headers.get('idempotency-key') ?? ''),
    })
    return shippingJson({ label: publicLabel(result.label), replayed: result.replayed })
  } catch (error) {
    return flowRefusal(error)
  }
})

export const labelsVoidRoute: Handler = methods(['POST'], async (request) => {
  const gate = await shippingGate(request, { role: 'editor' })
  if (gate instanceof Response) return gate
  const labelId = String(gate.body['labelId'] ?? '')
  if (!isDocumentId(labelId)) return shippingError(400, 'Missing labelId')
  try {
    const account = await openedAccount(gate)
    const label = await voidLabel(gate.actor, gate.config, labelId, account)
    return shippingJson({ label: publicLabel(label) })
  } catch (error) {
    return flowRefusal(error)
  }
})

export const addressValidateRoute: Handler = methods(['POST'], async (request) => {
  const gate = await shippingGate(request, { role: 'editor' })
  if (gate instanceof Response) return gate
  try {
    let address = normalizeShippingAddress(gate.body['address'])
    const recordId = String(gate.body['recordId'] ?? '')
    // Only a check of the order's OWN address is kept as the order's: a typed
    // correction is a candidate until a label is bought for it.
    const ofRecord = !address && isDocumentId(recordId)
    if (ofRecord) {
      address = (await readRecord(gate.actor.hostId, recordId)).shipTo
    }
    if (!address) return shippingError(400, 'Name an address or an order')
    const account = await openedAccount(gate)
    const check = await gate.config.provider.validateAddress(account, address)
    if (ofRecord) {
      await writeAddressCheck(gate.actor.orgId, {
        hostId: gate.actor.hostId,
        recordId,
        address,
        check,
        source: 'console',
      })
    }
    return shippingJson({ address, check })
  } catch (error) {
    return flowRefusal(error)
  }
})

/** The rate a batch rule picks from one quote. */
export function pickBatchRate(rates: QuotedRate[], policy: string): QuotedRate | null {
  if (!rates.length) return null
  if (policy === 'fastest') {
    const timed = rates.filter((rate) => typeof rate.estimatedDays === 'number')
    const pool = timed.length ? timed : rates
    return [...pool].sort(
      (a, b) => (a.estimatedDays ?? 99) - (b.estimatedDays ?? 99) || a.amountCents - b.amountCents,
    )[0]
  }
  if (policy && policy !== 'cheapest') {
    const exact = rates.filter((rate) => rate.serviceKey === policy.toLowerCase())
    return exact.sort((a, b) => a.amountCents - b.amountCents)[0] ?? null
  }
  return [...rates].sort((a, b) => a.amountCents - b.amountCents)[0]
}

/** The most orders one batch rates or buys: a batch is a person's afternoon, not a backfill. */
export const MAX_BATCH = 50

export const batchRatesRoute: Handler = methods(['POST'], async (request) => {
  const gate = await shippingGate(request, { role: 'editor' })
  if (gate instanceof Response) return gate
  const recordIds = (Array.isArray(gate.body['recordIds']) ? gate.body['recordIds'] : [])
    .map(String)
    .filter(isDocumentId)
  if (!recordIds.length || recordIds.length > MAX_BATCH) {
    return shippingError(400, `Pick between 1 and ${MAX_BATCH} orders.`)
  }
  const policy = String(gate.body['policy'] ?? 'cheapest').slice(0, 80)
  const packageInput = readPackage({ presetId: gate.body['presetId'] })
  const settings = await readHostSettings(gate.actor.orgId, gate.actor.hostId)
  const results = []
  for (const recordId of [...new Set(recordIds)]) {
    try {
      const quote = await rateRecord(
        gate.actor,
        gate.config,
        { recordId, kind: 'outbound', package: packageInput },
        settings,
      )
      const picked = pickBatchRate(quote.rates, policy)
      const record = await readRecord(gate.actor.hostId, recordId)
      results.push({
        recordId,
        recordRef: record.displayRef,
        shipmentId: quote.shipmentId,
        rate: picked ? publicRate(picked) : null,
        weightGrams: quote.weightGrams,
        // What a packing slip prints: who it goes to, and what is in the box.
        slip: {
          shipTo: quote.to,
          lines: quote.lines.map((chosen) => {
            const line = record.lines.find((one) => one.lineIndex === chosen.lineIndex)
            return { name: line?.name ?? '', sku: line?.sku ?? null, quantity: chosen.quantity }
          }),
        },
        error: picked ? null : quote.messages[0] ?? 'No rate matches the service rule.',
      })
    } catch (error) {
      results.push({
        recordId,
        recordRef: null,
        shipmentId: null,
        rate: null,
        weightGrams: null,
        error:
          error instanceof ShippingFlowError || error instanceof ShippingProviderError
            ? (error as ShippingProviderError).detail || error.message
            : 'Could not rate this order.',
      })
    }
  }
  return shippingJson({ results })
})

export const batchBuyRoute: Handler = methods(['POST'], async (request) => {
  const gate = await shippingGate(request, { role: 'editor' })
  if (gate instanceof Response) return gate
  const batchKey = String(gate.body['batchKey'] ?? '')
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(batchKey)) return shippingError(400, 'Missing batchKey')
  const items = (Array.isArray(gate.body['items']) ? gate.body['items'] : [])
    .map((item) => item as Record<string, unknown>)
    .map((item) => ({
      recordId: String(item['recordId'] ?? ''),
      shipmentId: String(item['shipmentId'] ?? ''),
      rateId: String(item['rateId'] ?? ''),
    }))
    .filter((item) => isDocumentId(item.recordId) && isDocumentId(item.shipmentId) && isDocumentId(item.rateId))
  if (!items.length || items.length > MAX_BATCH) {
    return shippingError(400, `Pick between 1 and ${MAX_BATCH} orders.`)
  }
  const results = []
  // One at a time: each is its own claimed attempt, so a retried batch
  // replays the labels it already bought and buys only what is left.
  for (const item of items) {
    try {
      const bought = await buyLabel(gate.actor, gate.config, {
        ...item,
        attemptKey: `${batchKey}:${item.recordId}`,
      })
      results.push({ recordId: item.recordId, label: publicLabel(bought.label), error: null })
    } catch (error) {
      results.push({
        recordId: item.recordId,
        label: null,
        error:
          error instanceof ShippingFlowError
            ? error.message
            : error instanceof ShippingProviderError
              ? error.detail || error.message
              : 'Could not buy this label.',
      })
      if (error instanceof ShippingFlowError && error.status === 402) break
    }
  }
  return shippingJson({ results })
})

/** The workspace's label spend: this month and the five before it. */
export const spendRoute: Handler = methods(['GET'], async (request) => {
  const configured = readShippingConfig()
  if (!configured.configured) return shippingJson({ available: false })
  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return shippingError(401, 'Unauthenticated')
  const orgId = new URL(request.url).searchParams.get('orgId') ?? ''
  if (!isDocumentId(orgId)) return shippingError(400, 'Missing orgId')
  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(authorization.slice('Bearer '.length))
    const membership = await resolveOrgMembership(decoded.uid, orgId)
    if (
      decoded['staff'] !== true &&
      (!membership || !(await memberHasOrgPermission(orgId, membership.member, 'billing.view' as never)))
    ) {
      return shippingError(403, 'Not permitted')
    }
    const months: string[] = []
    const now = new Date()
    for (let back = 0; back < 6; back += 1) {
      months.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)).toISOString().slice(0, 7))
    }
    const snapshot = await orgRef(orgId)
      .collection(SHIPPING_COLLECTIONS.labels)
      .where('month', '>=', months[months.length - 1])
      .orderBy('month', 'desc')
      .limit(2_000)
      .get()
    const totals = new Map(months.map((month) => [month, { month, labels: 0, chargedCents: 0, creditedCents: 0, debitedCents: 0, invoicedCents: 0 }]))
    for (const doc of snapshot.docs) {
      const label = doc.data() as StoredLabel
      const row = totals.get(label.month)
      if (!row || !label.billing || label.status === 'failed' || label.status === 'purchasing') continue
      row.labels += 1
      if (label.billing.state === 'credited') {
        row.creditedCents += label.billing.chargeCents
        continue
      }
      if (label.billing.state === 'not_billed') continue
      row.chargedCents += label.billing.chargeCents
      if (label.billing.method === 'account_debit') row.debitedCents += label.billing.chargeCents
      else row.invoicedCents += label.billing.chargeCents
    }
    return shippingJson({ available: true, months: [...totals.values()], markupPct: LABEL_MARKUP_PCT })
  } catch (error) {
    return flowRefusal(error)
  }
})
