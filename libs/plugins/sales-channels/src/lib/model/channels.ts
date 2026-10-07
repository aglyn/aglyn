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
 * THE SHOPPING CHANNELS (AGL-3637): who reads a feed, in which file format,
 * and what a merchant does on the channel's side to point it at the feed.
 *
 * Client-safe data: the console's cards and the feed route read the same
 * list, so the format a card promises is the format the route serves. What
 * each channel's file holds, attribute by attribute, is `feed-columns.ts`.
 *
 * Formats, as each channel's own specification names them (checked
 * 2026-10-07 against the pages under `specUrl`):
 *
 *  - Google Merchant Center: RSS 2.0 with the `g:` namespace. YouTube
 *    shopping reads the same Merchant Center products, so it has no feed of
 *    its own.
 *  - Meta (Facebook and Instagram): RSS 2.0 with the `g:` namespace, Meta's
 *    own values (`in stock`).
 *  - TikTok: CSV, TikTok's column names (`sku_id`).
 *  - Pinterest: tab-separated.
 *  - Snapchat: CSV.
 *  - Microsoft Merchant Center: tab-delimited text (`.txt`), its native feed
 *    file.
 */

export type SalesChannelId = 'google' | 'meta' | 'tiktok' | 'pinterest' | 'snapchat' | 'microsoft'

export type FeedFormat = 'rss' | 'csv' | 'tsv'

export interface SalesChannelDefinition {
  id: SalesChannelId
  /** The channel, as a merchant knows it. */
  label: string
  /** Where products from the feed appear. */
  reach: string
  format: FeedFormat
  /** The feed file's extension, which is also what the URL ends in. */
  extension: 'xml' | 'csv' | 'tsv' | 'txt'
  contentType: string
  /** What a merchant does on the channel's side, in order. */
  setupSteps: readonly string[]
  /** Where the merchant goes to do it. */
  setupUrl: string
  /** The channel's product data specification. */
  specUrl: string
}

export const SALES_CHANNELS: readonly SalesChannelDefinition[] = [
  {
    id: 'google',
    label: 'Google',
    reach: 'Google Shopping, free listings, Search, Images and YouTube',
    format: 'rss',
    extension: 'xml',
    contentType: 'application/xml; charset=utf-8',
    setupSteps: [
      'Sign in to Google Merchant Center and verify your store’s website there.',
      'Under Products, add products from a file and choose to enter a link to your file.',
      'Paste the feed URL below and set it to fetch daily.',
      'To show products on YouTube, link your YouTube channel to Merchant Center in its settings.',
    ],
    setupUrl: 'https://merchants.google.com/',
    specUrl: 'https://support.google.com/merchants/answer/7052112',
  },
  {
    id: 'meta',
    label: 'Meta',
    reach: 'Facebook and Instagram shops and ads',
    format: 'rss',
    extension: 'xml',
    contentType: 'application/xml; charset=utf-8',
    setupSteps: [
      'Open Commerce Manager and create a catalog for products, or open the one you have.',
      'Under Catalog → Data sources, add items with a data feed and choose a scheduled feed URL.',
      'Paste the feed URL below, choose your store’s currency and an hourly or daily schedule.',
    ],
    setupUrl: 'https://business.facebook.com/commerce/',
    specUrl: 'https://developers.facebook.com/docs/marketing-api/catalog/reference',
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    reach: 'TikTok shopping ads and video shopping',
    format: 'csv',
    extension: 'csv',
    contentType: 'text/csv; charset=utf-8',
    setupSteps: [
      'In TikTok Ads Manager, open Assets → Catalogs and create a catalog, or open yours.',
      'Add products with a data feed and choose a scheduled feed URL.',
      'Paste the feed URL below, set an hourly or daily schedule and choose Replace as the update method.',
    ],
    setupUrl: 'https://ads.tiktok.com/',
    specUrl: 'https://ads.tiktok.com/help/article/catalog-product-parameters',
  },
  {
    id: 'pinterest',
    label: 'Pinterest',
    reach: 'Pinterest product Pins and shopping ads',
    format: 'tsv',
    extension: 'tsv',
    contentType: 'text/tab-separated-values; charset=utf-8',
    setupSteps: [
      'Convert to a Pinterest business account and claim your website.',
      'Under Ads → Catalogs, create a data source.',
      'Paste the feed URL below, choose TSV, your store’s currency and a daily schedule.',
    ],
    setupUrl: 'https://www.pinterest.com/business/catalogs/',
    specUrl: 'https://help.pinterest.com/en/business/article/before-you-get-started-with-catalogs',
  },
  {
    id: 'snapchat',
    label: 'Snapchat',
    reach: 'Snapchat dynamic product ads',
    format: 'csv',
    extension: 'csv',
    contentType: 'text/csv; charset=utf-8',
    setupSteps: [
      'In Snapchat Ads Manager, open Catalogs and create a product catalog.',
      'Choose to add products from a feed URL.',
      'Paste the feed URL below and set a daily schedule.',
    ],
    setupUrl: 'https://ads.snapchat.com/',
    specUrl: 'https://developers.snap.com/marketing-api/Ads-API/dynamic-product-ads',
  },
  {
    id: 'microsoft',
    label: 'Microsoft',
    reach: 'Microsoft Shopping on Bing, Copilot and the Microsoft Audience Network',
    format: 'tsv',
    extension: 'txt',
    contentType: 'text/plain; charset=utf-8',
    setupSteps: [
      'In Microsoft Advertising, open Merchant Center, create a store and verify your website.',
      'Under Catalog → Feeds, create a feed with a scheduled download.',
      'Paste the feed URL below and set it to download daily.',
    ],
    setupUrl: 'https://ads.microsoft.com/',
    specUrl: 'https://help.ads.microsoft.com/apex/index/3/en/51105',
  },
]

export const SALES_CHANNEL_IDS: readonly SalesChannelId[] = SALES_CHANNELS.map((channel) => channel.id)

export function salesChannel(id: unknown): SalesChannelDefinition | undefined {
  return SALES_CHANNELS.find((channel) => channel.id === id)
}
