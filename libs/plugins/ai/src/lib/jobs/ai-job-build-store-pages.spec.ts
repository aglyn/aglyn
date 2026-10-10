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
 * An Assist build that makes the site a store adds its account, cart and
 * policy pages (AGL-3676): kept on the plan by code, written last by the
 * site start's own code-built unit behind its gate, never twice, and put
 * live with the build's pages when it publishes.
 */

import type { AiBuildPlan, AiBuildPlanScreen } from '../model/ai-build-plan'
import { aiBuildInitialLedger, aiBuildUnits } from '../model/ai-build-job'
import { AI_BUILD_PRODUCT_OP, AI_BUILD_STORE_PAGES_PRESENT_NOTE, aiBuildStorePagesFor } from '../model/ai-build-store-pages'
import type { AiJob, AiJobItemLedger, AiJobOutput, AiJobPlan } from '../model/ai-jobs.types'
import { AI_SITE_STORE_LINKS_INPUT, AI_SITE_STORE_PAGES_NOTE } from '../model/ai-site-store-pages'
import type { AiSiteInventory } from '../model/ai-site-inventory'
import { AI_OWNED_CAPABILITIES } from './ai-build-capabilities'
import { aiBuildStoreLinksOutputs, aiBuildUnitJob, createAiJobBuildStep } from './ai-job-build-step'
import { aiPlanWithStorePages } from './ai-job-plan-step'
import { AI_SITE_STORE_PAGES_INPUT, type AiSiteStorePagesInput } from './ai-job-site-store-pages'
import { AI_JOB_ZERO_USAGE } from './ai-job-generation'
import type { AiJobStepRunner } from './ai-job-text-step'
import type { AiBuildOps } from '../model/ai-build-job'
import type { PluginAiCapability } from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'

const NOW = new Date('2026-10-10T12:00:00.000Z')

const PRODUCT: PluginAiCapability = {
  op: AI_BUILD_PRODUCT_OP,
  noun: 'product',
  where: 'Products → Catalog, as a draft',
  intents: ['a product to sell'],
  argsSchema: { type: 'object', properties: { name: { type: 'string', description: 'Name' } }, required: ['name'], additionalProperties: false },
  maxPerPlan: 12,
  freeAllowed: false,
  feature: 'commerce',
  draftResource: 'product',
  estimateCredits: () => 0,
  degrade: 'omit',
}

const OPS: AiBuildOps = new Map<string, PluginAiCapability>([
  ...AI_OWNED_CAPABILITIES.map((one) => [one.op, one] as const),
  [PRODUCT.op, PRODUCT],
])

const screen = (title: string, slug: string, extra: Partial<AiBuildPlanScreen> = {}): AiBuildPlanScreen => ({
  title,
  slug,
  layout: null,
  template: null,
  duplicateOf: null,
  nav: true,
  seoTitle: title,
  seoDescription: title,
  sections: [{ name: 'Product grid', uses: [], items: 0 }],
  record: null,
  ...extra,
})

function basePlan(): AiBuildPlan {
  return {
    reuse: [],
    create: [],
    screens: [screen('Shop', '/shop', { layout: 'layout-site', id: 'shop-1' } as Partial<AiBuildPlanScreen>)],
    items: [{ slot: 'i0', op: 'product', name: 'Amber candle', why: 'Sold here.', dependsOn: [], degrade: 'omit', args: { name: 'Amber candle' }, id: 'prod-1' }],
  }
}

function plan(): AiJobPlan {
  const base = basePlan()
  return {
    ...base,
    storePages: aiBuildStorePagesFor(base, { store: true, pages: [{ slug: 'privacy', title: 'Privacy' }] }) ?? undefined,
    status: 'confirmed',
    labels: {},
    proposedAt: NOW as never,
    confirmedAt: NOW as never,
    confirmedBy: 'uid-1',
  }
}

/** The ledger with the product and the Shop page built: the store pages are next. */
function ledger(): AiJobItemLedger[] {
  return aiBuildInitialLedger(aiBuildUnits(plan())).map((row) =>
    row.slot === 'i0'
      ? { ...row, status: 'succeeded', outputs: ['prod-1'] }
      : row.slot === 'p0'
        ? { ...row, status: 'succeeded', outputs: ['shop-1'] }
        : row,
  )
}

