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
  heldQuantitiesByLine,
  pluginFulfillmentHolds,
} from '@aglyn/aglyn/plugin-manager/plugin-fulfillment-providers'
import type { PluginShippingAddress } from '@aglyn/aglyn/plugin-manager/plugin-shipping-rates'
import {
  pluginShipmentRecords,
  type PluginShippableRecord,
} from '@aglyn/aglyn/plugin-manager/plugin-shipment-records'
import { createHash } from 'node:crypto'
import { SHIPPING_COLLECTIONS, SHIPPING_PLUGIN_ID } from '../constants/bundle-common'
import type { LabelBillingMethod } from '../model/label-billing'
import { isCompleteAddress, type ShippingHostSettings } from '../model/shipping-settings'
import type {
  ProviderAccount,
  ProviderCarrierAccount,
  ProviderCustomsItem,
  ProviderRate,
  ProviderVoidStatus,
  RateBadge,
  SignatureOption,
} from '../providers/types'
import { ShippingProviderError } from '../providers/types'
import { ensureShippingAccount } from './account-store'
import type { ShippingConfig } from './config'
import { orgRef, shippingDb } from './db'
import {
  chargeLabel,
  creditLabel,
  planLabelBilling,
  type LabelBillingRecord,
} from './label-billing'
import { readHostSettings, resolveShipFrom } from './settings-store'
import { trackerDocId } from './trackers'

/**
 * RATING AND BUYING A LABEL FOR ONE RECORD (AGL-3612).
 *
 * The record — an order, as the seller keeps it — is read through core's
 * `core.shipment-records` contract and never from the seller's documents;
 * the shipment is written back through the same contract once the label
 * exists, under the seller's own rules.
 *
 * A quote is kept server-side for the label it may become
 * (`shippingQuoteCache/q_{shipmentId}`): the buy names the shipment and the
 * rate, and the price, the lines and the workspace are read from what the
 * server quoted — never from what the browser sends back.
 *
 * ## Once per attempt
 *
 * A label costs real money the moment the provider answers, so a purchase
 * is claimed first: the label document's id is derived from the workspace,
 * the record and the attempt key the console mints, and it is taken with
 * `create()`. A retry of the same attempt finds it — bought, it replays the
 * label; still buying, it is refused rather than run twice; failed, it may
 * run again. A different attempt is a different label, which is what a
 * merchant buying a second box means.
 */

/** The id a label quote is held under: the provider's shipment id, which a purchase names. */
export function heldQuoteDocId(shipmentId: string): string {
  return `q_${shipmentId}`
}

export interface ShippingActor {
  orgId: string
  org: Record<string, unknown>
  hostId: string
  uid: string
  email: string
  name: string
}

export type LabelKind = 'outbound' | 'return'

export type LabelStatus =
  | 'purchasing'
  | 'purchased'
  | 'failed'
  | 'void_pending'
  | 'voided'
  | 'void_rejected'

export interface StoredLabel {
  labelId: string
  orgId: string
  hostId: string
  recordId: string
  recordRef: string
  kind: LabelKind
  status: LabelStatus
  providerId: string
  mode: 'test' | 'live'
  attemptKey: string
  shipmentId: string
  rateId: string
  providerLabelId?: string
  carrier?: string
  serviceKey?: string
  serviceLabel?: string
  trackingNumber?: string
  trackingUrl?: string
  labelUrl?: string
  commercialInvoiceUrl?: string
  costCents: number
  currency: string
  billing?: LabelBillingRecord
  lines: Array<{ lineIndex: number; quantity: number }>
  weightGrams: number
  packageName?: string
  /** The seller's shipment id, once the shipment is on the record. */
  recordShipmentId?: string
  /** Why the seller refused the shipment, when it did. */
  recordShipmentRefusal?: string
  trackingStatus?: string
  failure?: string
  createdAtMs: number
  createdByUid: string
  purchasedAtMs?: number
  voidRequestedAtMs?: number
  voidedAtMs?: number
  /** `YYYY-MM` the label's charge counts toward. */
  month: string
}

export interface PackageInput {
  presetId?: string
  lengthCm?: number
  widthCm?: number
  heightCm?: number
  /** The whole parcel's weight, box included; absent sums the lines. */
  weightGrams?: number
}

export interface RateRecordInput {
  recordId: string
  kind: LabelKind
  package: PackageInput
  lines?: Array<{ lineIndex: number; quantity: number }>
  insure?: boolean
  signature?: SignatureOption
  /** A corrected delivery address for this label, from address validation. */
  shipTo?: PluginShippingAddress
}

