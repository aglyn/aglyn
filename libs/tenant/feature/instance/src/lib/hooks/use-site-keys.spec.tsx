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

import { renderHook } from '@testing-library/react'
import { useSiteKeys } from './use-site-keys'

let read: { status: string; data?: unknown }
let uid: string | null = 'u1'

jest.mock('firebase/firestore', () => ({ doc: jest.fn() }))
jest.mock('./firebase/firebase-services', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: uid ? { uid } : null }),
}))
jest.mock('./use-firestore-doc', () => ({ useFirestoreDoc: () => read }))

const PRESET = { admin: true, editor: false, author: false, viewer: false }
const blocked = () => renderHook(() => useSiteKeys('host-1')).result.current.blocked('x.manage', PRESET)

describe('useSiteKeys (AGL-4047)', () => {
  beforeEach(() => {
    uid = 'u1'
  })

  it('holds while the host document loads and after a refused read', () => {
    read = { status: 'loading' }
    expect(blocked()).toBe(false)
    read = { status: 'error' }
    expect(blocked()).toBe(false)
  })

  it('reads the preset of the member’s site role', () => {
    read = { status: 'success', data: { memberRoles: { u1: 'admin' } } }
    expect(blocked()).toBe(false)
    read = { status: 'success', data: { memberRoles: { u1: 'editor' } } }
    expect(blocked()).toBe(true)
  })

  it('reads the site’s stamp before the preset, both ways', () => {
    read = { status: 'success', data: { memberRoles: { u1: 'viewer' }, memberPermissions: { u1: { 'x.manage': true } } } }
    expect(blocked()).toBe(false)
    read = { status: 'success', data: { memberRoles: { u1: 'admin' }, memberPermissions: { u1: { 'x.manage': false } } } }
    expect(blocked()).toBe(true)
  })

  it('leaves a reader who is not on the roster to the server: staff, whom the doors admit', () => {
    read = { status: 'success', data: { memberRoles: { other: 'admin' } } }
    expect(blocked()).toBe(false)
  })

  it('answers nothing with nobody signed in', () => {
    uid = null
    read = { status: 'success', data: { memberRoles: { u1: 'viewer' } } }
    expect(blocked()).toBe(false)
  })
})