function job(overrides: Partial<AiJob> = {}): AiJob {
  return {
    $id: 'build-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'build',
    status: 'running',
    brief: 'Make this a store and add a shop.',
    inputs: {},
    steps: [],
    outputs: [
      { resource: 'draft', id: 'prod-1', hostId: 'host-1', label: 'Amber candle', draftResource: 'product' },
      { resource: 'screen', id: 'shop-1', hostId: 'host-1', label: 'Shop', hostSubdomain: 'ember' },
    ],
    creditsReserved: 0,
    creditsSpent: 0,
    createdBy: 'uid-1',
    createdAt: NOW as never,
    updatedAt: NOW as never,
    expiresAt: NOW as never,
    plan: plan(),
    items: ledger(),
    ...overrides,
  }
}

const firestore = {
  collection: () => ({ doc: () => ({ get: async () => ({ data: () => ({}) }) }) }),
} as unknown as FirebaseFirestore.Firestore
const context = (handed: AiJob) => ({ job: handed, stepIndex: 1, now: NOW, firestore, org: { plan: 'pro' as const } })

function storeRunner(seen: AiJob[]): AiJobStepRunner {
  return async ({ job: handed }) => {
    seen.push(handed)
    const input = handed.inputs[AI_SITE_STORE_PAGES_INPUT] as AiSiteStorePagesInput
    const outputs: AiJobOutput[] = input.pages
      .filter((page) => !page.planned)
      .map((page) => ({
        resource: 'screen',
        id: `${handed.$id}-${page.key}`,
        hostId: 'host-1',
        hostSubdomain: 'ember',
        label: page.title,
        proposal: { storePage: page.key, path: page.href },
      }))
    return { outputs, usage: AI_JOB_ZERO_USAGE, estCostUsd: 0, model: 'm', stopReason: 'end_turn' }
  }
}

function step(deps: {
  seen: AiJob[]
  refusal?: string | null
  sitePages?: Array<{ id?: string; slug: string; title: string; layoutId?: string | null }>
  publish?: jest.Mock
  writeStoreLinks?: jest.Mock
}) {
  return createAiJobBuildStep({
    runnerFor: (() => null) as never,
    opsFor: async () => OPS,
    storePages: storeRunner(deps.seen),
    storePagesRefusal: async () => deps.refusal ?? null,
    readSitePages: async () => deps.sitePages ?? [],
    writeStoreLinks: deps.writeStoreLinks ?? (async () => ({ status: 'present', layoutId: 'layout-site' })),
    ...(deps.publish ? { publish: deps.publish } : {}),
  })
}

