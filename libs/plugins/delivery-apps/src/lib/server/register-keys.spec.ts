/**
 * @jest-environment node
 */
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
import { DELIVERY_REGISTER_KEYS, refusedRegisterKey } from './register-keys'

/**
 * The register's doors answer to the register's keys (AGL-4047): the queue
 * to "Use the point of sale", an action on one of its orders to that and
 * "Sell at the register", read off the map `resolveOrgPermissions` resolves
 * for the site.
 */
describe('the delivery register’s keys (AGL-4047)', () => {
  it('opens the queue on managePos alone, and acts on an order with posSell too', () => {
    expect(DELIVERY_REGISTER_KEYS).toEqual({ register: ['managePos'], registerOrder: ['managePos', 'posSell'] })
  })

  // The tier defaults both keys are declared with: on for admin and editor,
  // off for viewer, and an author resolves as a viewer. The site roles this
  // door used to ask for, so no preset gains or loses the register.
  it.each([
    ['an admin', { managePos: true, posSell: true }, null, null],
    ['an editor', { managePos: true, posSell: true }, null, null],
    ['an author', { managePos: false, posSell: false }, 'managePos', 'managePos'],
    ['a viewer', { managePos: false, posSell: false }, 'managePos', 'managePos'],
    ['someone with no access to the site', {}, 'managePos', 'managePos'],
  ])('%s by default', (_who, permissions, queue, order) => {
    expect(refusedRegisterKey(permissions, 'register')).toBe(queue)
    expect(refusedRegisterKey(permissions, 'registerOrder')).toBe(order)
  })

  it('admits whoever a role or an override grants the register, and refuses whoever it takes it from', () => {
    // A site viewer granted the register: the site role no longer stands in the way.
    expect(refusedRegisterKey({ managePos: true, posSell: true }, 'registerOrder')).toBeNull()
    // An admin a role refuses the register.
    expect(refusedRegisterKey({ managePos: false, posSell: false }, 'register')).toBe('managePos')
  })

  it('lets a member who may not sell see the queue, and refuses them every order', () => {
    const noSale = { managePos: true, posSell: false }
    expect(refusedRegisterKey(noSale, 'register')).toBeNull()
    expect(refusedRegisterKey(noSale, 'registerOrder')).toBe('posSell')
  })

  it('reads a map without posSell as following managePos, and never holds posSell without it', () => {
    expect(refusedRegisterKey({ managePos: true }, 'registerOrder')).toBeNull()
    expect(refusedRegisterKey({ managePos: false, posSell: true }, 'registerOrder')).toBe('managePos')
    expect(refusedRegisterKey(null, 'register')).toBe('managePos')
  })
})
