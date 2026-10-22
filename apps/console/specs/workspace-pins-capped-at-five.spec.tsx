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
 * Pinned workspaces are capped at five, the console included (Zach,
 * 2026-10-18, AGL-3943), and shared with the native apps' rail through
 * `users/{uid}.pinnedOrgs`.
 *
 * - A sixth pin writes nothing: the chooser asks "Pinned is full. Replace
 *   one?" and the reader's pick takes that pin's place.
 * - A reader who pinned more than five before the cap keeps the first five
 *   until they answer "Keep which 5?", which is asked once: closing it keeps
 *   those five.
 * - A write the rules refuse puts the stored list back.
 */

import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import React from 'react'

const mockSetDoc = jest.fn(async (..._args: unknown[]) => undefined)
let mockProfile: Record<string, unknown> | null = null

jest.mock('firebase/firestore', () => ({
  doc: (_firestore: unknown, ...path: string[]) => ({ path: path.join('/') }),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  arrayUnion: (id: string) => ({ arrayUnion: id }),
  arrayRemove: (id: string) => ({ arrayRemove: id }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'u-1' } }),
}))

// The moved hooks import these modules directly, which the index mock
// above does not reach; each hands back the index mock's value.
jest.mock('@aglyn/tenant-feature-instance/hooks/firebase/firebase-services', () => ({
  get useFirestore() {
    return jest.requireMock('@aglyn/tenant-feature-instance').useFirestore
  },
  get useUser() {
    return jest.requireMock('@aglyn/tenant-feature-instance').useUser
  },
}))
jest.mock('../hooks/use-firestore-doc', () => ({
  __esModule: true,
  default: () => ({ data: mockProfile, status: 'success' }),
}))
// The moved console hooks read the lib's use-firestore-doc directly; hand them this mock.
jest.mock('@aglyn/tenant-feature-instance/hooks/use-firestore-doc', () => jest.requireMock('../hooks/use-firestore-doc'))

let mockScope = {
  orgs: [] as Array<{ $id: string; slug: string; orgName?: string }>,
  hasMoreOrgs: false,
  loadMoreOrgs: jest.fn(),
}
jest.mock('../hooks/use-org-scope', () => ({
  __esModule: true,
  default: () => mockScope,
  useOrgScope: () => mockScope,
}))

import { usePinnedOrgs } from '@aglyn/console-ui/hooks/use-pinned-orgs'
import {
  PinnedFullDialog,
  PinnedOrgsKeepPrompt,
} from '../components/pinned-orgs-dialogs.component'

const ids = (n: number) => Array.from({ length: n }, (_, i) => `org-${i + 1}`)

beforeEach(() => {
  jest.clearAllMocks()
  mockProfile = null
  mockScope = {
    orgs: ids(7).map((id, i) => ({ $id: id, slug: id, orgName: `Workspace ${i + 1}` })),
    hasMoreOrgs: false,
    loadMoreOrgs: jest.fn(),
  }
})