describe('a build that makes the site a store (AGL-3676)', () => {
  it('writes the store pages the site lacks, last, by code: the Shop page’s layout, no spend, the drafts note', async () => {
    const seen: AiJob[] = []
    const outcome = await step({ seen })(context(job()))
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ $id: 'build-1-store', inputs: { originJobId: 'build-1' } })
    const input = seen[0].inputs[AI_SITE_STORE_PAGES_INPUT] as AiSiteStorePagesInput
    // The site's own Privacy page stands for the privacy policy.
    expect(input.pages.filter((page) => !page.planned).map((page) => page.key)).toEqual(['account', 'cart', 'shipping', 'terms'])
    expect(input.layoutId).toBe('layout-site')
    expect(input.facts.shopPath).toBe('/shop')
    expect(outcome).toMatchObject({
      estCostUsd: 0,
      item: {
        slot: 'store',
        status: 'succeeded',
        outputs: ['build-1-store-account', 'build-1-store-cart', 'build-1-store-shipping', 'build-1-store-terms'],
        note: AI_SITE_STORE_PAGES_NOTE,
      },
    })
    expect(outcome.continue).toBeUndefined()
  })

  it('is refused with the site start’s gate, and writes nothing', async () => {
    const seen: AiJob[] = []
    const outcome = await step({ seen, refusal: 'Your plan does not include a store.' })(context(job()))
    expect(seen).toHaveLength(0)
    expect(outcome.item).toMatchObject({ slot: 'store', status: 'skipped', note: 'Not built: Your plan does not include a store.' })
  })

  it('never writes a page the site gained since the plan, and never mistakes its own for one', async () => {
    const seen: AiJob[] = []
    await step({
      seen,
      sitePages: [
        { id: 'peer-1', slug: 'terms-of-sale', title: 'Terms of sale' },
        { id: 'build-1-store-cart', slug: 'cart', title: 'Your cart' },
      ],
    })(context(job()))
    const input = seen[0].inputs[AI_SITE_STORE_PAGES_INPUT] as AiSiteStorePagesInput
    expect(input.pages.filter((page) => !page.planned).map((page) => page.key)).toEqual(['account', 'cart', 'shipping'])
  })

  it('writes nothing, and says so, where the site has every one by the time it runs', async () => {
    const seen: AiJob[] = []
    const all = ['account', 'cart', 'shipping-returns', 'terms'].map((slug) => ({ slug, title: slug }))
    const outcome = await step({ seen, sitePages: all })(context(job()))
    expect(seen).toHaveLength(0)
    expect(outcome.item).toMatchObject({ slot: 'store', status: 'skipped', note: AI_BUILD_STORE_PAGES_PRESENT_NOTE })
  })

  it('puts them live with the build’s pages when the build publishes', async () => {
    const publish = jest.fn(async () => ({ liveUrl: null, published: [], drafts: [] }))
    await step({ seen: [], publish })(context(job({ inputs: { publish: true, publishConfirmed: true } })))
    const [, input] = publish.mock.calls[0] as unknown as [unknown, { outputs: AiJobOutput[]; unwrittenHrefs?: string[] }]
    expect(input.outputs.map((output) => output.id)).toEqual([
      'shop-1',
      'build-1-store-account',
      'build-1-store-cart',
      'build-1-store-shipping',
      'build-1-store-terms',
    ])
    expect(input.unwrittenHrefs).toBeUndefined()
  })

  it('a layout the build makes links the account and the policies', () => {
    const withLayout: AiJobPlan = {
      ...plan(),
      create: [{ kind: 'layout', name: 'Store layout', why: 'The header.', duplicateOf: null, fields: [] }],
    }
    const units = aiBuildUnits(withLayout)
    const layout = units.find((unit) => unit.creation?.kind === 'layout')
    if (!layout) throw new Error('no layout unit')
    const derived = aiBuildUnitJob(job({ plan: withLayout }), layout, { kind: 'layout', units, ledger: aiBuildInitialLedger(units), ops: OPS })
    expect(derived.inputs[AI_SITE_STORE_LINKS_INPUT]).toMatchObject({
      account: '/account',
      footer: expect.arrayContaining([{ label: 'Privacy', href: '/privacy' }, { label: 'Terms of sale', href: '/terms' }]),
    })
  })
})

describe('the plan a store build keeps (AGL-3676)', () => {
  const inventory = (screens: Array<{ name: string; slug: string }>) =>
    ({ screens: screens.map((one, index) => ({ id: `s${index}`, layoutId: null, template: false, ...one })) }) as Pick<AiSiteInventory, 'screens'>

  it('carries the store pages a site that can sell lacks; none where it cannot, or for any other kind', () => {
    const kept = aiPlanWithStorePages('build', OPS, inventory([{ name: 'Home', slug: '/' }, { name: 'Cart', slug: 'cart' }]), basePlan())
    expect(kept.storePages?.pages.filter((page) => !page.planned).map((page) => page.key)).toEqual(['account', 'shipping', 'privacy', 'terms'])
    const noCommerce = new Map([...OPS].filter(([op]) => op !== AI_BUILD_PRODUCT_OP))
    expect(aiPlanWithStorePages('build', noCommerce, inventory([]), basePlan()).storePages).toBeUndefined()
    expect(aiPlanWithStorePages('page', OPS, inventory([]), basePlan()).storePages).toBeUndefined()
  })

  it('works a reused plan’s store pages out again for this site', () => {
    const reused = { ...basePlan(), storePages: aiBuildStorePagesFor(basePlan(), { store: true, pages: [] }) ?? undefined }
    const all = ['account', 'cart', 'shipping-returns', 'privacy', 'terms'].map((slug) => ({ name: slug, slug }))
    expect(aiPlanWithStorePages('build', OPS, inventory(all), reused).storePages).toBeUndefined()
  })
})