export interface QuotedRate extends ProviderRate {
  /** On a carrier account the merchant connected: billed by the carrier, not here. */
  merchantCarrierAccount: boolean
}

export interface RecordQuote {
  shipmentId: string
  rates: QuotedRate[]
  messages: string[]
  weightGrams: number
  packageName: string
  lines: Array<{ lineIndex: number; quantity: number }>
  from: PluginShippingAddress
  to: PluginShippingAddress
  international: boolean
}

/** A refusal a route answers with its own status and words. */
export class ShippingFlowError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ShippingFlowError'
  }
}

const QUOTE_HOLD_MS = 30 * 60 * 1000

const labelsRef = (orgId: string) => orgRef(orgId).collection(SHIPPING_COLLECTIONS.labels)

const sellerOrThrow = () => {
  const seller = pluginShipmentRecords()
  if (!seller) throw new ShippingFlowError('Nothing on this site sells goods that ship.', 409)
  return seller
}

/** The record, or a 404. */
export async function readRecord(hostId: string, recordId: string): Promise<PluginShippableRecord> {
  const record = await sellerOrThrow().read(hostId, recordId)
  if (!record) throw new ShippingFlowError('That order was not found.', 404)
  return record
}

/**
 * The record with the units an outside fulfiller holds taken off what is left
 * to ship (AGL-3634): a fulfillment network or a supplier that has a line
 * ships it from its own warehouse, and a label for it here would send the
 * customer a second parcel. A fulfiller that cannot say what it holds stops
 * the label rather than being read as holding nothing.
 */
export async function withoutHeldUnits(
  record: PluginShippableRecord,
): Promise<{ record: PluginShippableRecord; heldBy: string[] }> {
  const { holds, unanswered } = await pluginFulfillmentHolds(record.hostId, record.recordId, {
    exceptPluginId: SHIPPING_PLUGIN_ID,
  })
  if (unanswered.length) {
    throw new ShippingFlowError(
      `${unanswered.map((entry) => entry.providerLabel).join(' and ')} could not say which items it is shipping. Try again in a minute.`,
      503,
    )
  }
  if (!holds.length) return { record, heldBy: [] }
  const held = heldQuantitiesByLine(holds)
  return {
    record: {
      ...record,
      lines: record.lines.map((line) => ({
        ...line,
        quantityUnshipped: Math.max(0, line.quantityUnshipped - (held.get(line.lineIndex) ?? 0)),
      })),
    },
    heldBy: [...new Set(holds.map((entry) => entry.providerLabel))],
  }
}

/** The lines a label carries by default: what has not shipped, or for a return what has. */
export function defaultLines(
  record: PluginShippableRecord,
  kind: LabelKind,
): Array<{ lineIndex: number; quantity: number }> {
  return record.lines
    .map((line) => ({
      lineIndex: line.lineIndex,
      quantity: kind === 'return' ? line.quantity - line.quantityUnshipped : line.quantityUnshipped,
    }))
    .filter((line) => line.quantity > 0)
}

/** The lines asked for, bounded by what the record has left to ship (or to return). */
export function boundLines(
  record: PluginShippableRecord,
  kind: LabelKind,
  asked: Array<{ lineIndex: number; quantity: number }> | undefined,
): Array<{ lineIndex: number; quantity: number }> {
  const available = new Map(defaultLines(record, kind).map((line) => [line.lineIndex, line.quantity]))
  if (!asked?.length) return defaultLines(record, kind)
  const bounded: Array<{ lineIndex: number; quantity: number }> = []
  for (const line of asked) {
    const most = available.get(Number(line.lineIndex)) ?? 0
    const quantity = Math.min(most, Math.max(0, Math.floor(Number(line.quantity) || 0)))
    if (quantity > 0) bounded.push({ lineIndex: Number(line.lineIndex), quantity })
  }
  return bounded
}

/** Goods weight of the chosen lines, in grams. */
export function linesWeightGrams(
  record: PluginShippableRecord,
  lines: Array<{ lineIndex: number; quantity: number }>,
): number {
  return lines.reduce((sum, chosen) => {
    const line = record.lines.find((one) => one.lineIndex === chosen.lineIndex)
    return sum + Math.max(0, Number(line?.weightGrams ?? 0)) * chosen.quantity
  }, 0)
}

