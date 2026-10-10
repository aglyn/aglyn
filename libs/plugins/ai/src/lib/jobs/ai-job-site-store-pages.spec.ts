/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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
 * The store pages' pass (AGL-3676): every store page written by code through
 * the page draft writer, no model, no credits, and the site's user accounts
 * turned on so the account page's sign-in answers.
 */

jest.mock('../providers/routing', () => ({
  __esModule: true,
  ...jest.requireActual('../providers/routing'),
  aiModelForStep: () => 'routed-model',
}))

import type { AiJob } from '../model/ai-jobs.types'
import { aiStorePagesOfPlan } from '../model/ai-site-store-pages'
import { AI_JOB_ZERO_USAGE } from './ai-job-generation'
import {
  AI_SITE_STORE_PAGES_INPUT,
  AI_SITE_STORE_PAGES_NOT_WRITTEN_COPY,
  aiSiteStorePagesRefusal,
  createAiSiteStorePagesRunner,
  turnOnSiteAccounts,
  type AiSiteStorePagesInput,
} from './ai-job-site-store-pages'
import type { AiJobStepContext } from './ai-job-text-step'

const NOW = new Date('2026-10-10T00:00:00.000Z')

/** A host document the pass reads and updates, and nothing else. */
function hostStore(fields: Record<string, unknown> | null) {
  const updates: Record<string, unknown>[] = []
  const doc = {
    get: async () => ({ exists: fields !== null, get: (key: string) => fields?.[key] }),
    update: async (patch: Record<string, unknown>) => {
      updates.push(patch)
    },
  }
  return { firestore: { collection: () => ({ doc: () => doc }) } as unknown as FirebaseFirestore.Firestore, updates }
}

function unitJob(input: Partial<AiSiteStorePagesInput> = {}): AiJob {
  const pages = aiStorePagesOfPlan([
    { title: 'Home', slug: '/' },
    { title: 'Shop', slug: '/shop' },
    { title: 'Shipping & care', slug: '/shipping-care' },
  ])
  return {
    $id: 'job-1-store',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'text',
    createdBy: 'uid-1',
    inputs: {
      originJobId: 'job-1',
      [AI_SITE_STORE_PAGES_INPUT]: {
        pages,
        facts: { contactPath: null, shopPath: '/shop', shippingPath: '/shipping-care' },
        layoutId: 'frame-1',
        ...input,
      },
    },
  } as unknown as AiJob
}

function context(job: AiJob, firestore: FirebaseFirestore.Firestore): AiJobStepContext {
  return { job, stepIndex: 1, now: NOW, firestore, org: { plan: 'starter' } as never }
}

