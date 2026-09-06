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
 * `contactCreated` (AGL-2605) is only as real as the doors that fire it.
 *
 * Two claims. The wrapper turns the data library's "a new contact exists"
 * report into the event, with a payload an expression scope can hold. And
 * every server door in the estate goes THROUGH the wrapper — a door that
 * calls `upsertHostContact` directly still captures the person and fires
 * nothing, which is a contact no automation can welcome and no run history
 * would ever explain.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

let mockCreated: Record<string, unknown> | null = null
const upsertHostContact = jest.fn(
  async (options: { onCreated?: (created: unknown) => unknown }) => {
    if (mockCreated) await options.onCreated?.(mockCreated)
  },
)
const emitHostEvent = jest.fn(async () => ({ alerts: [] }))
const associateCompanyByDomain = jest.fn(
  async (): Promise<unknown> => ({ outcome: 'none', reason: 'no-domain' }),
)
const assignOwnerForCapture = jest.fn(
  async (): Promise<unknown> => ({ outcome: 'none', reason: 'no-rule' }),
)

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  upsertHostContact: (options: never) => upsertHostContact(options),
}))
jest.mock('./emit-host-event', () => ({
  __esModule: true,
  emitHostEvent: (...args: unknown[]) => emitHostEvent(...(args as [])),
}))
jest.mock('./associate-company-by-domain', () => ({
  __esModule: true,
  associateCompanyByDomain: (...args: unknown[]) =>
    associateCompanyByDomain(...(args as [])),
}))
jest.mock('./assign-contact-owner', () => ({
  __esModule: true,
  assignOwnerForCapture: (...args: unknown[]) =>
    assignOwnerForCapture(...(args as [])),
}))

import {
  captureHostContact,
  contactCreatedPayload,
} from './capture-host-contact'

const capture = (
  facet?: { companyId?: string; ownerUid?: string },
  extra: { formId?: string; tags?: string[] } = {},
) =>
  captureHostContact({
    hostId: 'site-1',
    email: 'Ada@Example.com',
    source: 'form',
    interaction: { refId: 's1', ...(extra.formId ? { formId: extra.formId } : {}) },
    ...(extra.tags ? { tags: extra.tags } : {}),
    ...(facet ? { facet } : {}),
  })

beforeEach(() => {
  mockCreated = null
  upsertHostContact.mockClear()
  emitHostEvent.mockClear()
  associateCompanyByDomain.mockClear()
  associateCompanyByDomain.mockResolvedValue({ outcome: 'none', reason: 'no-domain' })
  assignOwnerForCapture.mockClear()
  assignOwnerForCapture.mockResolvedValue({ outcome: 'none', reason: 'no-rule' })
})

describe('captureHostContact', () => {
  it('hands the capture to the data library with the create hook bound', async () => {
    await capture()
    expect(upsertHostContact).toHaveBeenCalledTimes(1)
    const options = upsertHostContact.mock.calls[0][0] as Record<string, unknown>
    expect(options['hostId']).toBe('site-1')
    expect(options['source']).toBe('form')
    expect(typeof options['onCreated']).toBe('function')
  })

  it('announces contactCreated when the capture made a new person', async () => {
    mockCreated = {
      contactId: 'contact-9',
      hostId: 'site-1',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      source: 'form',
      campaignIds: ['spring-2026', 'launch'],
      lifecycleStage: 'lead',
    }

    await capture()

    expect(emitHostEvent).toHaveBeenCalledTimes(1)
    expect(emitHostEvent).toHaveBeenCalledWith('site-1', 'contactCreated', {
      contactId: 'contact-9',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      source: 'form',
      hostId: 'site-1',
      lifecycleStage: 'lead',
      campaignIds: 'spring-2026,launch',
    })
  })

  it('announces nothing when the capture was a repeat visit', async () => {
    await capture()
    expect(emitHostEvent).not.toHaveBeenCalled()
  })
})

/**
 * The company link on capture (AGL-2613): asked once, for a NEW person, and
 * before the event goes out — so an automation reading the new contact
 * finds them filed. Never when the door already named a company, and never
 * for a repeat visit.
 */
describe('captureHostContact files a new person under their company', () => {
  const created = {
    contactId: 'contact-9',
    hostId: 'site-1',
    email: 'ada@acme.com',
    source: 'form',
    campaignIds: [],
  }

  it('associates by domain before announcing the contact', async () => {
    mockCreated = created
    await capture()
    expect(associateCompanyByDomain).toHaveBeenCalledTimes(1)
    expect(associateCompanyByDomain).toHaveBeenCalledWith(created)
    expect(associateCompanyByDomain.mock.invocationCallOrder[0]).toBeLessThan(
      emitHostEvent.mock.invocationCallOrder[0],
    )
  })

  it('leaves a company the door named alone', async () => {
    mockCreated = created
    await capture({ companyId: 'co-picked' })
    expect(associateCompanyByDomain).not.toHaveBeenCalled()
    expect(emitHostEvent).toHaveBeenCalledTimes(1)
  })

  it('asks nothing for a repeat visit', async () => {
    await capture()
    expect(associateCompanyByDomain).not.toHaveBeenCalled()
  })

  it('still announces the contact when the association fails', async () => {
    mockCreated = created
    associateCompanyByDomain.mockRejectedValueOnce(new Error('index missing'))
    await capture()
    expect(emitHostEvent).toHaveBeenCalledTimes(1)
  })
})

/**
 * The owner on capture (AGL-2618): the same terms as the company — once,
 * for a NEW person, after the company is filed and before the event goes
 * out — and never over an owner the door named. The pass is handed the
 * form and the tags off the door's own options, which the created-report
 * does not carry.
 */
