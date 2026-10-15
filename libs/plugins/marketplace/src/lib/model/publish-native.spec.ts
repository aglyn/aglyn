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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  marketplaceMinPriceUsd,
  marketplacePriceFloorHint,
} from './listing-price-floor'
import {
  PUBLISHER_AGREEMENT_CHANGES,
  PUBLISHER_AGREEMENT_POINTS,
  PUBLISHER_AGREEMENT_TITLE,
  PUBLISHER_AGREEMENT_UNAVAILABLE_NOTICE,
  PUBLISHER_AGREEMENT_URL,
  PUBLISHER_AGREEMENT_VERSION,
  publisherAgreementChangesSince,
  publisherAgreementIsPublished,
  publisherAgreementPresentation,
} from './publisher-agreement'

/**
 * The native Publish as template and Publisher Agreement screens (AGL-3671) speak the console's words and call its routes.
 *
 * `marketplace.screens.json` is generated from this plugin's own models, so the agreement's version, title, link, summary
 * points and per-version changes are held to them here, along with the price floor the listing form states, the sentences
 * the console's dialogs show, and the routes and body the console's publish dialog sends. The flow itself is replayed by both
 * renderers (MarketplacePublishTests, MarketplacePublishTest).
 */
interface Screen {
  id: string
  zones?: string[]
  constants?: { agreement?: Record<string, unknown> }
  blocks: Array<{
    type: string
    text?: string
    title?: string
    fields?: Array<{ key: string; help?: string; required?: boolean }>
    submit?: { url: string; body: Record<string, string> }
    items?: Array<{ id?: string; url?: string; body?: Record<string, string>; label?: string }>
    filter?: string
  }>
}

