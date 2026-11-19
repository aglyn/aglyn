/**
 * @jest-environment node
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


import { expandCatalogRow } from '../catalog/google-fonts-catalog'
import { fontsCatalogRoute } from './catalog-route'

describe('GET fonts/catalog', () => {
  it('answers the catalog the console bundles, most used first, cacheable', async () => {
    const response = await fontsCatalogRoute(new Request('https://console.aglyn.com/api/plugins/fonts/catalog'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400')
    const body = (await response.json()) as { families: Array<Parameters<typeof expandCatalogRow>[0]> }
    expect(body.families.length).toBeGreaterThan(1000)
    const first = expandCatalogRow(body.families[0])
    expect(first.family).toBe('Roboto')
    expect(first.weights).toContain(400)
    expect(body.families.every((row, index) => index === 0 || row.p >= body.families[index - 1].p)).toBe(true)
  })

  it('refuses anything but GET', async () => {
    const response = await fontsCatalogRoute(new Request('https://console.aglyn.com/api/plugins/fonts/catalog', { method: 'POST' }))
    expect(response.status).toBe(405)
  })
})
