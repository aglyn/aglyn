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
 * A site start in another language always ends up with English words for
 * its photos (AGL-3779). Two Spanish bakery starts on beta.250, Panaderia La
 * Molienda (job ih6kVvCGP1) and Panaderia El Trigal (iGmqrEgyW4), planned
 * with `language: "es"` and no `photoWords`, so their photos were searched
 * by the kind of site picked, "restaurant cafe", and a bakery's hero was a
 * coffee mug. Now the plan is asked once more for its photo words, and a plan
 * that still gives none is searched by its business type in English.
 *
 * The plan step runs here on golden answers through its real doctrine and
 * re-ask, the photos on Pixabay's recorded answer for "bakery". No network,
 * no model.
 */

const mockRunAiRequest = jest.fn()

jest.mock('../runtime/ai-runtime', () => ({
  __esModule: true,
  ...jest.requireActual('../runtime/ai-runtime'),
  runAiRequest: (...args: unknown[]) => mockRunAiRequest(...args),
}))

jest.mock('../providers/routing', () => {
  const catalog = jest.requireActual('../providers/catalog')
  return {
    __esModule: true,
    ...jest.requireActual('../providers/routing'),
    aiModelForStep: (kind: string) =>
      catalog.AI_MODEL_CATALOG.find((entry: { tier: string }) => entry.tier === catalog.AI_STEP_TIERS[kind])?.id,
  }
})

jest.mock('../runtime/site-inventory', () => ({ __esModule: true, readSiteInventory: jest.fn() }))
jest.mock('./ai-jobs', () => ({
  __esModule: true,
  AI_JOBS_COLLECTION: 'aiJobs',
  registerAiJobStep: jest.fn(),
  registerAiJobPlanStep: jest.fn(),
}))

import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import type { PluginMediaIngest } from '@aglyn/aglyn/plugin-manager/plugin-media-ingest'
import type { StockPhoto, StockPhotoProvider } from '@aglyn/aglyn/plugin-manager/stock-photo-provider'
import type { AiLayoutPictureSlot } from '../layout-language/ai-layout-pictures'
import { AI_BUILD_PLAN_TOOL, aiBuildPlanToolFor, parseAiBuildPlan } from '../model/ai-build-plan'
import type { AiJob } from '../model/ai-jobs.types'
import type { AiPlanCapabilities } from '../model/ai-plan-capabilities'
import { emptyAiSiteInventory, type AiSiteInventory } from '../model/ai-site-inventory'
import { aiEvalMemoryFirestore } from '../runtime/ai-eval-memory-firestore'
import { aiPlanCapabilitiesFrom } from './ai-job-drafts'
import {
  AI_SITE_PHOTO_WORDS_CODE,
  aiSitePhotoWordsCheck,
  aiSitePhotoWordsViolations,
  createAiJobPlanStep,
} from './ai-job-plan-step'
import {
  aiLayoutStockPhotoSource,
  aiStockForgetJobPhotos,
  aiStockPhotoWordsOf,
  aiStockPhotoWordsSubject,
  aiStockSearchesFor,
  aiStockSiteTerms,
  aiStockSourceTerms,
} from './ai-layout-stock-photos'
import { AI_STOCK_BUSINESS_NOUNS, aiStockBusinessNoun } from './ai-stock-business-nouns'
import { AI_CERAMICS_PORTFOLIO_SITE_PLAN } from './fixtures/ai-ceramics-portfolio-site-plan'
import { BAKERY } from './fixtures/ai-stock-photo-agl3769-recordings'

const NOW = new Date('2026-10-14T01:16:11.057Z')

/** Panaderia La Molienda's business type, as job ih6kVvCGP1 holds it. */
const BUSINESS_TYPE =
  'Una panadería familiar de San Antonio con pan dulce, conchas y pasteles de tres leches al estilo de Oaxaca'
const AUDIENCE = 'Familias de San Antonio que buscan pan fresco cada mañana y pasteles para cumpleaños, bodas y quinceañeras'