const root = join(__dirname, '../../../../../..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')
const screens = (JSON.parse(read('libs/plugins/marketplace/src/android/screens/marketplace.screens.json')) as { screens: Screen[] }).screens
const screen = (id: string) => screens.find((one) => one.id === id) as Screen
const dialog = read('libs/plugins/marketplace/src/lib/components/publisher-agreement-dialog.component.tsx')
const publishDialog = read('libs/plugins/marketplace/src/lib/components/publish-artifact-dialog.component.tsx')
/** Source with string concatenation joined and whitespace collapsed, so a sentence the dialog builds in pieces reads whole. */
const flat = (source: string) => source.replace(/\s+/g, ' ').replace(/[`'"] \+ [`'"]/g, '')
const agreementClient = read('libs/plugins/marketplace/src/lib/components/publisher-agreement-client.ts')

describe('native publishing to the marketplace', () => {
  it('holds the agreement the console presents, and links it only while it is published', () => {
    const constants = screen('marketplace.publisherAgreement').constants?.agreement
    expect(constants).toEqual({
      title: PUBLISHER_AGREEMENT_TITLE,
      version: PUBLISHER_AGREEMENT_VERSION,
      url: PUBLISHER_AGREEMENT_URL,
      published: publisherAgreementIsPublished(),
      unavailable: PUBLISHER_AGREEMENT_UNAVAILABLE_NOTICE,
      points: PUBLISHER_AGREEMENT_POINTS.map(({ id, label, detail }) => ({ id, label, detail })),
      changes: PUBLISHER_AGREEMENT_CHANGES.map(({ version, changes }) => ({ version, changes: [...changes] })),
    })
    // The same constants ride the screen that offers it.
    expect(screen('marketplace.publishTemplate').constants?.agreement).toEqual(constants)
    expect(publisherAgreementPresentation('none').documentUrl).toBe(constants?.published ? PUBLISHER_AGREEMENT_URL : null)
  })

  it('lists the changes after the version accepted as the console does', () => {
    // The screen filters `version > accepted && version <= current`; the console's helper is the definition.
    for (const accepted of ['2026-08-18.1', '2026-01-01.1', PUBLISHER_AGREEMENT_VERSION]) {
      const expected = publisherAgreementChangesSince(accepted).flatMap((entry) => entry.changes)
      const native = PUBLISHER_AGREEMENT_CHANGES.filter(
        (entry) => entry.version > accepted && entry.version <= PUBLISHER_AGREEMENT_VERSION,
      ).flatMap((entry) => entry.changes)
      expect(native).toEqual(expected)
    }
    const list = screen('marketplace.publisherAgreement').blocks.find((block) => block.title?.startsWith('What changed'))
    expect(list?.filter).toBe('parent.version > data.profile.publisherAgreement.version && parent.version <= const.agreement.version')
  })

  it('says what the console says about where the organization stands', () => {
    const texts = [...screen('marketplace.publishTemplate').blocks, ...screen('marketplace.publisherAgreement').blocks]
      .map((block) => block.text)
      .filter(Boolean) as string[]
    // The dialog builds each sentence from two pieces, so the pieces are what the source holds.
    for (const piece of [
      'These terms have changed since your organization accepted ',
      'Publishing is paused until the current version is accepted.',
      'Your organization has not accepted these terms. ',
      'They must be accepted before anything is published.',
      'Only an owner or admin of your organization can accept ',
    ]) {
      expect(flat(dialog).includes(piece.trim())).toBe(true)
      expect(texts.some((text) => text.includes(piece.trim()))).toBe(true)
    }
    const accepting = `Accepting version {const.agreement.version} binds the organization, not you personally, and we record who accepted and when.`
    expect(flat(dialog).includes('binds the organization, not you personally, and we record who accepted and when.')).toBe(true)
    expect(JSON.stringify(screen('marketplace.publisherAgreement'))).toContain(accepting)
  })

  it('accepts through the route and version the console sends', () => {
    const accept = screen('marketplace.publisherAgreement')
      .blocks.flatMap((block) => block.items ?? [])
      .filter((item) => item.id === 'accept' || item.id === 'acceptCurrent')
    expect(accept.map((item) => item.url)).toEqual(['/api/marketplace/publisher-profile', '/api/marketplace/publisher-profile'])
    for (const item of accept) {
      expect(item.body).toEqual({ action: 'accept-agreement', orgId: '{org.id}', version: '{const.agreement.version}' })
    }
    expect(agreementClient).toContain("'/api/marketplace/publisher-profile'")
    expect(agreementClient).toContain("action: 'accept-agreement'")
    expect(agreementClient).toContain('version: PUBLISHER_AGREEMENT_VERSION')
  })

  it('publishes a site template through the route and listing the console sends', () => {
    const publish = screen('marketplace.publishTemplate')
    expect(publish.zones).toEqual(['siteTemplate'])
    const form = publish.blocks.find((block) => block.type === 'form')
    expect(form?.submit?.url).toBe('/api/marketplace/publish-template')
    expect(publishDialog).toContain("endpoint: 'marketplace/publish-template'")
    expect(publishDialog).toContain('payload: { hostId }')
    // The listing: name, description, category, price, under the keys the dialog uses.
    expect(Object.keys(form?.submit?.body ?? {}).sort()).toEqual(['category', 'description', 'displayName', 'hostId', 'priceUsd'])
    for (const key of ['displayName', 'description', 'category', 'priceUsd']) expect(publishDialog).toContain(key)
    expect(publishDialog).toContain('Published v${payload.version} to the marketplace')
    expect(form?.submit && (form.submit as { success?: string }).success).toBe('Published v{response.version} to the marketplace')
    // The floor the price field states is the one the routes enforce.
    const price = form?.fields?.find((field) => field.key === 'price')
    expect(price?.help).toBe(marketplacePriceFloorHint('Paid listings need payouts set up on your marketplace profile.'))
    expect(price?.help).toContain(`$${marketplaceMinPriceUsd()} and up`)
    expect(form?.fields?.find((field) => field.key === 'name')?.required).toBe(true)
  })
})