describe('the store’s links in the site’s own header and footer (AGL-3676)', () => {
  const written = (versionId = 'build-1-store-links') =>
    jest.fn(async () => ({ status: 'written', layoutId: 'layout-site', versionId, name: 'Site header and footer' }))

  it('drafts Account, Cart and the policies into the layout the store pages render inside', async () => {
    const writeStoreLinks = written()
    const outcome = await step({ seen: [], writeStoreLinks, sitePages: [{ id: 'priv', slug: 'privacy', title: 'Privacy' }] })(context(job()))
    expect(writeStoreLinks).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        hostId: 'host-1',
        layoutId: 'layout-site',
        versionId: 'build-1-store-links',
        aiJobId: 'build-1',
        screenPaths: { priv: 'privacy' },
        links: {
          header: [{ label: 'Account', href: '/account' }],
          cart: { label: 'Cart', href: '/cart' },
          footer: [
            { label: 'Your account', href: '/account' },
            { label: 'Shipping & returns', href: '/shipping-returns' },
            { label: 'Privacy', href: '/privacy' },
            { label: 'Terms of sale', href: '/terms' },
          ],
        },
      }),
    )
    const layout = outcome.outputs.find((output) => output.resource === 'layout')
    expect(layout).toMatchObject({ id: 'layout-site', versionId: 'build-1-store-links', hostSubdomain: 'ember', proposal: { storeLinks: 'draft' } })
    expect(outcome.item?.outputs).toContain('layout-site')
  })

  it('says so on the first page where the layout has no list for them', async () => {
    const writeStoreLinks = jest.fn(async () => ({ status: 'unrecognized', layoutId: 'layout-site', versionId: null, name: 'Site' }))
    const outcome = await step({ seen: [], writeStoreLinks })(context(job()))
    expect(outcome.outputs[0].proposal).toMatchObject({ storePage: 'account', storeLinks: 'missing' })
    expect(outcome.outputs.some((output) => output.resource === 'layout')).toBe(false)
  })

  it('leaves a layout the build made, which was told the links, and says so where there is no layout at all', async () => {
    const writeStoreLinks = written()
    const store: AiSiteStorePagesInput = {
      pages: aiBuildStorePagesFor(basePlan(), { store: true, pages: [] })?.pages ?? [],
      facts: { contactPath: null, shopPath: '/shop', shippingPath: '/shipping-returns' },
      layoutId: 'lay-new',
    }
    const outputs: AiJobOutput[] = [{ resource: 'screen', id: 'build-1-store-account', hostId: 'host-1', label: 'Your account', proposal: { storePage: 'account' } }]
    const base = { job: job(), unitJobId: 'build-1-store', outputs, sitePages: [], now: NOW }
    expect(await aiBuildStoreLinksOutputs(firestore, { ...base, store, builtLayouts: new Set(['lay-new']) }, writeStoreLinks as never)).toEqual(outputs)
    const none = await aiBuildStoreLinksOutputs(firestore, { ...base, store: { ...store, layoutId: null }, builtLayouts: new Set() }, writeStoreLinks as never)
    expect(none[0].proposal).toMatchObject({ storeLinks: 'missing' })
    expect(writeStoreLinks).not.toHaveBeenCalled()
  })

  it('renders the store pages in the site’s home page’s layout where the plan’s Shop page names none', async () => {
    const seen: AiJob[] = []
    const plain = plan()
    plain.screens = plain.screens.map((one) => ({ ...one, layout: null }))
    await step({ seen, sitePages: [{ id: 'home', slug: '/', title: 'Home', layoutId: 'lay-home' }] })(context(job({ plan: plain })))
    expect((seen[0].inputs[AI_SITE_STORE_PAGES_INPUT] as AiSiteStorePagesInput).layoutId).toBe('lay-home')
  })

  it('hands the draft to the build’s publish, which puts it live', async () => {
    const publish = jest.fn(async () => ({ liveUrl: null, published: [], drafts: [] }))
    await step({ seen: [], publish, writeStoreLinks: written() })(context(job({ inputs: { publish: true, publishConfirmed: true } })))
    expect(publish).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        storeLinks: expect.objectContaining({ layoutId: 'layout-site', versionId: 'build-1-store-links', links: expect.objectContaining({ cart: { label: 'Cart', href: '/cart' } }) }),
      }),
    )
  })
})