function linesValueCents(
  record: PluginShippableRecord,
  lines: Array<{ lineIndex: number; quantity: number }>,
): number {
  return lines.reduce((sum, chosen) => {
    const line = record.lines.find((one) => one.lineIndex === chosen.lineIndex)
    return sum + Math.max(0, Number(line?.unitValueCents ?? 0)) * chosen.quantity
  }, 0)
}

function customsItems(
  record: PluginShippableRecord,
  lines: Array<{ lineIndex: number; quantity: number }>,
  fallbackOrigin: string,
): ProviderCustomsItem[] {
  return lines.map((chosen) => {
    const line = record.lines.find((one) => one.lineIndex === chosen.lineIndex)
    return {
      description: String(line?.name ?? 'Merchandise'),
      quantity: chosen.quantity,
      valueCents: Math.max(0, Number(line?.unitValueCents ?? 0)) * chosen.quantity,
      weightGrams: Math.max(1, Number(line?.weightGrams ?? 0) * chosen.quantity),
      ...(line?.hsCode ? { hsCode: line.hsCode } : {}),
      originCountry: line?.originCountry || fallbackOrigin,
    }
  })
}

const carrierAccountCache = new Map<string, { at: number; accounts: ProviderCarrierAccount[] }>()

async function carrierAccounts(
  orgId: string,
  config: ShippingConfig,
  account: ProviderAccount,
): Promise<ProviderCarrierAccount[]> {
  const key = `${orgId}:${config.providerId}`
  const hit = carrierAccountCache.get(key)
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.accounts
  const accounts = await config.provider.listCarrierAccounts(account).catch(() => [])
  carrierAccountCache.set(key, { at: Date.now(), accounts })
  return accounts
}

/** Forgets a workspace's carrier accounts, after a member changed them. */
export function forgetCarrierAccounts(orgId: string): void {
  for (const key of [...carrierAccountCache.keys()]) {
    if (key.startsWith(`${orgId}:`)) carrierAccountCache.delete(key)
  }
}

/** Rates for a label on one record, held server-side for the buy. */
export async function rateRecord(
  actor: ShippingActor,
  config: ShippingConfig,
  input: RateRecordInput,
  settingsArg?: ShippingHostSettings,
): Promise<RecordQuote> {
  const read = await readRecord(actor.hostId, input.recordId)
  if (input.kind === 'outbound' && !read.shippable) {
    throw new ShippingFlowError(`Orders that are ${read.status} can’t be shipped.`, 409)
  }
  const { record, heldBy } = input.kind === 'outbound' ? await withoutHeldUnits(read) : { record: read, heldBy: [] }
  const settings = settingsArg ?? (await readHostSettings(actor.orgId, actor.hostId))
  const shipFrom = await resolveShipFrom(actor.hostId, settings)
  if (!shipFrom) {
    throw new ShippingFlowError('Add the address you ship from in Shipping settings first.', 409)
  }
  const delivery = input.kind === 'outbound' && isCompleteAddress(input.shipTo) ? input.shipTo : record.shipTo
  if (!isCompleteAddress(delivery)) {
    throw new ShippingFlowError('This order has no complete shipping address.', 409)
  }
  const shipTo = {
    ...(delivery as PluginShippingAddress),
    ...(record.customerEmail && !delivery?.email ? { email: record.customerEmail } : {}),
  }
  const lines = boundLines(record, input.kind, input.lines)
  if (!lines.length) {
    throw new ShippingFlowError(
      input.kind === 'return'
        ? 'Nothing on this order has shipped yet.'
        : heldBy.length
          ? `Everything left on this order is being shipped by ${heldBy.join(' and ')}.`
          : 'Everything on this order has shipped.',
      409,
    )
  }
  const preset =
    settings.packages.find((box) => box.id === input.package.presetId) ??
    settings.packages.find((box) => box.id === settings.defaultPackageId) ??
    settings.packages[0]
  const custom = Boolean(input.package.lengthCm && input.package.widthCm && input.package.heightCm)
  const lengthCm = custom ? Number(input.package.lengthCm) : preset.lengthCm
  const widthCm = custom ? Number(input.package.widthCm) : preset.widthCm
  const heightCm = custom ? Number(input.package.heightCm) : preset.heightCm
  const weightGrams = Math.max(
    1,
    Math.round(
      input.package.weightGrams && input.package.weightGrams > 0
        ? input.package.weightGrams
        : linesWeightGrams(record, lines) + (custom ? 0 : preset.emptyWeightGrams),
    ),
  )
  const from = input.kind === 'return' ? shipTo : shipFrom
  const to = input.kind === 'return' ? shipFrom : shipTo
  const international = from.country !== to.country
  const valueCents = linesValueCents(record, lines)
  const insure = input.insure ?? settings.insurance === 'order_value'
  const account = await ensureShippingAccount(actor.orgId, config, {
    name: actor.name,
    email: actor.email,
    company: String(actor.org['name'] ?? actor.name),
    uid: actor.uid,
  })
  const signature = input.signature ?? settings.signature
  const quote = await config.provider.quoteRates(account, {
    from,
    to,
    parcels: [{ weightGrams, lengthCm, widthCm, heightCm }],
    currency: record.currency,
    valueCents,
    ...(insure && valueCents > 0 ? { insuranceCents: valueCents } : {}),
    ...(signature !== 'none' ? { signature } : {}),
    ...(input.kind === 'return' ? { isReturn: true } : {}),
    ...(international
      ? {
          customs: {
            items: customsItems(record, lines, shipFrom.country),
            signer: settings.customsSigner || actor.name,
          },
        }
      : {}),
  })
  const owned = await carrierAccounts(actor.orgId, config, account)
  const rates: QuotedRate[] = quote.rates.map((rate) => {
    const carrierAccount = owned.find((one) => one.id === rate.carrierAccountId)
    return { ...rate, merchantCarrierAccount: carrierAccount ? !carrierAccount.platformOwned : false }
  })
  const result: RecordQuote = {
    shipmentId: quote.shipmentId,
    rates,
    messages: quote.messages,
    weightGrams,
    packageName: custom ? 'Custom box' : preset.name,
    lines,
    from,
    to,
    international,
  }
  if (quote.shipmentId) {
    await shippingDb()
      .collection(SHIPPING_COLLECTIONS.quoteCache)
      .doc(heldQuoteDocId(quote.shipmentId))
      .set({
        orgId: actor.orgId,
        hostId: actor.hostId,
        recordId: input.recordId,
        kind: input.kind,
        quote: result,
        insuranceCents: insure && valueCents > 0 ? valueCents : 0,
        expiresAtMs: Date.now() + QUOTE_HOLD_MS,
        expiresAt: new Date(Date.now() + QUOTE_HOLD_MS),
      })
  }
  return result
}

