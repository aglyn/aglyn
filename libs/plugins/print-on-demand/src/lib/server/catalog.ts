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

import { pluginProductCatalog } from '@aglyn/aglyn/plugin-manager/plugin-product-catalog'
import { pluginProductWriter, type SourcedProductWriteOutcome } from '@aglyn/aglyn/plugin-manager/plugin-product-writer'
import type { SecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import { POD_COLLECTIONS } from '../constants/bundle-common'
import { POD_PROVIDER_LABELS, podSeoFor, type PodLinkedVariant } from '../model/print-on-demand'
import { PodProviderError } from '../providers/http'
import type { PodSourceProduct } from '../providers/types'
import { notifyHostManagers } from '@aglyn/tenant-data-admin'
import { podProviderFor, readPodKeyring } from './config'
import { copyImagesToLibrary, photosToCopy, type MediaCopyContext } from './media'
import { resolvePodSite } from './site-context'
import {
  linkId,
  linkRef,
  openCredentials,
  readLinksForProducts,
  podDb,
  readConnection,
  readStoredLink,
  type StoredPodConnection,
  type StoredPodLink,
} from './store'

/**
 * A service's products, brought into the store and kept in step (AGL-3641).
 *
 * The store's products are commerce's; they are written through core's
 * `core.product-writer`, so the plan's product allowance, the store's
 * addresses and its search keys hold exactly as for a product typed in.
 * This plugin keeps only the LINK: which store product and variants came
 * from which service product and variants, and what the service charges the
 * merchant for each, so an order can be sent and the margin shown.
 *
 * A new product is born a draft unless the member lists it on import, with
 * the service's retail prices and photos copied into the site's library. A
 * re-sync keeps the merchant's own prices, words and photos unless told
 * otherwise, and always brings the service's configurations, availability
 * and costs, because those decide what an order can be filled with. The job
 * re-syncs each imported product daily.
 *
 * Prices are never converted: a service that prices in another currency
 * than the store's is refused with a sentence that says so.
 *
 * ## Linking a product the store already has
 *
 * A merchant moving from another store often has the products already —
 * copied over with their own photos, words, addresses and search listing.
 * Importing would make a second of each. Linking instead names the store's
 * product: its variants are paired with the service's by SKU, then by the
 * same choices (the writer's rule), and the product keeps everything the
 * merchant wrote, its prices included. A variant the service has and the
 * product did not is added; one the product had and the service does not
 * offer is removed, because nothing could fill it.
 *
 * ## A product the service no longer has
 *
 * When a re-sync is told the product is gone (a 404), the store's product
 * is taken off sale — back to a draft — and the site's managers are told
 * once, so no shopper pays for something nothing will make.
 */

/** How often the job re-syncs an imported product. */
export const POD_LINK_SYNC_MS = 24 * 3_600_000

export type PodImportResult =
  | {
      sourceProductId: string
      outcome: 'created' | 'updated' | 'unchanged'
      productId: string
      name: string
      imagesSkipped: number
      /** On a link: variants paired with ones the product had, and how many the service offers. */
      matched?: number
      offered?: number
    }
  | { sourceProductId: string; outcome: 'failed'; message: string }

function writerRefusal(outcome: Exclude<SourcedProductWriteOutcome, { productId: string }>): string {
  switch (outcome.outcome) {
    case 'missing':
      return 'The store’s product was deleted, so it is no longer filled by the service.'
    case 'plan_limit':
      return `Your plan includes ${outcome.limit} products. Upgrade in Billing to import more.`
    case 'invalid':
      return outcome.message
    default:
      return 'This site does not sell, so products cannot be imported.'
  }
}

async function storeCurrency(hostId: string): Promise<string> {
  const store = await pluginProductCatalog()?.store(hostId).catch(() => null)
  return String(store?.currency ?? 'USD').toUpperCase()
}

/**
 * Imports one service product, or re-syncs the one already imported.
 * `media` copies photos for a new product, or for `content`; a re-sync
 * without a member (the job) copies none.
 */
export async function importSourceProduct(input: {
  hostId: string
  orgId: string
  connection: StoredPodConnection
  keyring: SecretBoxKeyring
  sourceProductId: string
  status?: 'draft' | 'active'
  /** Rewrite name, description and photos on a re-sync. */
  content?: boolean
  media?: MediaCopyContext | null
  actorUid?: string
  currency?: string
  /** A background re-sync: a product the merchant deleted is not made again. */
  background?: boolean
  /**
   * Link the service's product to this store product instead of making a
   * new one: its variants are paired by SKU, then by choices, and the
   * product keeps its own name, words, photos and prices.
   */
  linkProductId?: string
  now?: number
}): Promise<PodImportResult> {
  const { hostId, connection, sourceProductId } = input
  const label = POD_PROVIDER_LABELS[connection.provider]
  const now = input.now ?? Date.now()
  const id = linkId(hostId, connection.provider, sourceProductId)
  const existing = readStoredLink((await linkRef(id).get()).data())
  const writer = pluginProductWriter()
  if (!writer) return { sourceProductId, outcome: 'failed', message: 'This deployment has no store to import products into.' }
  const linking = input.linkProductId ?? null
  if (linking) {
    if (existing && existing.productId !== linking) {
      return {
        sourceProductId,
        outcome: 'failed',
        message: `This ${label} product already fills “${existing.name}” in your store. Unlink it there first.`,
      }
    }
    const other = (await readLinksForProducts(hostId, [linking])).get(linking)
    if (other && other.id !== id) {
      return {
        sourceProductId,
        outcome: 'failed',
        message: `This product is already filled by another ${POD_PROVIDER_LABELS[other.link.provider]} product. Unlink it first.`,
      }
    }
  }

  let product: PodSourceProduct
  try {
    product = await podProviderFor(connection.provider).getProduct(openCredentials(connection, input.keyring), sourceProductId)
  } catch (error) {
    if (existing && error instanceof PodProviderError && error.status === 404) {
      return sourceGone(input, existing, id, label, now)
    }
    const message = error instanceof PodProviderError ? error.message : `${label} could not be read.`
    if (existing) await linkRef(id).set({ lastError: message, syncDueAtMs: now + POD_LINK_SYNC_MS }, { merge: true })
    return { sourceProductId, outcome: 'failed', message }
  }
  const fail = async (message: string): Promise<PodImportResult> => {
    if (existing) await linkRef(id).set({ lastError: message, syncDueAtMs: now + POD_LINK_SYNC_MS }, { merge: true })
    return { sourceProductId, outcome: 'failed', message }
  }
  if (product.variants.length === 0) {
    return fail(`“${product.name}” has no variants turned on at ${label}. Turn one on there first.`)
  }
  const currency = input.currency ?? (await storeCurrency(hostId))
  if (product.currency !== currency) {
    return fail(
      `${label} prices “${product.name}” in ${product.currency} and this store sells in ${currency}. Set both to the same currency first.`,
    )
  }

  // A link keeps the merchant's own photos; an import copies the service's.
  const copyMedia = Boolean(input.media) && !linking && (!existing || input.content === true)
  let mediaUrls: string[] = []
  let variantImages = new Map<string, string>()
  let imagesSkipped = 0
  if (copyMedia && input.media) {
    const variantSources = product.variants.map((variant) => variant.imageUrl).filter((url): url is string => Boolean(url))
    const copied = await copyImagesToLibrary(input.media, product.name, photosToCopy(product.imageUrls, variantSources))
    mediaUrls = product.imageUrls.map((url) => copied.urls.get(url)).filter((url): url is string => Boolean(url))
    variantImages = copied.urls
    imagesSkipped = copied.skipped
  }

  const previous = new Map(
    (existing && existing.productId === (linking ?? existing.productId) ? existing.variants : []).map((variant) => [
      variant.sourceVariantId,
      variant.variantId,
    ]),
  )
  const written = await writer.upsertSourced({
    hostId,
    product: {
      sourceKey: `${connection.provider}:${product.id}`,
      name: product.name,
      description: product.description,
      mediaUrls,
      tags: product.tags,
      seo: podSeoFor(product.name, product.description),
      options: product.options,
      variants: product.variants.map((variant) => ({
        key: variant.id,
        ...(previous.get(variant.id) ? { variantId: previous.get(variant.id) } : {}),
        options: variant.options,
        ...(variant.sku ? { sku: variant.sku } : {}),
        priceMinor: variant.retailMinor,
        ...(variant.weightGrams ? { weightGrams: variant.weightGrams } : {}),
        ...(variant.imageUrl && variantImages.get(variant.imageUrl) ? { imageUrl: variantImages.get(variant.imageUrl) } : {}),
        available: variant.available,
      })),
    },
    ...(linking ? { productId: linking } : existing ? { productId: existing.productId } : {}),
    status: input.status ?? 'draft',
    // A link keeps the store's prices; later re-syncs follow the connection's setting.
    prices: linking ? false : connection.syncPrices,
    content: linking ? false : input.content === true,
    ...(input.background || linking ? { recreate: false } : {}),
    ...(input.actorUid ? { actorUid: input.actorUid } : {}),
  })
  if (written.outcome === 'missing') {
    if (linking && !existing) return { sourceProductId, outcome: 'failed', message: 'That product is no longer in your store.' }
    // The merchant deleted the product: its link goes, so nothing routes to it.
    await linkRef(id).delete()
    return { sourceProductId, outcome: 'failed', message: writerRefusal(written) }
  }
  if (!('productId' in written)) return fail(writerRefusal(written))

  const byKey = new Map(written.variants.map((entry) => [entry.key, entry.variantId]))
  const variants: PodLinkedVariant[] = product.variants.map((variant) => ({
    variantId: byKey.get(variant.id) ?? '',
    sourceVariantId: variant.id,
    name: variant.name,
    sku: variant.sku,
    costMinor: variant.costMinor,
    retailMinor: variant.retailMinor,
    available: variant.available,
  }))
  const thumbnail = mediaUrls[0] ?? existing?.thumbnailUrl ?? null
  // What shipping costs the merchant at the service; a failure keeps what was known.
  const provider = podProviderFor(connection.provider)
  const shippingCosts = provider.getShippingCosts
    ? await provider
        .getShippingCosts(openCredentials(connection, input.keyring), product)
        .catch(() => existing?.shippingCosts ?? [])
    : []
  const link: StoredPodLink = {
    orgId: input.orgId,
    hostId,
    provider: connection.provider,
    productId: written.productId,
    sourceProductId: product.id,
    name: product.name,
    thumbnailUrl: thumbnail,
    costCurrency: product.currency,
    variants,
    shippingCosts,
    sourceGone: false,
    importedByUid: existing?.importedByUid ?? input.actorUid ?? '',
    // A product re-made because the merchant deleted the old one is a new import.
    importedAtMs: existing && existing.productId === written.productId ? existing.importedAtMs : now,
    syncedAtMs: now,
    syncDueAtMs: now + POD_LINK_SYNC_MS,
    lastError: null,
  }
  await linkRef(id).set(link)
  return {
    sourceProductId,
    outcome: written.outcome,
    productId: written.productId,
    name: product.name,
    imagesSkipped,
    ...(linking ? { matched: written.matched ?? 0, offered: product.variants.length } : {}),
  }
}

/**
 * The service says it no longer has the product: the store's product goes
 * off sale, and the managers are told the first time.
 */
async function sourceGone(
  input: { hostId: string; actorUid?: string },
  existing: StoredPodLink,
  id: string,
  label: string,
  now: number,
): Promise<PodImportResult> {
  const message = `${label} no longer has this product, so it was taken off sale. Link it to another ${label} product, or unlink it to sell it yourself.`
  const unlisted = await pluginProductWriter()
    ?.unlistSourced?.({ hostId: input.hostId, productId: existing.productId, ...(input.actorUid ? { actorUid: input.actorUid } : {}) })
    .catch(() => null)
  await linkRef(id).set({ lastError: message, sourceGone: true, syncDueAtMs: now + POD_LINK_SYNC_MS }, { merge: true })
  if (!existing.sourceGone) {
    await notifyHostManagers(input.hostId, {
      type: 'content.lowStock',
      title: `“${existing.name}” is no longer at ${label}`,
      body:
        unlisted === 'unlisted'
          ? `${label} deleted it, so it was taken off sale in your store. Link it to another ${label} product, or unlink it to sell it yourself.`
          : `${label} deleted it. Paid orders for it can no longer be sent; link it to another ${label} product, or unlink it.`,
    }).catch(() => undefined)
  }
  return { sourceProductId: existing.sourceProductId, outcome: 'failed', message }
}

/**
 * The job's share: re-sync each imported product that is due — costs,
 * configurations, availability, and prices where the connection says so.
 */
export async function runPodLinkTick(context: { nowMs: number; deadlineMs: number }): Promise<Record<string, number>> {
  const keyring = readPodKeyring()
  const counts: Record<string, number> = { synced: 0, linkFailed: 0 }
  if (!keyring) return counts
  const snapshot = await podDb()
    .collection(POD_COLLECTIONS.links)
    .where('syncDueAtMs', '<=', context.nowMs)
    .orderBy('syncDueAtMs')
    .limit(20)
    .get()
  for (const doc of snapshot.docs) {
    if (Date.now() >= context.deadlineMs) break
    const link = readStoredLink(doc.data())
    if (!link) continue
    const site = await resolvePodSite(link.hostId)
    const connection = site ? await readConnection(link.hostId, link.provider) : null
    if (!site || !connection) {
      // Nothing to sync with now; look again tomorrow rather than every tick.
      await doc.ref.set({ syncDueAtMs: context.nowMs + POD_LINK_SYNC_MS }, { merge: true })
      continue
    }
    const result = await importSourceProduct({
      hostId: link.hostId,
      orgId: site.orgId,
      connection,
      keyring,
      sourceProductId: link.sourceProductId,
      background: true,
      now: context.nowMs,
    }).catch((error) => ({ outcome: 'failed' as const, message: String((error as Error)?.message ?? error) }))
    if (result.outcome === 'failed') counts['linkFailed'] += 1
    else counts['synced'] += 1
  }
  return counts
}