/** Job ih6kVvCGP1 as production holds it: its brief and inputs, verbatim. */
function bakeryJob(): AiJob {
  return {
    $id: 'ih6kVvCGP1',
    orgId: 'jWmGooWE3L',
    hostId: 'Mb_mBfl9k1',
    kind: 'site',
    status: 'running',
    brief: `A 5-page website for ${BUSINESS_TYPE}. It is for ${AUDIENCE}. Make it a restaurant & café site. Plan a page for each thing a visitor comes to do, and a contact form on the page that asks to be contacted. Ask the contact form for what ${AUDIENCE} would be asked for.`,
    inputs: {
      businessType: BUSINESS_TYPE,
      audience: AUDIENCE,
      starter: 'business',
      siteKind: 'restaurant',
      pages: 5,
      businessName: 'Panaderia La Molienda',
      city: '',
      brand: '',
      submissions: 'lead',
      welcomeEmail: true,
      autoConfirm: true,
    },
    steps: [{ name: 'plan', status: 'running', creditsSpent: 0 }],
    outputs: [],
    creditsReserved: 120,
    creditsSpent: 0,
    createdBy: 'uid-1',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
  } as unknown as AiJob
}

const PAID_ORG: Partial<AglynOrgBilling> = { plan: 'pro' }
/** A site as provisioning leaves it (AGL-3497): its layout and its untouched starter home. */
const NEW_SITE: AiSiteInventory = {
  ...emptyAiSiteInventory('Mb_mBfl9k1'),
  layouts: [{ id: 'laySite', name: 'Site layout', parentId: null }],
  screens: [{ id: 'scrStarter', name: 'Home', slug: '/', layoutId: 'laySite', template: false, replaceable: true }],
}
const PAID: AiPlanCapabilities = aiPlanCapabilitiesFrom(PAID_ORG, {
  layout: [{ id: 'laySite', kind: undefined, sourceType: undefined, deletedAt: undefined }],
  template: [],
})

const ZERO_USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
const toolAnswer = (input: unknown) => ({
  kind: 'completion',
  text: '',
  toolUse: [{ name: AI_BUILD_PLAN_TOOL.name, input }],
  usage: ZERO_USAGE,
  estCostUsd: 0,
  stopReason: 'tool_use',
})

/** A plan the site step keeps on its first answer, in the language and photo words given. */
const answer = (fields: { language: string | null; photoWords: string | null }) => ({ ...AI_CERAMICS_PORTFOLIO_SITE_PLAN, ...fields })

const planStep = () =>
  createAiJobPlanStep({
    readInventory: async () => NEW_SITE,
    findPlansByKey: null,
    readCapabilities: async () => PAID,
    admissionRefusal: async () => null,
    readSiteContext: null,
    readSiteEvents: null,
  })

const runPlan = () =>
  planStep()({ job: bakeryJob(), stepIndex: 0, now: NOW, firestore: aiEvalMemoryFirestore({}).firestore, org: PAID_ORG })

/** The text of the re-ask the step sent, if it sent one. */
const reaskOf = () => JSON.stringify(mockRunAiRequest.mock.calls[1]?.[0]?.messages?.slice(1) ?? [])

beforeEach(() => {
  mockRunAiRequest.mockReset()
  aiStockForgetJobPhotos()
})

describe('a site plan’s tool asks for English photo words whenever its language is not English', () => {
  const tool = aiBuildPlanToolFor(bakeryJob().brief, { language: true })
  const photoWords = (tool.inputSchema['properties'] as Record<string, { description: string }>)['photoWords']

  it('lists photoWords as a required field beside the language, on a site plan only', () => {
    expect(tool.inputSchema['required']).toEqual(expect.arrayContaining(['language', 'photoWords']))
    expect(aiBuildPlanToolFor(bakeryJob().brief).inputSchema['properties']).not.toHaveProperty('photoWords')
  })

  it('says they are required when the language is not en, what they name, and that only an English plan says null', () => {
    expect(photoWords.description).toBe(
      'Required when language is not en: 2-4 English words, the kind of business first, then what it sells, e.g. florist wedding bouquets; never a place or the business name. Null when language is en.',
    )
    // Strict structured output compiles no conditional keyword, so null stays a branch and the plan step holds the rule.
    expect(JSON.stringify(photoWords)).toContain('"type":"null"')
  })

  it.each(['es', 'fr', 'pt', 'de', 'it', 'pt-BR'])('holds a %s plan to giving them', (language) => {
    expect(aiSitePhotoWordsViolations({ language }).map((violation) => violation.code)).toEqual([AI_SITE_PHOTO_WORDS_CODE])
    expect(aiSitePhotoWordsViolations({ language })[0]?.message).toContain(`language is ${language}, so photoWords is required`)
    expect(aiSitePhotoWordsViolations({ language, photoWords: 'bakery pastries' })).toEqual([])
  })

  it('holds an English plan, and one whose language is unknown, to nothing', () => {
    expect(aiSitePhotoWordsViolations({ language: 'en' })).toEqual([])
    expect(aiSitePhotoWordsViolations({ language: 'en-US' })).toEqual([])
    expect(aiSitePhotoWordsViolations({})).toEqual([])
  })

  it('counts words that are not plain English, which the plan’s reader drops, as none', () => {
    const parsed = parseAiBuildPlan(answer({ language: 'es', photoWords: 'panadería pasteles' }))
    if (!parsed.ok) throw new Error('the answer did not parse')
    expect(parsed.plan).not.toHaveProperty('photoWords')
    expect(aiSitePhotoWordsViolations(parsed.plan).map((violation) => violation.code)).toEqual([AI_SITE_PHOTO_WORDS_CODE])
  })

  it('asks on the first answer only', () => {
    const check = aiSitePhotoWordsCheck()
    const plan = { ...AI_CERAMICS_PORTFOLIO_SITE_PLAN, language: 'es' }
    expect(check(plan)).toHaveLength(1)
    expect(check(plan)).toEqual([])
  })
})

