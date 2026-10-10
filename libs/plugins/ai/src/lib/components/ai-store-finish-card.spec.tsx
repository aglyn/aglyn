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
 * "Finish your store" (AGL-3676): Zach, 2026-10-10, "make sure all they
 * would have to do is setup the payment info and update products to finish
 * up their storefront". A store start's done page lists only what is left,
 * each linking the exact console page.
 */

import { render, screen } from '@testing-library/react'
import { registerPluginRecordRoute } from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { unregisterPluginServices } from '@aglyn/aglyn/plugin-manager/plugin-services'
import type { AiJobSummary } from '../model/ai-jobs.types'
import { AI_BUILD_STORE_PRODUCTS_TEXT, aiStoreFinishLinks } from './ai-job-links'
import { AiStoreFinishCard } from './ai-store-finish-card.component'

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  AppLink: ({ href, children, className }: { href: string; children: unknown; className?: string }) => (
    <a href={href} className={className}>
      {children as string}
    </a>
  ),
}))

/** The commerce plugin's addresses as it publishes them (`commerce-record-routes.ts`). */
function standInCommerceRoutes() {
  const products = ({ orgSlug, host }: { orgSlug: string; host: string | null }) => (host ? `/${orgSlug}/hosts/${host}/products` : null)
  registerPluginRecordRoute('product', { list: products, record: products }, { pluginId: 'commerce' })
  const settings = (context: { orgSlug: string; host: string | null }) => {
    const list = products(context)
    return list ? `${list}/settings` : null
  }
  registerPluginRecordRoute('store-settings', { list: settings, record: settings }, { pluginId: 'commerce' })
}

const storeJob = (store: string | null): Pick<AiJobSummary, 'kind' | 'status' | 'items' | 'outputs'> => ({
  kind: 'site',
  status: 'done',
  outputs: [{ resource: 'screen', id: 'job-1-store-account', hostId: 'host-1', hostSubdomain: 'ember', label: 'Your account' }],
  items: store
    ? [{ slot: 'store', op: 'store', label: 'Adding your account, cart and policy pages', status: store, attempt: 1, creditsSpent: 0, attemptCredits: 0, creditsRefunded: 0, failure: null, outputs: [] } as never]
    : [],
})

describe('what is left to finish an AI-built store', () => {
  beforeEach(standInCommerceRoutes)
  afterEach(() => unregisterPluginServices('commerce'))

  it('links connecting payments, the products, shipping and tax, and the policies, each to its console page', () => {
    const steps = aiStoreFinishLinks(storeJob('succeeded'), 'acme')
    expect(steps?.map((step) => [step.id, step.href])).toEqual([
      ['payments', '/acme/hosts/ember/products/settings'],
      ['products', '/acme/hosts/ember/products'],
      ['shipping', '/acme/hosts/ember/products/settings'],
      ['policies', '/acme/hosts/ember/screens'],
    ])
    render(<AiStoreFinishCard steps={steps ?? []} />)
    expect(screen.getByRole('heading', { name: 'Finish your store' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Set up payments' }).getAttribute('href')).toBe('/acme/hosts/ember/products/settings')
    expect(screen.getByRole('link', { name: 'Open products' }).getAttribute('href')).toBe('/acme/hosts/ember/products')
  })

  it('is shown only for a start that built the store’s own pages', () => {
    expect(aiStoreFinishLinks(storeJob('skipped'), 'acme')).toBeNull()
    expect(aiStoreFinishLinks(storeJob(null), 'acme')).toBeNull()
    expect(aiStoreFinishLinks({ ...storeJob('succeeded'), status: 'running' }, 'acme')).toBeNull()
  })

  it('names a step without a link where its page’s owner is not loaded', () => {
    unregisterPluginServices('commerce')
    const steps = aiStoreFinishLinks(storeJob('succeeded'), 'acme')
    expect(steps?.find((step) => step.id === 'payments')?.href).toBeNull()
    render(<AiStoreFinishCard steps={steps ?? []} />)
    expect(screen.getByText('Connect payments')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Set up payments' })).toBeNull()
  })
})

describe('what is left to finish a store an Assist build made (AGL-3676)', () => {
  beforeEach(standInCommerceRoutes)
  afterEach(() => unregisterPluginServices('commerce'))

  const buildJob = (written: string[]): Pick<AiJobSummary, 'kind' | 'status' | 'items' | 'outputs'> => ({
    kind: 'build',
    status: 'done',
    outputs: written.map((key) => ({
      resource: 'screen' as const,
      id: `build-1-store-${key}`,
      hostId: 'host-1',
      hostSubdomain: 'ember',
      label: key,
      proposal: { storePage: key },
    })),
    items: [
      {
        slot: 'store',
        op: 'store',
        label: 'Account, cart and policy pages',
        status: 'succeeded',
        attempt: 1,
        creditsSpent: 0,
        attemptCredits: 0,
        creditsRefunded: 0,
        failure: null,
        outputs: written.map((key) => `build-1-store-${key}`),
      } as never,
    ],
  })

  it('lists the same steps, its products as drafts to price', () => {
    const steps = aiStoreFinishLinks(buildJob(['account', 'cart', 'terms']), 'acme')
    expect(steps?.map((step) => step.id)).toEqual(['payments', 'products', 'shipping', 'policies'])
    expect(steps?.find((step) => step.id === 'products')?.text).toBe(AI_BUILD_STORE_PRODUCTS_TEXT)
  })

  it('leaves out the policies where the build wrote none of them: the site had its own', () => {
    expect(aiStoreFinishLinks(buildJob(['account', 'cart']), 'acme')?.map((step) => step.id)).toEqual(['payments', 'products', 'shipping'])
  })
})