describe('the store pages’ pass', () => {
  it('writes every store page the plan has none for, inside the start’s layout, and asks no model', async () => {
    const { firestore } = hostStore({ enabledPlugins: [] })
    const written: Array<Record<string, unknown>> = []
    const write = jest.fn(async (_firestore: unknown, input: Record<string, unknown>) => {
      written.push(input)
      return { ok: true as const, replayed: false, id: String(input['id']), versionId: `v-${input['id']}`, name: String(input['name']), hostSubdomain: 'ember' }
    })
    const writeSeo = jest.fn(async () => undefined)
    const outcome = await createAiSiteStorePagesRunner({ write: write as never, writeSeo })(context(unitJob(), firestore))
    expect(written.map((input) => [input['id'], input['slug'], input['name'], input['layoutId'], input['aiJobId']])).toEqual([
      ['job-1-store-account', 'account', 'Your account', 'frame-1', 'job-1'],
      ['job-1-store-cart', 'cart', 'Your cart', 'frame-1', 'job-1'],
      ['job-1-store-privacy', 'privacy', 'Privacy policy', 'frame-1', 'job-1'],
      ['job-1-store-terms', 'terms', 'Terms of sale', 'frame-1', 'job-1'],
    ])
    expect(written.every((input) => input['kind'] === 'screen')).toBe(true)
    expect(writeSeo).toHaveBeenCalledWith(firestore, expect.objectContaining({ id: 'job-1-store-privacy', seo: expect.objectContaining({ title: 'Privacy policy' }) }))
    expect(outcome.usage).toEqual(AI_JOB_ZERO_USAGE)
    expect(outcome.outputs.map((output) => [output.resource, output.id, output.versionId, output.proposal])).toEqual([
      ['screen', 'job-1-store-account', 'v-job-1-store-account', { storePage: 'account', path: '/account' }],
      ['screen', 'job-1-store-cart', 'v-job-1-store-cart', { storePage: 'cart', path: '/cart' }],
      ['screen', 'job-1-store-privacy', 'v-job-1-store-privacy', { storePage: 'privacy', path: '/privacy' }],
      ['screen', 'job-1-store-terms', 'v-job-1-store-terms', { storePage: 'terms', path: '/terms' }],
    ])
  })

  it('keeps what fit when the pages allowance runs out, and reports the allowance when nothing did', async () => {
    const { firestore } = hostStore({})
    let calls = 0
    const write = jest.fn(async (_firestore: unknown, input: Record<string, unknown>) =>
      calls++ === 0
        ? { ok: true as const, replayed: false, id: String(input['id']), versionId: 'v', name: 'Your account', hostSubdomain: null }
        : { ok: false as const, status: 403 as const, error: 'Your plan includes 25 pages — upgrade in Billing for more' },
    )
    const some = await createAiSiteStorePagesRunner({ write: write as never, writeSeo: async () => undefined })(context(unitJob(), firestore))
    expect(some.outputs.map((output) => output.id)).toEqual(['job-1-store-account'])
    const none = await createAiSiteStorePagesRunner({
      write: (async () => ({ ok: false, status: 403, error: 'Your plan includes 25 pages — upgrade in Billing for more' })) as never,
    })(context(unitJob(), firestore))
    expect(none.outputs).toEqual([])
    expect(none.review).toMatchObject({ reason: 'limit', message: 'Your plan includes 25 pages — upgrade in Billing for more' })
  })

  it('fails on our side, unspent, without what it is to write', async () => {
    const { firestore } = hostStore({})
    const outcome = await createAiSiteStorePagesRunner({ write: jest.fn() as never })(context({ ...unitJob(), inputs: {} }, firestore))
    expect(outcome.failure).toBe(AI_SITE_STORE_PAGES_NOT_WRITTEN_COPY)
  })
})

describe('the site’s user accounts', () => {
  it('are turned on so the account page’s sign-in answers', async () => {
    const { firestore, updates } = hostStore({ enabledPlugins: ['music'] })
    expect(await turnOnSiteAccounts(firestore, 'host-1', NOW)).toBe(true)
    expect(updates).toHaveLength(1)
    expect(updates[0]['updatedAt']).toBe(NOW)
  })

  it('are left as they are where they are on, or where the owner switched them off', async () => {
    for (const fields of [{ enabledPlugins: ['accounts'] }, { disabledPlugins: ['accounts'] }, null]) {
      const { firestore, updates } = hostStore(fields)
      expect(await turnOnSiteAccounts(firestore, 'host-1', NOW)).toBe(false)
      expect(updates).toEqual([])
    }
  })
})

describe('whether a store’s pages may be added', () => {
  const job = { orgId: 'org-1', hostId: 'host-1', createdBy: 'uid-1' }
  const ask = (org: Record<string, unknown>, role: string, admitted = true) =>
    aiSiteStorePagesRefusal(
      { firestore: hostStore({ memberRoles: { 'uid-1': role } }).firestore, org: org as never, now: NOW, job },
      { admission: async () => (admitted ? null : { status: 403, error: 'Turn on Commerce for this site before starting the job.' }) },
    )

  it('admits an editor on a plan with a store where commerce runs', async () => {
    expect(await ask({ plan: 'starter' }, 'editor')).toBeNull()
  })

  it('refuses the Free plan, which has no store, a site without commerce, and a viewer', async () => {
    expect(await ask({ plan: 'free' }, 'editor')).toBe('Your plan does not include a store.')
    expect(await ask({ plan: 'starter' }, 'editor', false)).toBe('Turn on Commerce for this site before starting the job.')
    expect(await ask({ plan: 'starter' }, 'viewer')).toBe('Editing requires the editor role')
  })
})