describe('the plan step re-asks a plan in another language once for its photo words (job ih6kVvCGP1)', () => {
  it('re-asks the answer production kept, and keeps the photo words the re-ask gives', async () => {
    mockRunAiRequest
      .mockResolvedValueOnce(toolAnswer(answer({ language: 'es', photoWords: null })))
      .mockResolvedValueOnce(toolAnswer(answer({ language: 'es', photoWords: 'bakery pastries' })))
    const outcome = await runPlan()
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    expect(reaskOf()).toContain('photoWords is required')
    expect(outcome.uncredited).toBeUndefined()
    expect(outcome.review).toMatchObject({ reason: 'plan', findings: [] })
    expect(outcome.plan).toMatchObject({ status: 'proposed', language: 'es', photoWords: 'bakery pastries' })
  })

  it('re-asks words in Spanish the reader dropped', async () => {
    mockRunAiRequest
      .mockResolvedValueOnce(toolAnswer(answer({ language: 'es', photoWords: 'panadería pasteles' })))
      .mockResolvedValueOnce(toolAnswer(answer({ language: 'es', photoWords: 'bakery conchas' })))
    const outcome = await runPlan()
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    expect(outcome.plan?.photoWords).toBe('bakery conchas')
  })

  it('keeps a re-ask that still gives none, and the job goes on: its photos fall back, never a stopped start', async () => {
    mockRunAiRequest.mockResolvedValue(toolAnswer(answer({ language: 'es', photoWords: null })))
    const outcome = await runPlan()
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    expect(outcome.uncredited).toBeUndefined()
    expect(outcome.review).toMatchObject({ reason: 'plan', findings: [] })
    expect(outcome.plan?.language).toBe('es')
    expect(outcome.plan).not.toHaveProperty('photoWords')
    // The fallback reads the business type in English, never the kind of site picked.
    expect(aiStockSourceTerms({ business: BUSINESS_TYPE, ...aiStockPhotoWordsOf({ plan: outcome.plan, inputs: bakeryJob().inputs }) })).toEqual(
      aiStockSiteTerms('bakery'),
    )
  })

  it('asks nothing more of an English plan, or of a plan in another language that gave them', async () => {
    mockRunAiRequest.mockResolvedValue(toolAnswer(answer({ language: 'en', photoWords: null })))
    const english = await runPlan()
    expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
    expect(english.plan?.language).toBe('en')
    expect(english.plan).not.toHaveProperty('photoWords')

    mockRunAiRequest.mockReset().mockResolvedValue(toolAnswer(answer({ language: 'es', photoWords: 'bakery pastries' })))
    const spanish = await runPlan()
    expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
    expect(spanish.plan?.photoWords).toBe('bakery pastries')
  })
})