describe('captureHostContact decides who follows a new person up', () => {
  const created = {
    contactId: 'contact-9',
    hostId: 'site-1',
    email: 'ada@acme.com',
    source: 'form',
    campaignIds: [],
  }

  it('runs the assignment pass after the company link and before the announcement', async () => {
    mockCreated = created
    await capture(undefined, { formId: 'form-1', tags: ['website'] })
    expect(assignOwnerForCapture).toHaveBeenCalledTimes(1)
    expect(assignOwnerForCapture).toHaveBeenCalledWith({
      hostId: 'site-1',
      contactId: 'contact-9',
      email: 'ada@acme.com',
      source: 'form',
      formId: 'form-1',
      tags: ['website'],
    })
    expect(assignOwnerForCapture.mock.invocationCallOrder[0]).toBeGreaterThan(
      associateCompanyByDomain.mock.invocationCallOrder[0],
    )
    expect(assignOwnerForCapture.mock.invocationCallOrder[0]).toBeLessThan(
      emitHostEvent.mock.invocationCallOrder[0],
    )
  })

  it('leaves an owner the door named alone', async () => {
    mockCreated = created
    await capture({ ownerUid: 'uid-picked' })
    expect(assignOwnerForCapture).not.toHaveBeenCalled()
    expect(emitHostEvent).toHaveBeenCalledTimes(1)
  })

  it('asks nothing for a repeat visit', async () => {
    await capture()
    expect(assignOwnerForCapture).not.toHaveBeenCalled()
  })

  it('still announces the contact when the pass rejects', async () => {
    mockCreated = created
    assignOwnerForCapture.mockRejectedValueOnce(new Error('UNAVAILABLE'))
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await capture()
    error.mockRestore()
    expect(emitHostEvent).toHaveBeenCalledTimes(1)
  })
})

describe('contactCreatedPayload', () => {
  it('is flat scalars: name and stage always present, campaigns only when there are some', () => {
    const payload = contactCreatedPayload({
      contactId: 'c1',
      hostId: 'site-1',
      email: 'ada@example.com',
      source: 'booking',
      campaignIds: [],
    })
    expect(payload).toEqual({
      contactId: 'c1',
      email: 'ada@example.com',
      name: '',
      source: 'booking',
      hostId: 'site-1',
      lifecycleStage: '',
    })
    for (const value of Object.values(payload)) {
      expect(['string', 'number', 'boolean']).toContain(typeof value)
    }
  })
})

/**
 * The door scan. Every server path that captures a contact is a file under
 * one of these roots; the wrapper and the data library itself are outside
 * them, so a hit is a door that bypassed the event.
 */
describe('every server door captures through the wrapper', () => {
  const REPO_ROOT = join(__dirname, '../../../../..')
  const ROOTS = ['apps/tenant/app', 'apps/console/app', 'libs/plugins']

  const sourceFiles = (dir: string): string[] => {
    const out: string[] = []
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) {
        out.push(...sourceFiles(path))
      } else if (/\.tsx?$/.test(entry) && !/\.spec\.tsx?$/.test(entry)) {
        out.push(path)
      }
    }
    return out
  }

  /**
   * The argument object of every `captureHostContact({ … })` call, by
   * brace balance — a door is one call, and a regex over a whole file could
   * not tell which call carried what.
   */
  const captureCalls = (source: string): string[] => {
    const calls: string[] = []
    const marker = /\bcaptureHostContact\(\{/g
    let match: RegExpExecArray | null
    while ((match = marker.exec(source))) {
      let depth = 0
      let index = match.index + match[0].length - 1
      for (; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1
        else if (source[index] === '}') depth -= 1
        if (depth === 0) break
      }
      calls.push(source.slice(match.index, index + 1))
    }
    return calls
  }

  it('finds no door calling upsertHostContact directly', () => {
    const files = ROOTS.flatMap((root) => sourceFiles(join(REPO_ROOT, root)))
    const direct: string[] = []
    let throughWrapper = 0
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      if (/\bupsertHostContact\(/.test(source)) direct.push(file)
      if (/\bcaptureHostContact\(/.test(source)) throughWrapper += 1
    }
    // The control: a walk that saw no door at all would report perfect
    // coverage of nothing.
    expect(throughWrapper).toBeGreaterThan(0)
    expect(direct.map((file) => file.slice(REPO_ROOT.length + 1))).toEqual([])
  })

  /**
   * Every door names a stage (AGL-2612): the earliest one that describes
   * what happened (`initialLifecycleStage`), or the caller's own on the
   * facet (`lifecycleStage`, for a manual create, an import or a lead
   * conversion, which carry whatever they were given). A call that names
   * neither is a door filing people at no stage at all — the Contacts list
   * every row blank, the funnel report empty — with nothing on screen to
   * say which surface did it.
   */
  it('finds no door that names no stage', () => {
    const files = ROOTS.flatMap((root) => sourceFiles(join(REPO_ROOT, root)))
    const unstaged: string[] = []
    let doors = 0
    for (const file of files) {
      for (const call of captureCalls(readFileSync(file, 'utf8'))) {
        doors += 1
        if (!/\b(initialLifecycleStage|lifecycleStage)\b/.test(call)) {
          unstaged.push(file.slice(REPO_ROOT.length + 1))
        }
      }
    }
    // The same control as above: a walk that saw no door proves nothing.
    expect(doors).toBeGreaterThan(10)
    expect(unstaged).toEqual([])
  })
})
