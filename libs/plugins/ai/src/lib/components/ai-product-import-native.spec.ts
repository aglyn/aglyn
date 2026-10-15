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

/**
 * The native After import step for a products import (AGL-3671) asks what the console's does and starts the job the console's
 * products hub starts: the same jobs route, the same brief and inputs (`ai-products-bulk.spec.ts`), the same sentences. The
 * flow itself is replayed by both renderers (ScreenImportStepsTests, ScreenImportStepsTest).
 */
interface Screen {
  id: string
  requires?: string
  zones?: string[]
  load?: { jobs?: { url: string; optional?: boolean } }
  hook?: { when: string; load: Record<string, { url?: string; method?: string; compute?: string; body?: unknown }>; action: { url: string; body: Record<string, unknown>; success: string } }
  blocks: Array<{ type: string; text?: string; id?: string; fields?: Array<{ key: string; label: string; help?: string }> }>
}

const root = join(__dirname, '../../../../../..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')
const screen = (JSON.parse(read('libs/plugins/ai/src/ios/Sources/AglynAiPlugin/Resources/ai.screens.json')) as { screens: Screen[] }).screens.find(
  (one) => one.id === 'ai.import.productCopy',
) as Screen
const option = read('libs/plugins/ai/src/lib/components/ai-product-import-option.component.tsx')
const hook = read('libs/plugins/ai/src/lib/components/use-ai-products-jobs.ts')
const stepComponent = read('libs/plugins/commerce/src/lib/transfer/product-import-step.component.tsx')
const flat = (source: string) => source.replace(/\s+/g, ' ').replace(/[`'"] \+ [`'"]/g, '')

describe('native products import After import step', () => {
  it('belongs to the products resource, in the zone the review draws, and asks what the console asks', () => {
    expect(screen.zones).toEqual(['transferStep'])
    expect(screen.requires).toBe('stash.importResource == commerce.products && org.manager')
    expect(flat(stepComponent)).toContain('What happens to the new products once they land.')
    expect(screen.blocks[0]?.text).toBe('What happens to the new products once they land.')
    const field = screen.blocks.find((block) => block.id === 'copy')?.fields?.[0]
    expect(flat(option)).toContain(field?.label as string)
    expect(flat(option)).toContain(field?.help as string)
    const cap = screen.blocks.find((block) => (block.text ?? '').startsWith('Copy is written for the first'))
    expect(cap?.text).toBe('Copy is written for the first 50 of the {stash.importPlan.summary.create} products.')
    expect(flat(option)).toContain('Copy is written for the first ${covered} of the ${count} products.')
  })

  it('reads whether the feature is the workspace’s from the jobs route the console reads', () => {
    expect(screen.load?.jobs?.url).toBe('/api/ai/jobs?orgId={org.id}&limit=20')
    expect(screen.load?.jobs?.optional).toBe(true)
    expect(hook).toContain('/api/ai/jobs?orgId=${encodeURIComponent(orgId)}&limit=${AI_PRODUCTS_RECENT_JOBS_READ}')
    expect(hook).toContain('AI_PRODUCTS_RECENT_JOBS_READ = 20')
  })

  it('starts the job the products hub starts, once the import has landed', () => {
    const { load, action } = screen.hook as NonNullable<Screen['hook']>
    // The created ids come from the import job's results, as `createdProductIds` reads them.
    expect(load['created']?.url).toBe('/api/transfer/status')
    expect(JSON.stringify(load['created']?.body)).toContain('"include":"results"')
    expect(read('libs/plugins/commerce/src/lib/transfer/product-import-results.ts')).toContain("include: 'results'")
    expect(load['job']?.compute).toBe('aiProductsImportJob')
    // The job: kind, hostId, brief and inputs, as `start` posts them.
    expect(action.url).toBe('/api/ai/jobs')
    expect(Object.keys(action.body).sort()).toEqual(['brief', 'hostId', 'inputs', 'kind', 'orgId'])
    expect(action.body['kind']).toBe('products')
    expect(flat(hook)).toContain("JSON.stringify({ orgId, hostId, kind: 'products', brief, inputs })")
    expect(action.success).toBe(
      'AI is writing descriptions, search listings and tags for the new products. You review them on the products page before any is saved.',
    )
  })
})
