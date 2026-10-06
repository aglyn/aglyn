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
 * @jest-environment node
 */

/**
 * Work run after the response (AGL-3328, AGL-3486): Next's `after()`
 * loaded once, a task it refuses or cannot be given reported once per
 * reason, and a failing task reported every time. Then the guard the
 * mocks below cannot be: nothing in this package or `tenant-data-admin`
 * loads `next/*` through a bare `require()`, which Turbopack compiled into a ReferenceError that the
 * callers' `catch` turned into "no request" — in production, every time.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const mockAfter: Array<() => Promise<void>> = []
let mockInRequest = true
jest.mock('next/server', () => ({
  after: (task: () => Promise<void>) => {
    if (!mockInRequest) throw new Error('`after` was called outside a request scope')
    mockAfter.push(task)
  },
}))

import { loadAfterResponse, resetAfterResponseForTests, scheduleAfterResponse } from './after-response'

let errors: jest.SpyInstance

beforeEach(() => {
  mockAfter.length = 0
  mockInRequest = true
  resetAfterResponseForTests()
  errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('scheduleAfterResponse', () => {
  it('hands the task to after(), which runs it once the response has gone', async () => {
    const ran: string[] = []
    await expect(scheduleAfterResponse(async () => void ran.push('task'), '[spec]')).resolves.toBe(true)
    expect(ran).toEqual([])
    await mockAfter[0]()
    expect(ran).toEqual(['task'])
  })

  it('loads next/server once for every caller', async () => {
    const first = loadAfterResponse()
    expect(loadAfterResponse()).toBe(first)
    await expect(first).resolves.toEqual(expect.any(Function))
  })

  it('answers false outside a request, and says so once per caller', async () => {
    mockInRequest = false
    await expect(scheduleAfterResponse(async () => undefined, '[spec]')).resolves.toBe(false)
    await expect(scheduleAfterResponse(async () => undefined, '[spec]')).resolves.toBe(false)
    await expect(scheduleAfterResponse(async () => undefined, '[other]')).resolves.toBe(false)
    expect(errors.mock.calls.map(([message]) => message)).toEqual([
      '[spec] after() refused the task; it was not scheduled',
      '[other] after() refused the task; it was not scheduled',
    ])
  })

  it('logs a task that fails, every time, and never rejects', async () => {
    const failing = async () => {
      throw new Error('boom')
    }
    await scheduleAfterResponse(failing, '[spec]')
    await scheduleAfterResponse(failing, '[spec]')
    await Promise.all(mockAfter.map((task) => task()))
    expect(errors.mock.calls.filter(([message]) => message === '[spec] after-response task failed')).toHaveLength(2)
  })
})

describe('the packages that run after() load next/* through import(), never a bare require()', () => {
  const libs = join(__dirname, '..', '..', '..', '..')
  const roots = [join(libs, 'aglyn', 'src'), join(libs, 'tenant', 'data', 'admin', 'src')]

  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return sources(path)
      return /\.tsx?$/.test(entry.name) && !/\.(spec|test)\.tsx?$/.test(entry.name) ? [path] : []
    })
  }

  /** The source with its comments blanked, so prose naming the old call is not a call. */
  function code(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  }

  it('finds the sources it guards', () => {
    const found = roots.flatMap((root) => sources(root)).map((path) => relative(libs, path))
    expect(found).toEqual(
      expect.arrayContaining([
        join('aglyn', 'src', 'lib', 'app-utils', 'api-adapter.ts'),
        join('tenant', 'data', 'admin', 'src', 'lib', 'server', 'capture-email-check.ts'),
      ]),
    )
  })

  it('has no require() of next/server or any other next/* entry', () => {
    const offenders = roots.flatMap((root) => sources(root)).flatMap((path) =>
      /\brequire\s*\(\s*['"`]next(\/[^'"`]*)?['"`]\s*\)/.test(code(readFileSync(path, 'utf8')))
        ? [relative(libs, path)]
        : [],
    )
    expect(offenders).toEqual([])
  })
})
