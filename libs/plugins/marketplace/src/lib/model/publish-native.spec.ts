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
import { LISTING_LOGO_HINT } from '../constants/listing-media'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { PLAN_ENTITLEMENTS, resolveMarketplaceFeePct } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { LISTING_CATEGORIES } from './marketplace-catalog'
import { PUBLISHER_ATTESTATION, requiredAttestationIds } from './publisher-attestation'
import {
  marketplaceMinPriceUsd,
  marketplacePriceFloorHint,
} from './listing-price-floor'
import {
  PUBLISHER_AGREEMENT_CHANGES,
  PUBLISHER_AGREEMENT_CONSENT_LABEL,
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
 * the console's dialogs show, and the routes and body the console's publish dialog sends — the publisher agreement box
 * every publish carries above its button (AGL-4105) included. The flow itself is replayed by both renderers
 * (MarketplacePublishTests, MarketplacePublishTest).
 */
interface Screen {
  id: string
  zones?: string[]
  scope?: string
  constants?: { agreement?: Record<string, unknown> }
  blocks: Array<{
    type: string
    when?: string
    text?: string
    title?: string
    fields?: Array<{ key: string; label?: string; kind?: string; coversAll?: boolean; help?: string; required?: boolean; options?: Array<{ value: string; label: string; detail?: string }> }>
    submit?: { url: string; body: Record<string, unknown>; gate?: unknown }
    items?: Array<{ id?: string; url?: string; body?: Record<string, string>; label?: string }>
    filter?: string
  }>
}

const root = join(__dirname, '../../../../../..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')
const screens = (JSON.parse(read('libs/plugins/marketplace/src/android/screens/marketplace.screens.json')) as { screens: Screen[] }).screens
const screen = (id: string) => screens.find((one) => one.id === id) as Screen
const sellerPanel = read('libs/plugins/marketplace/src/lib/components/org-seller-panel.component.tsx')
const publishDialog = read('libs/plugins/marketplace/src/lib/components/publish-artifact-dialog.component.tsx')
/** Source with string concatenation joined and whitespace collapsed, so a sentence the dialog builds in pieces reads whole. */
const flat = (source: string) => source.replace(/\s+/g, ' ').replace(/[`'"] \+ [`'"]/g, '')
/** Every screen that publishes: the site template, each other kind, and a plugin. */
const PUBLISH_SCREENS = [
  'marketplace.publishTemplate',
  'marketplace.publishLayout',
  'marketplace.publishComponent',
  'marketplace.publishTheme',
  'marketplace.publishDatasetSchema',
  'marketplace.publishEmailTemplate',
  'marketplace.publishEmailStarter',
  'marketplace.publishPlugin',
]

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

  it('asks every publish for the agreement with the console\'s box, last in the form, and sends what it was ticked for', () => {
    for (const id of PUBLISH_SCREENS) {
      const form = screen(id).blocks.find((block) => block.type === 'form')
      const fields = form?.fields ?? []
      // The last field, directly above the button, which a form holds until every field is met.
      const box = fields[fields.length - 1]
      expect([id, box?.key, box?.kind, box?.coversAll]).toEqual([id, 'agreement', 'multiselect', true])
      expect(box?.options?.map((option) => [option.value, option.label])).toEqual([['agreed', PUBLISHER_AGREEMENT_CONSENT_LABEL]])
      // The version it agrees to, and that it was ticked — the body the console sends, `publisherAgreementConsent()`.
      expect([id, form?.submit?.body['agreement']]).toEqual([
        id,
        { version: '{const.agreement.version}', accepted: { $if: 'form.agreement', then: true } },
      ])
      // No route refusal opens an agreement any more: there is nothing to accept separately.
      expect([id, form?.submit?.gate]).toEqual([id, undefined])
      expect([id, screen(id).blocks.some((block) => block.when?.includes('is.current'))]).toEqual([id, false])
    }
    expect(publishDialog).toContain('agreement: agreement.consent,')
  })

  it('says on the agreement screen what the console\'s seller panel says', () => {
    const texts = screen('marketplace.publisherAgreement').blocks.map((block) => block.text ?? '')
    const everySave = texts.find((text) => text.startsWith('Every save in the marketplace'))
    expect(everySave).toBeDefined()
    // The panel names "this profile" where the screen, opened from a publish, names "your profile"; the rest is word for word.
    const panel = flat(sellerPanel)
    const [head, tail] = (everySave as string).replace('your profile', 'this profile').split(`“${PUBLISHER_AGREEMENT_CONSENT_LABEL}”`)
    expect(panel).toContain(head)
    expect(panel).toContain(tail)
    expect(panel).toContain('asks you to tick “I agree to the ${PUBLISHER_AGREEMENT_TITLE}” first.')
  })

  it('no screen accepts the agreement once per organization any more', () => {
    const all = JSON.stringify(screens)
    expect(all).not.toContain('accept-agreement')
    expect(all).not.toContain('/api/orgs/members')
  })

  it('publishes a site template through the route and listing the console sends', () => {
    const publish = screen('marketplace.publishTemplate')
    expect(publish.zones).toEqual(['siteTemplate'])
    const form = publish.blocks.find((block) => block.type === 'form')
    expect(form?.submit?.url).toBe('/api/marketplace/publish-template')
    expect(publishDialog).toContain("endpoint: 'marketplace/publish-template'")
    expect(publishDialog).toContain('payload: { hostId }')
    // The listing: name, description, category, price and the agreement, under the keys the dialog uses.
    expect(Object.keys(form?.submit?.body ?? {}).sort()).toEqual(['agreement', 'category', 'description', 'displayName', 'hostId', 'priceUsd'])
    for (const key of ['displayName', 'description', 'category', 'priceUsd']) expect(publishDialog).toContain(key)
    expect(publishDialog).toContain('Published v${payload.version} to the marketplace')
    expect(form?.submit && (form.submit as { success?: string }).success).toBe('Published v{response.version} to the marketplace')
    // The floor the price field states is the one the routes enforce.
    const price = form?.fields?.find((field) => field.key === 'price')
    expect(price?.help).toBe(marketplacePriceFloorHint('Paid listings need payouts set up on your marketplace profile.'))
    expect(price?.help).toContain(`$${marketplaceMinPriceUsd()} and up`)
    expect(form?.fields?.find((field) => field.key === 'name')?.required).toBe(true)
  })

  it('publishes every other artifact kind through the route and payload the console sends', () => {
    const kinds: Array<[string, string, string[]]> = [
      ['marketplace.publishLayout', 'marketplace/publish-layout', ['hostId', 'layoutId']],
      ['marketplace.publishComponent', 'marketplace/publish', ['hostId', 'componentId']],
      ['marketplace.publishTheme', 'marketplace/publish-theme', ['hostId']],
      ['marketplace.publishDatasetSchema', 'marketplace/publish-dataset-schema', ['orgId', 'datasetId']],
      ['marketplace.publishEmailTemplate', 'marketplace/publish-email-template', ['hostId', 'templateKey']],
      ['marketplace.publishEmailStarter', 'marketplace/publish-email-starter', ['hostId', 'screenId']],
    ]
    const source = flat(publishDialog)
    for (const [id, endpoint, keys] of kinds) {
      const one = screen(id)
      const form = one.blocks.find((block) => block.type === 'form')
      expect(form?.submit?.url).toBe(`/api/${endpoint}`)
      // The dialog names the endpoint and then the identifying fields it adds to the listing.
      const payload = new RegExp(`endpoint: '${endpoint}', payload: \\{ ([^}]*) \\}`).exec(source)
      expect(payload).not.toBeNull()
      const named = (payload?.[1] ?? '').split(',').map((entry) => entry.trim().split(':')[0].trim())
      expect(named).toEqual(keys)
      expect(Object.keys(form?.submit?.body ?? {}).sort()).toEqual([...keys, 'agreement', 'category', 'description', 'displayName', 'priceUsd'].sort())
      // The same agreement, price floor and success sentence as the site template's.
      expect(one.constants?.agreement).toEqual(screen('marketplace.publishTemplate').constants?.agreement)
      const price = form?.fields?.find((field) => field.key === 'price')
      expect(price?.help).toBe(marketplacePriceFloorHint('Paid listings need payouts set up on your marketplace profile.'))
      expect(form?.submit && (form.submit as { success?: string }).success).toBe('Published v{response.version} to the marketplace')
      expect(form?.fields?.find((field) => field.key === 'name')?.required).toBe(true)
      expect(one.zones).toBeUndefined()
    }
    // A dataset's schema is the workspace's; every other kind is a site's.
    expect(screen('marketplace.publishDatasetSchema').scope).toBe('org')
    expect(kinds.filter(([id]) => id !== 'marketplace.publishDatasetSchema').every(([id]) => screen(id).scope === 'site')).toBe(true)
  })

  it('edits a listing as the console editor does: the gallery cap, the logo hint and the preview route', () => {
    const editor = read('libs/plugins/marketplace/src/lib/components/listing-detail-editor.component.tsx')
    const cap = /const MAX_SCREENSHOTS = (\d+)/.exec(editor)?.[1]
    expect(cap).toBeDefined()
    const swift = read('libs/plugins/marketplace/src/ios/Sources/AglynMarketplacePlugin/Seller.swift')
    const kotlin = read('libs/plugins/marketplace/src/android/src/commonMain/kotlin/com/aglyn/plugins/marketplace/Seller.kt')
    expect(swift).toContain(`let maxListingScreenshots = ${cap}`)
    expect(kotlin).toContain(`const val MAX_LISTING_SCREENSHOTS = ${cap}`)
    for (const native of [swift, kotlin]) {
      expect(native).toContain(JSON.stringify(LISTING_LOGO_HINT))
      // The preview image has its own route, POST to set and DELETE to remove, as the editor sends it.
      expect(native).toContain('"/api/marketplace/preview-image"')
      expect(native).toContain('"screenshots"')
    }
    expect(editor).toContain("'/api/marketplace/preview-image'")
    expect(editor).toContain("method: values.previewImageUrl ? 'POST' : 'DELETE'")
    expect(editor).toContain('screenshots,')
  })

  it('sends the publisher agreement from every native seller save, ticked in the console\'s box', () => {
    const native = {
      swift: read('libs/plugins/marketplace/src/ios/Sources/AglynMarketplacePlugin/Seller.swift'),
      kotlin: read('libs/plugins/marketplace/src/android/src/commonMain/kotlin/com/aglyn/plugins/marketplace/Seller.kt'),
    }
    const screensOf = {
      swift: read('libs/plugins/marketplace/src/ios/Sources/AglynMarketplacePlugin/SellerScreens.swift'),
      kotlin: read('libs/plugins/marketplace/src/android/src/commonMain/kotlin/com/aglyn/plugins/marketplace/SellerScreens.kt'),
    }
    // The profile, visibility, unpublish ⇄ republish, the listing's content, and the preview set and removed: six requests,
    // each carrying `{ version, accepted: true }` for the version the contracts carry.
    expect(native.swift.match(/"agreement": agreement\.body/g)).toHaveLength(6)
    expect(native.kotlin.match(/"agreement" to agreement\.body/g)).toHaveLength(6)
    expect(native.swift).toContain('ContractValues.shared.publisherAgreementVersion')
    expect(native.kotlin).toContain('Contracts.publisherAgreementVersion')
    for (const source of Object.values(native)) expect(source).toMatch(/"version"[^\n]*"accepted"[^\n]*true/)
    // The box: above Save profile, as the edit sheet's last field, and in the confirmation each one-click change now asks.
    expect(screensOf.swift.match(/PublisherAgreementCheckbox\(isOn: \$agreed/g)).toHaveLength(3)
    expect(screensOf.kotlin.match(/PublisherAgreementCheckbox\(agreed, \{ agreed = it \}/g)).toHaveLength(3)
    for (const source of Object.values(screensOf)) {
      expect(source).toContain('I agree to the ')
      expect(source).not.toContain('It must be accepted before anything is published')
    }
  })

  it('publishes a plugin through the route, fields, statements and price the console form uses', () => {
    const form = read('libs/plugins/marketplace/src/lib/components/publish-plugin-form.component.tsx')
    const source = flat(form)
    const publish = screen('marketplace.publishPlugin') as Screen & { constants?: { categories?: string[]; agreement?: Record<string, unknown> } }
    expect(publish.scope).toBe('org')
    expect(publish.constants?.agreement).toEqual(screen('marketplace.publishTemplate').constants?.agreement)
    expect(publish.constants?.categories).toEqual([...LISTING_CATEGORIES])
    const block = publish.blocks.find((one) => one.type === 'form')
    expect(block?.submit?.url).toBe('/api/marketplace/publish-plugin')
    expect(form).toContain("'/api/marketplace/publish-plugin'")
    // The body the form serializes, key for key.
    const keys = Object.keys(block?.submit?.body ?? {}).sort()
    expect(keys).toEqual(
      ['agreement', 'attestation', 'bundle', 'category', 'changelog', 'description', 'displayName', 'license', 'manifest', 'orgId', 'priceUsd', 'readme', 'repositoryUrl', 'visibility'],
    )
    for (const key of keys) expect(source).toMatch(new RegExp(`\\b${key}\\b`))
    // Every statement, in the model's words; the changelog only on a new version.
    const field = (key: string) => block?.fields?.find((one) => one.key === key)
    const statement = ({ id, label, detail }: (typeof PUBLISHER_ATTESTATION)[number]) => ({ value: id, label, detail })
    expect(field('attested')?.options).toEqual(PUBLISHER_ATTESTATION.filter((item) => !item.updateOnly).map(statement))
    expect(field('attestedUpdate')?.options).toEqual(PUBLISHER_ATTESTATION.map(statement))
    expect(requiredAttestationIds(false)).toEqual(field('attested')?.options?.map((option) => option.value))
    expect(requiredAttestationIds(true)).toEqual(field('attestedUpdate')?.options?.map((option) => option.value))
    expect(field('price')?.help).toBe(marketplacePriceFloorHint('Paid listings need payouts set up.'))
    // The sentences the page shows are the form's own.
    const sentences = [
      ...publish.blocks.map((one) => one.text ?? ''),
      ...(block?.fields ?? [])
        // The agreement box is the shared component's, held above, not the form's own.
        .filter((one) => one.key !== 'agreement')
        .flatMap((one) => [one.label ?? '', one.help ?? '', ...(one.options ?? []).filter((option) => !option.detail).map((option) => option.label)]),
    ].filter((text) => text && !text.includes('{') && text !== 'None')
    const agreementTexts = new Set(screen('marketplace.publishTemplate').blocks.map((one) => one.text))
    for (const text of sentences.filter((one) => !agreementTexts.has(one) && !one.startsWith('0 for free'))) {
      expect([text, source.includes(text)]).toEqual([text, true])
    }
    const live = publish.blocks.find((one) => one.text?.includes('is what installs today'))?.text ?? ''
    expect(source).toContain(live.replace('{data.listing.latestApprovedVersion}', '${liveVersion}').replace(/^v/, 'v'))
  })

  it('states the take rate the publish panel states, from the same resolver the checkout deducts with', () => {
    const panel = flat(read('libs/plugins/marketplace/src/lib/components/org-publish-panel.component.tsx'))
    const hub = screen('marketplace.publish') as Screen & { load?: Record<string, unknown> }
    expect(hub.load?.['fee']).toEqual({ takeRate: 'marketplace', optional: true })
    const said = hub.blocks.filter((one) => one.text?.includes('keeps')).map((one) => one.text)
    expect(said).toEqual([
      `${PLATFORM_BRAND_NAME} keeps {data.fee.pct}% of each sale on your current plan. On a paid plan it is {data.fee.paid}%.`,
      `${PLATFORM_BRAND_NAME} keeps {data.fee.pct}% of each sale. Payment processing fees are charged separately by Stripe.`,
    ])
    expect(panel).toContain('keeps ${feePct}% of each sale on your current plan. On a paid plan it is ${paidFeePct}%.')
    expect(panel).toContain('keeps ${feePct}% of each sale. Payment processing fees are charged separately by Stripe.')
    expect(panel).toContain('const paidFeePct = PLAN_ENTITLEMENTS.starter.marketplaceFeePct')
    // The rates the apps resolve are the console's own answers (replayed by PlanFeaturesTests on both platforms).
    const derived = JSON.parse(read('libs/native/contracts/derived-values.generated.json')) as {
      marketplaceFee: { paid: number; cases: Array<{ org: unknown; result: number }> }
    }
    expect(derived.marketplaceFee.paid).toBe(PLAN_ENTITLEMENTS.starter.marketplaceFeePct)
    for (const { org, result } of derived.marketplaceFee.cases) expect(resolveMarketplaceFeePct(org as never)).toBe(result)
  })

  it('reports a listing or a review in the console dialog\'s words, through its route', () => {
    const dialog = flat(read('libs/plugins/marketplace/src/lib/components/report-target.component.tsx'))
    const swift = read('libs/plugins/marketplace/src/ios/Sources/AglynMarketplacePlugin/MarketplaceScreens.swift')
    const kotlin = read('libs/plugins/marketplace/src/android/src/commonMain/kotlin/com/aglyn/plugins/marketplace/MarketplaceScreens.kt')
    expect(dialog).toContain("'Tell us what is wrong with this ' + (reviewUid ? 'review' : 'listing') + '. A staff member reads every report.'")
    expect(dialog).toContain('Reporting again updates your report rather than adding another one.')
    expect(dialog).toContain("'Thanks — staff will review this report'")
    expect(dialog).toContain("{'Send report'}")
    expect(read('libs/plugins/marketplace/src/lib/components/listing-reviews.component.tsx')).toContain('label={`this review by ${name}`}')
    for (const native of [swift, kotlin]) {
      expect(native).toContain('A staff member reads every report. Reporting again updates your report rather than adding another one.')
      expect(native).toContain('"Thanks — staff will review this report"')
      expect(native).toContain('"Send report"')
      expect(native).toContain('this review by ')
    }
  })
})
