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
 * The bell's inbox pages on a cursor and agrees with its badge (AGL-3720).
 *
 * Reported from production: a badge of 16 over an Inbox reading "No new
 * notifications". The reader had 27 unread; the popover drew the ten newest
 * notifications filtered for unread, so it showed the few among them, they
 * were marked read, and nothing ever read the rest. Mark all read marked
 * only those, and scrolling loaded nothing.
 *
 * Driven over an in-memory Firestore that answers `where`, `orderBy`,
 * `startAfter`, `limit`, `getDocs`, `onSnapshot` and batched mockWrites, so the
 * real hook and the real menu run against the queries they really make.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

type Data = Record<string, any>
const mockStore = new Map<string, Data>()
const mockListeners = new Set<() => void>()
const mockWrites: Array<{ id: string; patch: Data }> = []
const mockBatchSizes: number[] = []

interface FakeQuery {
  wheres: Array<[string, string, unknown]>
  ordered: boolean
  after?: { id: string }
  lim?: number
}

const at = (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) })
const key = (id: string) => (mockStore.get(id)?.createdAt?.toMillis?.() ?? 0)
const before = (a: string, b: string) =>
  key(a) !== key(b) ? key(a) > key(b) : a > b

function mockRun(q: FakeQuery) {
  let ids = [...mockStore.keys()].filter((id) =>
    q.wheres.every(([field, , value]) => mockStore.get(id)?.[field] === value),
  )
  ids.sort((a, b) => (before(a, b) ? -1 : 1))
  if (q.after) {
    const after = q.after.id
    ids = ids.filter((id) => before(after, id))
  }
  if (q.lim !== undefined) ids = ids.slice(0, q.lim)
  return {
    docs: ids.map((id) => ({
      id,
      ref: { id },
      data: () => ({ ...mockStore.get(id) }),
      get: (field: string) => mockStore.get(id)?.[field],
    })),
  }
}
const mockNotify = () => mockListeners.forEach((listener) => listener())
const mockApply = (id: string, patch: Data) => {
  mockWrites.push({ id, patch })
  mockStore.set(id, { ...mockStore.get(id), ...patch, readAt: at(Date.now()) })
}

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: () => ({ wheres: [], ordered: false }),
  doc: (...path: string[]) => ({ id: path[path.length - 1] }),
  query: (base: FakeQuery, ...constraints: Array<(q: FakeQuery) => FakeQuery>) =>
    constraints.reduce((q, constraint) => constraint(q), { ...base, wheres: [...base.wheres] }),
  where: (field: string, op: string, value: unknown) => (q: FakeQuery) => ({
    ...q,
    wheres: [...q.wheres, [field, op, value]],
  }),
  orderBy: () => (q: FakeQuery) => ({ ...q, ordered: true }),
  startAfter: (snapshot: { id: string }) => (q: FakeQuery) => ({ ...q, after: snapshot }),
  limit: (n: number) => (q: FakeQuery) => ({ ...q, lim: n }),
  getDocs: async (q: FakeQuery) => mockRun(q),
  onSnapshot: (q: FakeQuery, next: (snapshot: unknown) => void) => {
    const listener = () => next(mockRun(q))
    mockListeners.add(listener)
    listener()
    return () => mockListeners.delete(listener)
  },
  serverTimestamp: () => 'pending',
  updateDoc: async (ref: { id: string }, patch: Data) => {
    mockApply(ref.id, patch)
    mockNotify()
  },
  writeBatch: () => {
    const ops: Array<[string, Data]> = []
    return {
      update(ref: { id: string }, patch: Data) {
        ops.push([ref.id, patch])
        return this
      },
      commit: async () => {
        mockBatchSizes.push(ops.length)
        for (const [id, patch] of ops) mockApply(id, patch)
        mockNotify()
      },
    }
  },
}))