describe('a business type in another language, in English (AGL-3779)', () => {
  it('reads Panaderia La Molienda’s business type as a bakery', () => {
    expect(aiStockBusinessNoun(BUSINESS_TYPE)).toBe('bakery')
  })

  it.each([
    ['Une boulangerie artisanale à Lyon', 'bakery'],
    ['Uma padaria de bairro em Lisboa', 'bakery'],
    ['Eine Bäckerei mit Café in Köln', 'bakery'],
    ['Una panetteria di famiglia a Bologna', 'bakery'],
    ['Una floristería en Sevilla con ramos de novia', 'florist'],
    ['Una peluquería para mujeres en Madrid', 'hair salon'],
    ['Un salon de coiffure pour hommes', 'hair salon'],
    ['Una peluquería canina con baño y corte', 'dog grooming'],
    ['Una cafetería con desayunos', 'cafe'],
    ['Un restaurante de mariscos en Veracruz', 'restaurant'],
    ['Una trattoria di famiglia a Bologna', 'trattoria'],
    ['Un taller mecánico de frenos y suspensión', 'auto repair'],
    ['Eine Kfz-Werkstatt in Köln', 'auto repair'],
    ['Um salão de cabeleireiro no Porto', 'hair salon'],
    ['Una PANADERÍA y cafetería', 'bakery'],
  ])('reads “%s” as %s', (text, english) => {
    expect(aiStockBusinessNoun(text)).toBe(english)
  })

  it('matches whole words only, and names nothing it does not list', () => {
    // "pan" is no bakery, and a compound is matched only when listed itself.
    expect(aiStockBusinessNoun('Un negocio familiar con pan dulce')).toBe('')
    expect(aiStockBusinessNoun('Ein Familienbäckereibetrieb')).toBe('')
    expect(aiStockBusinessNoun('')).toBe('')
    // A word English shares never decides: the guided start's brief says "restaurant & café" in English.
    expect(aiStockBusinessNoun('Make it a restaurant & café site.')).toBe('')
  })

  it('keeps every English name a search a library answers, and no listed name twice', () => {
    const names = AI_STOCK_BUSINESS_NOUNS.flatMap((noun) => noun.names.map((name) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()))
    expect(new Set(names).size).toBe(names.length)
    for (const noun of AI_STOCK_BUSINESS_NOUNS) expect(noun.english).toMatch(/^[a-z]+(?: [a-z]+)?$/)
  })

  it('searches a Spanish bakery with no photo words by "bakery", never "restaurant cafe"', () => {
    const words = aiStockPhotoWordsOf({ plan: { language: 'es' }, inputs: bakeryJob().inputs })
    expect(words).toEqual({ language: 'es', kindWords: 'restaurant cafe' })
    const terms = aiStockSourceTerms({ business: BUSINESS_TYPE, ...words })
    expect(terms).toEqual(aiStockSiteTerms('bakery'))
    expect(JSON.stringify(terms)).not.toMatch(/restaurant|coffee|dulce/)
  })

  it('leads with the business the table names, then the plan’s photo words, the kind of site last, and an English site its business type', () => {
    // The table's name leads whatever the photo words say.
    expect(aiStockSourceTerms({ business: BUSINESS_TYPE, language: 'es', photoWords: 'wedding cakes', kindWords: 'restaurant cafe' })).toEqual(
      aiStockSiteTerms('bakery'),
    )
    // A business it does not name is searched by the photo words' subject.
    expect(
      aiStockSourceTerms({ business: 'Un negocio familiar con pan dulce', language: 'es', photoWords: 'bakery pastries', kindWords: 'restaurant cafe' }),
    ).toEqual(aiStockSiteTerms('bakery'))
    expect(aiStockSourceTerms({ business: 'Un negocio familiar con pan dulce', language: 'es', kindWords: 'restaurant cafe' })).toEqual(
      aiStockSiteTerms('restaurant cafe'),
    )
    expect(aiStockSourceTerms({ business: 'A family trattoria and panadería', language: 'en', kindWords: 'restaurant cafe' })).toEqual(
      aiStockSiteTerms('A family trattoria and panadería'),
    )
  })

  it('places a bakery photo as the hero, from what Pixabay answered "bakery"', async () => {
    const asked: string[] = []
    const provider: StockPhotoProvider = {
      id: 'pixabay',
      label: 'Pixabay',
      isConfigured: () => true,
      search: async (request) => {
        asked.push(request.query)
        return { photos: request.query === 'bakery' ? BAKERY : [], cached: true }
      },
      download: async () => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff]), contentType: 'image/jpeg' }),
      credit: (found) => ({
        providerLabel: 'Pixabay',
        license: 'Pixabay Content License',
        licenseUrl: 'https://pixabay.com/service/license-summary/',
        attributionRequired: false,
        text: `Photo by ${found.photographer} on Pixabay.`,
      }),
    }
    const ingest: PluginMediaIngest = {
      ingest: async (request) => {
        const id = String(request.stockPhoto?.id)
        return { ok: true, mediaId: id, src: `media:site/${id}`, width: 1280, height: 853 }
      },
      findStockPhoto: async () => null,
    }
    const hero: AiLayoutPictureSlot = {
      imageId: 'hero',
      frameId: null,
      iconId: null,
      alt: 'Canasta de conchas y pan dulce recién horneado sobre el mostrador',
      aspect: 1280 / 853,
      sectionIndex: 0,
      role: 'hero',
    }
    const [placed] =
      (await aiLayoutStockPhotoSource(
        {
          hostId: 'Mb_mBfl9k1',
          uid: 'uid-1',
          seed: 'ih6kVvCGP1:home',
          business: BUSINESS_TYPE,
          sectionNames: ['Pan fresco cada mañana'],
          jobId: 'ih6kVvCGP1',
          ...aiStockPhotoWordsOf({ plan: { language: 'es' }, inputs: bakeryJob().inputs }),
        },
        { provider: () => provider, ingest: () => ingest },
      )?.([hero])) ?? []
    expect(asked[0]).toBe('bakery')
    expect(asked).not.toContain('restaurant cafe')
    const id = placed?.src?.split('/').pop()
    expect((BAKERY.find((hit: StockPhoto) => hit.id === id) as StockPhoto).tags[0]).toMatch(/bakery|bread|pastr|cake|baker/)
  })
})