describe('usePinnedOrgs holds the five-pin cap', () => {
  it('CONTROL: pins a fourth and a fifth workspace, one id at a time', () => {
    mockProfile = { pinnedOrgs: ids(4) }
    const { result } = renderHook(() => usePinnedOrgs())
    let outcome: string | undefined
    act(() => {
      outcome = result.current.toggle('org-5')
    })
    expect(outcome).toBe('pinned')
    expect(mockSetDoc).toHaveBeenCalledWith(
      { path: 'users/u-1' },
      { pinnedOrgs: { arrayUnion: 'org-5' } },
      { merge: true },
    )
    expect(result.current.pinned).toEqual(ids(5))
    expect(result.current.full).toBe(true)
  })

  it('answers a sixth pin with full and writes nothing', () => {
    mockProfile = { pinnedOrgs: ids(5) }
    const { result } = renderHook(() => usePinnedOrgs())
    let outcome: string | undefined
    act(() => {
      outcome = result.current.toggle('org-6')
    })
    expect(outcome).toBe('full')
    expect(mockSetDoc).not.toHaveBeenCalled()
    expect(result.current.pinned).toEqual(ids(5))
  })

  it('replaces one pin in its place with one write of five', () => {
    mockProfile = { pinnedOrgs: ids(5) }
    const { result } = renderHook(() => usePinnedOrgs())
    act(() => result.current.replace('org-3', 'org-6'))
    const next = ['org-1', 'org-2', 'org-6', 'org-4', 'org-5']
    expect(mockSetDoc).toHaveBeenCalledWith({ path: 'users/u-1' }, { pinnedOrgs: next }, { merge: true })
    expect(result.current.pinned).toEqual(next)
  })

  it('keeps the first five of an over-cap list in force until the reader picks', () => {
    mockProfile = { pinnedOrgs: ids(7) }
    const { result } = renderHook(() => usePinnedOrgs())
    expect(result.current.pinned).toEqual(ids(5))
    expect(result.current.stored).toEqual(ids(7))
    expect(result.current.overCap).toBe(true)
    act(() => result.current.keep(['org-7', 'org-2']))
    expect(mockSetDoc).toHaveBeenCalledWith(
      { path: 'users/u-1' },
      { pinnedOrgs: ['org-2', 'org-7'] },
      { merge: true },
    )
    expect(result.current.overCap).toBe(false)
  })

  it('puts the stored list back when the write is refused', async () => {
    mockProfile = { pinnedOrgs: ids(4) }
    mockSetDoc.mockRejectedValueOnce(new Error('permission-denied'))
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const { result } = renderHook(() => usePinnedOrgs())
    await act(async () => {
      result.current.toggle('org-5')
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.pinned).toEqual(ids(4))
    error.mockRestore()
  })
})

describe('"Pinned is full. Replace one?"', () => {
  it('lists the five pins and replaces the one picked', () => {
    const onReplace = jest.fn()
    const onClose = jest.fn()
    render(
      <PinnedFullDialog
        pinning={{ id: 'org-6', name: 'Workspace 6' }}
        pins={ids(5).map((id, i) => ({ id, name: `Workspace ${i + 1}` }))}
        onReplace={onReplace}
        onClose={onClose}
      />,
    )
    expect(screen.getByText('Pinned is full. Replace one?')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^Replace / })).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: 'Replace Workspace 3' }))
    expect(onReplace).toHaveBeenCalledWith('org-3')
    fireEvent.click(screen.getByRole('button', { name: 'Keep my pins' }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('"Keep which 5?"', () => {
  it('says nothing to a reader with five pins or fewer', () => {
    mockProfile = { pinnedOrgs: ids(5) }
    render(<PinnedOrgsKeepPrompt />)
    expect(screen.queryByText('Keep which 5?')).toBeNull()
  })

  it('asks once, with the first five ticked, and keeps exactly what is picked', () => {
    mockProfile = { pinnedOrgs: ids(7) }
    render(<PinnedOrgsKeepPrompt />)
    expect(screen.getByText('Keep which 5?')).toBeTruthy()
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes.map((box) => box.checked)).toEqual([true, true, true, true, true, false, false])
    expect(screen.getByText('Workspace 7')).toBeTruthy()

    // A sixth ticked: the button stays on screen, disabled with the reason.
    fireEvent.click(boxes[6])
    const keepThese = screen.getByRole('button', { name: 'Keep these' }) as HTMLButtonElement
    expect(keepThese.disabled).toBe(true)
    expect(screen.getByLabelText('Pick up to 5 workspaces to keep')).toBeTruthy()

    fireEvent.click(boxes[0])
    fireEvent.click(screen.getByRole('button', { name: 'Keep these' }))
    expect(mockSetDoc).toHaveBeenLastCalledWith(
      { path: 'users/u-1' },
      { pinnedOrgs: ['org-2', 'org-3', 'org-4', 'org-5', 'org-7'] },
      { merge: true },
    )
  })

  it('keeps the first five when the reader does not choose', () => {
    mockProfile = { pinnedOrgs: ids(7) }
    render(<PinnedOrgsKeepPrompt />)
    fireEvent.click(screen.getByRole('button', { name: 'Keep the first 5' }))
    expect(mockSetDoc).toHaveBeenLastCalledWith(
      { path: 'users/u-1' },
      { pinnedOrgs: ids(5) },
      { merge: true },
    )
  })
})