/** The label document's id for one attempt. */
export function labelIdFor(orgId: string, recordId: string, attemptKey: string): string {
  return `lbl_${createHash('sha256').update(`${orgId}\n${recordId}\n${attemptKey}`).digest('hex').slice(0, 32)}`
}

export interface BuyLabelInput {
  recordId: string
  shipmentId: string
  rateId: string
  attemptKey: string
}

export type BuyLabelResult = { label: StoredLabel; replayed: boolean }

/** Buys the label, writes the shipment back, starts tracking and recovers the cost. */
export async function buyLabel(
  actor: ShippingActor,
  config: ShippingConfig,
  input: BuyLabelInput,
): Promise<BuyLabelResult> {
  const attemptKey = String(input.attemptKey ?? '').trim()
  if (!/^[A-Za-z0-9:_-]{8,120}$/.test(attemptKey)) {
    throw new ShippingFlowError('A label purchase needs an attempt key.', 400)
  }
  const held = await shippingDb()
    .collection(SHIPPING_COLLECTIONS.quoteCache)
    .doc(heldQuoteDocId(String(input.shipmentId)))
    .get()
  const hold = held.data() as
    | { orgId: string; hostId: string; recordId: string; kind: LabelKind; quote: RecordQuote; insuranceCents: number; expiresAtMs: number }
    | undefined
  // The quote is the workspace's own, for this record, and still fresh: a
  // shipment id from another workspace, or another order, buys nothing.
  if (
    !hold ||
    hold.orgId !== actor.orgId ||
    hold.hostId !== actor.hostId ||
    hold.recordId !== input.recordId ||
    hold.expiresAtMs < Date.now()
  ) {
    throw new ShippingFlowError('Those rates have expired. Get rates again.', 409)
  }
  const rate = hold.quote.rates.find((one) => one.rateId === input.rateId)
  if (!rate) throw new ShippingFlowError('That rate is not one of the quoted rates.', 400)

  const labelId = labelIdFor(actor.orgId, input.recordId, attemptKey)
  const ref = labelsRef(actor.orgId).doc(labelId)
  const record = await readRecord(actor.hostId, input.recordId)
  if (hold.kind === 'outbound') {
    // An outside fulfiller may have taken lines since the quote (AGL-3634).
    const { record: free, heldBy } = await withoutHeldUnits(record)
    const fits = hold.quote.lines.every(
      (chosen) => chosen.quantity <= (free.lines.find((line) => line.lineIndex === chosen.lineIndex)?.quantityUnshipped ?? 0),
    )
    if (heldBy.length && !fits) {
      throw new ShippingFlowError(`Some of these items are now being shipped by ${heldBy.join(' and ')}. Get rates again.`, 409)
    }
  }
  const nowMs = Date.now()
  const pending: StoredLabel = {
    labelId,
    orgId: actor.orgId,
    hostId: actor.hostId,
    recordId: input.recordId,
    recordRef: record.displayRef,
    kind: hold.kind,
    status: 'purchasing',
    providerId: config.providerId,
    mode: config.testMode ? 'test' : 'live',
    attemptKey,
    shipmentId: input.shipmentId,
    rateId: input.rateId,
    costCents: rate.amountCents,
    currency: rate.currency,
    lines: hold.quote.lines,
    weightGrams: hold.quote.weightGrams,
    packageName: hold.quote.packageName,
    createdAtMs: nowMs,
    createdByUid: actor.uid,
    month: new Date(nowMs).toISOString().slice(0, 7),
  }
  try {
    await ref.create(pending)
  } catch {
    const prior = (await ref.get()).data() as StoredLabel | undefined
    if (prior?.status === 'purchasing') {
      throw new ShippingFlowError('This label is already being bought.', 409)
    }
    if (prior && prior.status !== 'failed') return { label: prior, replayed: true }
    await ref.set(pending)
  }

  const plan = await planLabelBilling({
    orgId: actor.orgId,
    org: actor.org,
    config,
    costCents: rate.amountCents,
    merchantCarrierAccount: rate.merchantCarrierAccount,
  })
  if ('refused' in plan) {
    await ref.delete().catch(() => undefined)
    throw new ShippingFlowError(plan.message, 402)
  }

  const account = await ensureShippingAccount(actor.orgId, config, {
    name: actor.name,
    email: actor.email,
    company: String(actor.org['name'] ?? actor.name),
    uid: actor.uid,
  })
  const settings = await readHostSettings(actor.orgId, actor.hostId)
  let bought
  try {
    bought = await config.provider.buyLabel(account, {
      shipmentId: input.shipmentId,
      rateId: input.rateId,
      format: settings.labelFormat,
      ...(hold.insuranceCents > 0 ? { insuranceCents: hold.insuranceCents } : {}),
      reference: `${actor.hostId}/${input.recordId}/${labelId}`,
    })
  } catch (error) {
    const message =
      error instanceof ShippingProviderError
        ? error.detail || error.message
        : 'The label could not be bought.'
    await ref.set({ status: 'failed', failure: message.slice(0, 300) }, { merge: true })
    throw new ShippingFlowError(message, 502)
  }
  const costCents = bought.amountCents > 0 ? bought.amountCents : rate.amountCents
  const purchased: Partial<StoredLabel> = {
    status: 'purchased',
    providerLabelId: bought.providerLabelId,
    carrier: bought.carrier || rate.carrier,
    serviceKey: bought.serviceKey || rate.serviceKey,
    serviceLabel: bought.serviceLabel || rate.label,
    trackingNumber: bought.trackingNumber,
    ...(bought.trackingUrl ? { trackingUrl: bought.trackingUrl } : {}),
    labelUrl: bought.labelUrl,
    ...(bought.commercialInvoiceUrl ? { commercialInvoiceUrl: bought.commercialInvoiceUrl } : {}),
    costCents,
    currency: bought.currency || rate.currency,
    purchasedAtMs: Date.now(),
  }
  await ref.set(purchased, { merge: true })

  // The parcel is real now; everything below is bookkeeping that must not
  // lose it. Each step records its own outcome on the label.
  if (bought.trackingNumber) {
    await shippingDb()
      .collection(SHIPPING_COLLECTIONS.trackers)
      .doc(trackerDocId(config.providerId, bought.trackingNumber))
      .set({
        orgId: actor.orgId,
        hostId: actor.hostId,
        recordId: input.recordId,
        labelId,
        providerId: config.providerId,
        carrier: purchased.carrier,
        trackingNumber: bought.trackingNumber,
        kind: hold.kind,
        createdAtMs: Date.now(),
      })
      .catch(() => undefined)
  }
  if (hold.kind === 'outbound') {
    try {
      const written = await sellerOrThrow().recordShipment({
        hostId: actor.hostId,
        recordId: input.recordId,
        lines: hold.quote.lines,
        carrier: String(purchased.carrier ?? ''),
        trackingNumber: bought.trackingNumber,
        ...(bought.trackingUrl ? { trackingUrl: bought.trackingUrl } : {}),
        ...(/^https:\/\//.test(bought.labelUrl) ? { labelUrl: bought.labelUrl } : {}),
        labelRef: labelId,
        actorUid: actor.uid,
      })
      await ref.set(
        written.outcome === 'recorded' || written.outcome === 'already'
          ? { recordShipmentId: written.shipmentId ?? null }
          : {
              recordShipmentRefusal:
                written.outcome === 'blocked' ? `The order is ${written.from}` : 'The order is gone',
            },
        { merge: true },
      )
    } catch (error) {
      await ref.set({ recordShipmentRefusal: 'The order could not be updated' }, { merge: true })
      console.error('[shipping] recording the shipment failed', { labelId }, error)
    }
  }
  const billing = await chargeLabel({
    labelId,
    plan,
    currency: String(purchased.currency),
    description: `Shipping label ${String(purchased.trackingNumber ?? '')} for ${record.displayRef}`,
  })
  await ref.set({ billing }, { merge: true })
  const label = (await ref.get()).data() as StoredLabel
  return { label, replayed: false }
}

/** Voids a label within the carrier's window, and credits it once refunded. */
export async function voidLabel(
  actor: Pick<ShippingActor, 'orgId' | 'hostId' | 'uid'>,
  config: ShippingConfig,
  labelId: string,
  account: ProviderAccount,
): Promise<StoredLabel> {
  const ref = labelsRef(actor.orgId).doc(labelId)
  const label = (await ref.get()).data() as StoredLabel | undefined
  if (!label || label.hostId !== actor.hostId) throw new ShippingFlowError('That label was not found.', 404)
  if (label.status === 'voided' || label.status === 'void_pending') return label
  if (label.status !== 'purchased' && label.status !== 'void_rejected') {
    throw new ShippingFlowError('Only a bought label can be voided.', 409)
  }
  let status: ProviderVoidStatus
  try {
    status = await config.provider.voidLabel(account, {
      providerLabelId: String(label.providerLabelId ?? ''),
      shipmentId: label.shipmentId,
    })
  } catch (error) {
    const message =
      error instanceof ShippingProviderError ? error.detail || error.message : 'The label could not be voided.'
    throw new ShippingFlowError(message, 502)
  }
  return (await settleVoid(actor.orgId, labelId, status)) ?? label
}

/** Records a void's state, and gives the charge back once the provider refunded. */
export async function settleVoid(
  orgId: string,
  labelId: string,
  status: ProviderVoidStatus,
): Promise<StoredLabel | null> {
  const ref = labelsRef(orgId).doc(labelId)
  const label = (await ref.get()).data() as StoredLabel | undefined
  // A provider redelivers and reorders refund events: a label nobody here
  // holds has nothing to settle, and a voided one is final — a late
  // rejection or pending must not walk it back.
  if (!label) return null
  if (label.status === 'voided') return label
  const nowMs = Date.now()
  if (status === 'rejected') {
    await ref.set({ status: 'void_rejected', voidRequestedAtMs: nowMs }, { merge: true })
  } else if (status === 'pending') {
    await ref.set({ status: 'void_pending', voidRequestedAtMs: label.voidRequestedAtMs ?? nowMs }, { merge: true })
  } else {
    const billing = label.billing ? await creditLabel({ labelId, billing: label.billing }) : undefined
    await ref.set({ status: 'voided', voidedAtMs: nowMs, ...(billing ? { billing } : {}) }, { merge: true })
  }
  return (await ref.get()).data() as StoredLabel
}

/** A record's labels, newest first. */
export async function listRecordLabels(orgId: string, hostId: string, recordId: string): Promise<StoredLabel[]> {
  const snapshot = await labelsRef(orgId)
    .where('hostId', '==', hostId)
    .where('recordId', '==', recordId)
    .orderBy('createdAtMs', 'desc')
    .limit(50)
    .get()
  return snapshot.docs.map((doc) => doc.data() as StoredLabel)
}

/** Badges a merchant reads beside a rate. */
export function rateBadges(rates: QuotedRate[]): Record<string, RateBadge[]> {
  return Object.fromEntries(rates.map((rate) => [rate.rateId, rate.badges]))
}

/** Which billing methods take money from the merchant. */
export const BILLED_METHODS: readonly LabelBillingMethod[] = ['account_debit', 'usage_invoice']
