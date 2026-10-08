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
 * ONE PLAN FOR EVERY ROUTING WRITE (AGL-3668).
 *
 * The console applies it through the web SDK and the pages route applies it
 * for the native apps through the Admin SDK, so the placeholder home page,
 * the removed entries and the announced addresses agree on both.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { changedRoutePaths, planScreenRouteWrite } from '../constants/screen-route-plan'

describe('planScreenRouteWrite', () => {
  const state = { screens: { home: '/', about: 'about' }, defaultHomeScreenId: 'home' }

  it('releases the placeholder when another page takes the root', () => {
    expect(planScreenRouteWrite(state, { landing: '/' }, 'landing')).toEqual({
      hostDeletes: ['screens.home', 'defaultHomeScreenId'],
      placeholderUnpublished: 'home',
      paths: ['/'],
    })
  })

  it('ends the placeholder marker when its owner publishes it', () => {
    expect(planScreenRouteWrite(state, { home: '/' }, 'home')).toEqual({ hostDeletes: ['defaultHomeScreenId'], paths: [] })
  })

  it('leaves the placeholder alone for any other address', () => {
    expect(planScreenRouteWrite(state, { pricing: 'pricing' }, 'pricing')).toEqual({ hostDeletes: [], paths: ['/pricing'] })
  })

  it('announces the old address of an unpublished page', () => {
    expect(planScreenRouteWrite(state, { about: null })).toEqual({ hostDeletes: [], paths: ['/about'] })
  })

  it('announces only the entries that moved', () => {
    expect(changedRoutePaths({ a: 'docs/a', b: 'docs/b' }, { a: 'guides/a', b: 'docs/b' })).toEqual(['/docs/a', '/guides/a'])
  })
})

describe('the routing writes share the plan', () => {
  const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8')

  it('is what the console publishing helpers stage', () => {
    expect(read('constants/screen-publishing.ts')).toContain('planScreenRouteWrite(state, entries, published)')
  })

  it('is what the native pages route stages, under the publishing roles', () => {
    const route = read('app/api/hosts/pages/route.ts')
    expect(route).toContain('planScreenRouteWrite(state, entries, published)')
    expect(route).toContain("new Set(['admin', 'editor'])")
    expect(route).toContain('getLockdownVerdict')
  })
})