/*
 * The live languages eval of `ai-job-site-plan-live.spec.ts` on a73af114b8
 * (AGL-3779): every plan said its language and gave English photo words, and
 * on the Free workspace the Sevilla florist's were "wedding bouquets event
 * flowers", whose subject, "wedding", would have searched every slot by
 * weddings. These are the plans' answers as that run reported them, with
 * what each site is now searched by: the business the table names leads.
 */
describe('the live languages eval’s plans, as each site is searched (AGL-3779)', () => {
  const HERO: AiLayoutPictureSlot = { imageId: 'hero', frameId: null, iconId: null, alt: '', aspect: 16 / 9, sectionIndex: 0, role: 'hero' }
  const ROWS: ReadonlyArray<{ business: string; language: string; photoWords: string | null; searched: string }> = [
    { business: BUSINESS_TYPE, language: 'es', photoWords: 'bakery pastries cakes', searched: 'bakery' },
    {
      business: 'Una floristería en Sevilla con ramos de novia y arreglos para eventos',
      language: 'es',
      photoWords: 'wedding bouquets event flowers',
      searched: 'florist',
    },
    { business: 'Une boulangerie artisanale à Lyon, pains au levain et viennoiseries', language: 'fr', photoWords: 'artisan bakery sourdough', searched: 'bakery' },
    { business: 'Um salão de cabeleireiro no Porto com cortes, coloração e escovas', language: 'pt', photoWords: 'hair salon cuts coloring', searched: 'hair salon' },
    { business: 'Eine Kfz-Werkstatt in Köln für Inspektion, Reifenwechsel und Bremsen', language: 'de', photoWords: 'car repair workshop', searched: 'auto repair' },
    { business: 'Una trattoria di famiglia a Bologna con pasta fresca fatta a mano', language: 'it', photoWords: 'trattoria pasta bolognese', searched: 'trattoria' },
  ]

  it('searched the florist by weddings, as its photo words led', () => {
    expect(aiStockPhotoWordsSubject('wedding bouquets event flowers')).toBe('wedding')
  })

  it.each(ROWS)('searches every slot of $business, its hero first, by $searched', ({ business, language, photoWords, searched }) => {
    const terms = aiStockSourceTerms({ business, language, kindWords: 'restaurant cafe', ...(photoWords ? { photoWords } : {}) })
    expect(terms).toEqual(aiStockSiteTerms(searched))
    expect(aiStockSearchesFor(HERO, terms, '')[0]).toMatchObject({ query: searched, first: true })
    expect(JSON.stringify(terms)).not.toMatch(/wedding|restaurant cafe/)
  })

  it('searches the English control by its business type, its photo words null', () => {
    const business = 'a family bakery in Tulsa that sells cakes to order'
    expect(aiStockSourceTerms({ business, language: 'en', kindWords: 'restaurant cafe' })).toEqual(aiStockSiteTerms(business))
  })
})
