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

import {
  BOOT_WEDGE_CHECK_DELAY_MS,
  BOOT_WEDGE_LOCK_MS,
  LEASE_PROMPT_READ_MS,
  LEASE_SETTLE_MS,
  WEDGE_LOCK_MS,
  runBootWedgeCheck,
  type BootWedgeOutcome,
} from './firestore-multitab-wedge'
import { FIRESTORE_STALL_MS } from './firestore-stall-recovery'
import {
  PAGE_POLL_MS,
  createPageWedgeWatch,
  startPageWedgeChecks,
  type PageCheckScope,
} from './firestore-page-wedge-check'

describe('a page opened in a running tab finds another tab\'s lock in seconds (AGL-4204)', () => {
  /** A watch over a fake path, clock and answer stamp; each check's scope is kept. */
  const watching = () => {
    let path = '/agl-app-demo/hosts/a'
    let clock = 1_000
    let answeredAt: number | undefined
    const scopes: PageCheckScope[] = []
    const runCheck = jest.fn(async (scope: PageCheckScope): Promise<BootWedgeOutcome> => {
      scopes.push(scope)
      return 'clear'
    })
    const watch = createPageWedgeWatch({
      readPath: () => path,
      lastServerAnswerAt: () => answeredAt,
      runCheck,
      now: () => clock,
    })
    return {
      watch,
      runCheck,
      scopes,
      go: (next: string) => {
        path = next
      },
      tick: (ms = PAGE_POLL_MS) => {
        clock += ms
      },
      answer: () => {
        answeredAt = clock
      },
    }
  }

  /**
   * The stall watch's path to a lock verdict: 8 s stall, 1 s prompt read, 3 s
   * settle, 20 s lock read. The page check must land well inside it.
   */
  it('reaches a verdict far inside the stall watch\'s budget', () => {
    const pageVerdict = PAGE_POLL_MS + BOOT_WEDGE_CHECK_DELAY_MS + BOOT_WEDGE_LOCK_MS
    const stallVerdict =
      FIRESTORE_STALL_MS + LEASE_PROMPT_READ_MS + LEASE_SETTLE_MS + WEDGE_LOCK_MS
    expect(pageVerdict).toBeLessThanOrEqual(6_000)
    expect(pageVerdict * 4).toBeLessThan(stallVerdict)
  })

  it('checks nothing while the path stays the same, the first page included', () => {
    const t = watching()
    t.tick()
    expect(t.watch.poll()).toBeUndefined()
    t.tick()
    expect(t.watch.poll()).toBeUndefined()
    expect(t.runCheck).not.toHaveBeenCalled()
  })

  it('starts a check when the path changes, and only once per change', () => {
    const t = watching()
    t.go('/agl-app-demo/hosts')
    t.tick()
    expect(t.watch.poll()).toBeDefined()
    t.tick()
    expect(t.watch.poll()).toBeUndefined()
    expect(t.runCheck).toHaveBeenCalledTimes(1)
  })

  it('stands down once the server answers this client after the page opened', () => {
    const t = watching()
    t.answer()
    t.tick()
    t.go('/agl-app-demo/hosts')
    t.tick()
    void t.watch.poll()
    const [page] = t.scopes
    expect(page.isAnswered()).toBe(false)
    t.tick()
    t.answer()
    expect(page.isAnswered()).toBe(true)
  })

  /**
   * The click that leads to the new page happens on the old one. It must not
   * count as using the new page, or the check would never run.
   */
  it('does not count the press that opened the page as using it', () => {
    const t = watching()
    t.tick()
    t.watch.noteInteraction()
    t.go('/agl-app-demo/hosts')
    t.tick()
    void t.watch.poll()
    expect(t.scopes[0].isInUse()).toBe(false)
  })

  /** A page someone has touched keeps the stall watch's budget (AGL-4135). */
  it('stands down once the new page is used, even before the poll saw it open', () => {
    const t = watching()
    t.go('/agl-app-demo/hosts')
    t.tick(100)
    t.watch.noteInteraction()
    t.tick(400)
    void t.watch.poll()
    expect(t.scopes[0].isInUse()).toBe(true)

    const later = watching()
    later.go('/agl-app-demo/hosts')
    later.tick()
    void later.watch.poll()
    expect(later.scopes[0].isInUse()).toBe(false)
    later.tick()
    later.watch.noteInteraction()
    expect(later.scopes[0].isInUse()).toBe(true)
  })

  it('hands over to the next page\'s check when the page is replaced', () => {
    const t = watching()
    t.go('/agl-app-demo/hosts')
    t.tick()
    void t.watch.poll()
    t.go('/agl-app-demo/team')
    t.tick()
    void t.watch.poll()
    expect(t.scopes[0].isInUse()).toBe(true)
    expect(t.scopes[1].isInUse()).toBe(false)
  })

  it('does not count use of the same path on an earlier visit', () => {
    const t = watching()
    t.tick()
    t.watch.noteInteraction()
    t.go('/agl-app-demo/team')
    t.tick()
    void t.watch.poll()
    t.go('/agl-app-demo/hosts/a')
    t.tick()
    void t.watch.poll()
    expect(t.scopes[1].isInUse()).toBe(false)
  })

  describe('through the boot check', () => {
    /** A visible, online tab whose store is locked; each wait advances the clock. */
    const locked = (scope: PageCheckScope) => {
      let clock = 0
      return {
        probe: jest.fn(async (): Promise<{ state: 'locked' }> => ({ state: 'locked' })),
        fallBack: jest.fn(),
        hasServerAnswered: scope.isAnswered,
        isInUse: scope.isInUse,
        isFallbackActive: () => false,
        isOnline: () => true,
        whenVisible: async () => undefined,
        now: () => clock,
        wait: jest.fn(async (ms: number) => {
          clock += ms
        }),
      }
    }

    it('moves an untouched page to the memory cache when the store is locked', async () => {
      const deps = locked({ isAnswered: () => false, isInUse: () => false })
      await expect(runBootWedgeCheck(deps)).resolves.toBe('fell-back')
      expect(deps.fallBack).toHaveBeenCalledWith({ reason: 'lease-locked' })
    })

    it('never reloads a page that is in use, before or after the read', async () => {
      const before = locked({ isAnswered: () => false, isInUse: () => true })
      await expect(runBootWedgeCheck(before)).resolves.toBe('in-use')
      expect(before.probe).not.toHaveBeenCalled()

      let used = false
      const during = locked({ isAnswered: () => false, isInUse: () => used })
      during.probe.mockImplementation(async () => {
        used = true
        return { state: 'locked' }
      })
      await expect(runBootWedgeCheck(during)).resolves.toBe('in-use')
      expect(during.fallBack).not.toHaveBeenCalled()
    })
  })

  it('does nothing for a client that does not run the durable multi-tab cache', () => {
    const stop = startPageWedgeChecks({} as never)
    expect(() => stop()).not.toThrow()
  })
})