jest.mock('next/navigation', () => ({
  __esModule: true,
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/',
}))
// Stable identities, as the real providers give: a fresh object per render
// would re-subscribe every listener on every render.
jest.mock('@aglyn/tenant-feature-instance', () => {
  const firestore = {}
  const user = { data: { uid: 'u-1' } }
  return { __esModule: true, useUser: () => user, useFirestore: () => firestore }
})
/* A live listener over the fake, as the shared hook is. */
jest.mock('../hooks/use-firestore-collection', () => {
  const firestore = jest.requireMock('firebase/firestore')
  const { useEffect, useState } = jest.requireActual<typeof import('react')>('react')
  const useFirestoreCollection = (factory: () => unknown, deps: unknown[]) => {
    const [data, setData] = useState<any[]>([])
    useEffect(() => {
      const q = factory()
      if (!q) return undefined
      return firestore.onSnapshot(q, (snapshot: any) =>
        setData(snapshot.docs.map((entry: any) => ({ $id: entry.id, ...entry.data() }))),
      )
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps)
    return { data }
  }
  return { __esModule: true, default: useFirestoreCollection, useFirestoreCollection }
})
jest.mock('../hooks/use-host-index-entries', () => ({ __esModule: true, default: () => new Map() }))
jest.mock('../hooks/use-notification-prefs', () => ({
  __esModule: true,
  default: () => [{ sound: false, desktop: false, tabBadge: false }],
}))
jest.mock('../hooks/use-org-hosts', () => ({ __esModule: true, default: () => ({ hosts: [] }) }))
jest.mock('../hooks/use-pending-invites', () => ({
  __esModule: true,
  useInviteReview: () => ({ review: jest.fn() }),
  usePendingInvites: () => ({ refresh: jest.fn() }),
}))
jest.mock('../hooks/use-org-scope', () => ({
  __esModule: true,
  useOrgScope: () => ({ currentOrg: null, orgs: [] }),
  useOrgSlug: () => 'acme',
}))

import { NotificationsMenu } from '../components/notifications-menu.component'
import { NotificationsTable } from '../components/notifications-table.component'

/** `count` unread, newest = n-<count>, all older than `readCount` read ones. */
function seed(unread: number, readCount = 0) {
  for (let i = 1; i <= unread; i += 1) {
    mockStore.set(`n-${String(i).padStart(4, '0')}`, {
      type: 'content.formSubmission',
      title: `Unread ${i}`,
      read: false,
      readAt: null,
      createdAt: at(i * 1000),
    })
  }
  for (let i = 1; i <= readCount; i += 1) {
    mockStore.set(`r-${String(i).padStart(4, '0')}`, {
      type: 'content.formSubmission',
      title: `Read ${i}`,
      read: true,
      readAt: at(1),
      createdAt: at((unread + i) * 1000),
    })
  }
}

const badge = () => screen.getByRole('button', { name: 'notifications', hidden: true }).querySelector('.MuiBadge-badge')
const rowsShown = () => within(screen.getByTestId('notifications-menu-list')).queryAllByText(/^Unread \d+$/)
const openMenu = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'notifications' }))
  await screen.findByTestId('notifications-menu-list')
}
const scrollToEnd = (element: HTMLElement) => {
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 2000 })
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: 380 })
  Object.defineProperty(element, 'scrollTop', { configurable: true, value: 1600 })
  fireEvent.scroll(element)
}

beforeEach(() => {
  mockStore.clear()
  mockListeners.clear()
  mockWrites.length = 0
  mockBatchSizes.length = 0
})

describe('the bell inbox (AGL-3720)', () => {
  it('lists the unread the badge counts, even when the newest ten are all read', async () => {
    // 16 unread, all OLDER than 12 read ones: the old ten-newest window held no unread at all.
    seed(16, 12)
    render(<NotificationsMenu />)
    await waitFor(() => expect(badge()?.textContent).toBe('16'))
    await openMenu()
    await waitFor(() => expect(rowsShown()).toHaveLength(16))
    expect(screen.queryByText('No new notifications')).toBeNull()
  })

  it('loads the next page on the cursor as the list scrolls', async () => {
    seed(45)
    render(<NotificationsMenu />)
    await openMenu()
    await waitFor(() => expect(rowsShown()).toHaveLength(20))
    scrollToEnd(screen.getByTestId('notifications-menu-list'))
    await waitFor(() => expect(rowsShown()).toHaveLength(40))
    scrollToEnd(screen.getByTestId('notifications-menu-list'))
    await waitFor(() => expect(rowsShown()).toHaveLength(45))
    // No duplicates across pages: the cursor resumed after the last row.
    expect(new Set(rowsShown().map((node) => node.textContent)).size).toBe(45)
  })

  it('refills from the cursor after the loaded rows are read one by one', async () => {
    seed(27)
    render(<NotificationsMenu />)
    await openMenu()
    await waitFor(() => expect(rowsShown()).toHaveLength(20))
    // Read the twenty loaded rows (each click closes the popover; reopen).
    for (let i = 27; i >= 8; i -= 1) {
      fireEvent.click(await screen.findByText(`Unread ${i}`))
      await openMenu()
    }
    await waitFor(() => expect(rowsShown().map((node) => node.textContent)).toEqual(
      ['Unread 7', 'Unread 6', 'Unread 5', 'Unread 4', 'Unread 3', 'Unread 2', 'Unread 1'],
    ))
    await waitFor(() => expect(badge()?.textContent).toBe('7'))
  })

  it('Mark all read marks every unread, not just the loaded page, in batches of ≤500', async () => {
    seed(1203)
    render(<NotificationsMenu />)
    await openMenu()
    await waitFor(() => expect(rowsShown()).toHaveLength(20))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
    })
    await waitFor(() => expect([...mockStore.values()].every((entry) => entry.read === true)).toBe(true))
    expect(mockBatchSizes).toEqual([500, 500, 203])
    expect(mockWrites.every(({ patch }) => patch.read === true && patch.readAt === 'pending')).toBe(true)
    await waitFor(() => expect(badge()?.classList.contains('MuiBadge-invisible')).toBe(true))
    await screen.findByText('No new notifications')
  })
})

describe('the View all feed marks a row read on the first click (AGL-3720)', () => {
  it('reads `read` before `readAt`, so a pending server timestamp still reads as Read', () => {
    render(
      <NotificationsTable
        rows={[
          { $id: 'n-1', type: 'content.formSubmission', title: 'Just read', read: true, readAt: null },
        ]}
        onOpen={jest.fn()}
        page={0}
        pageSize={25}
        hasMore={false}
        onPageChange={jest.fn()}
        onPageSizeChange={jest.fn()}
      />,
    )
    expect(screen.getByText('Read')).toBeTruthy()
    expect(screen.queryByText('New')).toBeNull()
  })
})
