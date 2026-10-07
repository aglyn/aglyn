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

import { setRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  filePluginPersonUnder,
  findPluginPerson,
  pluginPeopleChangedSince,
  pluginPeopleInView,
  pluginPeopleWroteIn,
  pluginPersonRecords,
  readPluginPeople,
  recordPluginPersonRefund,
  registerPluginPersonRecords,
  searchPluginPeople,
  type PluginPersonChangesPage,
  type PluginPersonChangesRequest,
  type PluginPersonRecords,
} from './plugin-person-records'
import { resetPluginServicesForTests } from './plugin-services'

const PERSON = { kind: 'contact', id: 'c-1', email: 'pat@example.com', data: { email: 'pat@example.com' } }

function owner(calls: string[] = []): PluginPersonRecords {
  return {
    async find(request) {
      calls.push(`find:${String(request.email)}:${request.onlyVisibleToSite === true}`)
      return PERSON
    },
    async read(request) {
      calls.push(`read:${request.records.map((record) => record.id).join(',')}`)
      return request.records.map((record) => (record.id === 'c-1' ? PERSON : null))
    },
  }
}

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('the people a workspace keeps (AGL-3080)', () => {
  it('answers null for every question while no plugin keeps people', async () => {
    expect(pluginPersonRecords()).toBeNull()
    expect(await findPluginPerson({ hostId: 'h', email: 'pat@example.com' })).toBeNull()
    expect(await readPluginPeople({ orgId: 'o', records: [{ kind: 'contact', id: 'c-1' }] })).toBeNull()
    expect(
      await filePluginPersonUnder({
        hostId: 'h',
        record: { kind: 'contact', id: 'c-1' },
        containerKind: 'campaign',
        ids: ['k'],
      }),
    ).toBeNull()
    expect(
      await recordPluginPersonRefund({
        hostId: 'h',
        email: 'pat@example.com',
        amountCents: 100,
        refId: 'o-1',
        closedTheSale: false,
      }),
    ).toBeNull()
  })

  it('asks the plugin that registered, with its owner, and hands the request over whole', async () => {
    const calls: string[] = []
    setRegisteringPluginId('records')
    registerPluginPersonRecords(owner(calls))
    setRegisteringPluginId(undefined)

    expect(pluginPersonRecords()?.pluginId).toBe('records')
    expect(
      await findPluginPerson({ hostId: 'h', email: 'Pat@Example.com', onlyVisibleToSite: true }),
    ).toEqual(PERSON)
    expect(
      await readPluginPeople({
        orgId: 'o',
        records: [
          { kind: 'contact', id: 'c-1' },
          { kind: 'lead', id: 'gone' },
        ],
      }),
    ).toEqual([PERSON, null])
    expect(calls).toEqual(['find:Pat@Example.com:true', 'read:c-1,gone'])
  })

  it('reads nothing for no records', async () => {
    const calls: string[] = []
    registerPluginPersonRecords(owner(calls), { pluginId: 'records' })
    expect(await readPluginPeople({ orgId: 'o', records: [] })).toEqual([])
    expect(calls).toEqual([])
  })

  it('keeps one set of people: a second plugin is refused and the incumbent keeps serving', async () => {
    registerPluginPersonRecords(owner(), { pluginId: 'records' })
    expect(() => registerPluginPersonRecords(owner(), { pluginId: 'other' })).toThrow(/records/)
    expect(pluginPersonRecords()?.pluginId).toBe('records')
  })

  it('lets a failed read reach the caller, which decides which way it falls', async () => {
    registerPluginPersonRecords(
      {
        ...owner(),
        async find() {
          throw new Error('storage down')
        },
      },
      { pluginId: 'records' },
    )
    await expect(findPluginPerson({ hostId: 'h', email: 'pat@example.com' })).rejects.toThrow(
      'storage down',
    )
  })

  it('answers null for a filing or a refund the owner keeps no place for', async () => {
    registerPluginPersonRecords(owner(), { pluginId: 'records' })
    expect(
      await filePluginPersonUnder({
        hostId: 'h',
        record: { kind: 'contact', id: 'c-1' },
        containerKind: 'campaign',
        ids: ['k'],
      }),
    ).toBeNull()
    expect(
      await recordPluginPersonRefund({
        hostId: 'h',
        email: 'pat@example.com',
        amountCents: 100,
        refId: 'o-1',
        closedTheSale: true,
      }),
    ).toBeNull()
  })

  it('files under nothing without asking when no container is named', async () => {
    const fileUnder = jest.fn(async () => ({ filed: true }))
    registerPluginPersonRecords({ ...owner(), fileUnder }, { pluginId: 'records' })
    expect(
      await filePluginPersonUnder({
        hostId: 'h',
        record: { kind: 'contact', id: 'c-1' },
        containerKind: 'campaign',
        ids: [],
      }),
    ).toEqual({ filed: false })
    expect(fileUnder).not.toHaveBeenCalled()
  })

  it('never lets a refund fail the caller: a throw is logged and answered as null', async () => {
    registerPluginPersonRecords(
      {
        ...owner(),
        async recordRefund() {
          throw new Error('storage down')
        },
      },
      { pluginId: 'records' },
    )
    expect(
      await recordPluginPersonRefund({
        hostId: 'h',
        email: 'pat@example.com',
        amountCents: 100,
        refId: 'o-1',
        closedTheSale: false,
      }),
    ).toBeNull()
    expect(console.error).toHaveBeenCalled()
  })
})

describe('views and what people wrote', () => {
  const VIEW = { orgId: 'o', hostId: 'h', viewId: 'v-1', viewerUid: 'u-1', limit: 50 }

  it('answers null for both while no plugin keeps people, or keeps neither', async () => {
    expect(await pluginPeopleInView(VIEW)).toBeNull()
    expect(await pluginPeopleWroteIn({ orgId: 'o', records: [{ kind: 'contact', id: 'c-1' }] })).toBeNull()
    registerPluginPersonRecords(owner(), { pluginId: 'records' })
    expect(await pluginPeopleInView(VIEW)).toBeNull()
    expect(await pluginPeopleWroteIn({ orgId: 'o', records: [{ kind: 'contact', id: 'c-1' }] })).toBeNull()
  })

  it('hands the view and the records over, and answers what the owner answered', async () => {
    const peopleInView = jest.fn(async () => ({
      ok: true as const,
      people: [{ kind: 'lead', id: 'l-1' }],
      total: 1,
      truncated: false,
    }))
    const wroteIn = jest.fn(async () => [true, null])
    registerPluginPersonRecords({ ...owner(), peopleInView, wroteIn }, { pluginId: 'records' })
    expect(await pluginPeopleInView(VIEW)).toEqual({
      ok: true,
      people: [{ kind: 'lead', id: 'l-1' }],
      total: 1,
      truncated: false,
    })
    expect(peopleInView).toHaveBeenCalledWith(VIEW)
    const records = [
      { kind: 'contact', id: 'c-1' },
      { kind: 'lead', id: 'l-1' },
    ]
    expect(await pluginPeopleWroteIn({ orgId: 'o', records })).toEqual([true, null])
    expect(await pluginPeopleWroteIn({ orgId: 'o', records: [] })).toEqual([])
    expect(wroteIn).toHaveBeenCalledTimes(1)
  })

  it('reads an owner that failed to say who wrote in as unknown, never as a throw', async () => {
    registerPluginPersonRecords(
      {
        ...owner(),
        async wroteIn() {
          throw new Error('storage down')
        },
      },
      { pluginId: 'records' },
    )
    expect(await pluginPeopleWroteIn({ orgId: 'o', records: [{ kind: 'contact', id: 'c-1' }] })).toBeNull()
  })
})

describe('searching people by what was typed (AGL-3609)', () => {
  const SEARCH = { hostId: 'h', text: 'pat', limit: 10 }

  it('answers null while no plugin keeps people, or the one that does keeps no search', async () => {
    expect(await searchPluginPeople(SEARCH)).toBeNull()
    registerPluginPersonRecords(owner(), { pluginId: 'records' })
    expect(await searchPluginPeople(SEARCH)).toBeNull()
  })

  it('hands the request over whole and answers what the owner found', async () => {
    const search = jest.fn(async () => [PERSON])
    registerPluginPersonRecords({ ...owner(), search }, { pluginId: 'records' })
    expect(await searchPluginPeople(SEARCH)).toEqual([PERSON])
    expect(search).toHaveBeenCalledWith(SEARCH)
  })

  it('answers no one for blank text or no room, without asking', async () => {
    const search = jest.fn(async () => [PERSON])
    registerPluginPersonRecords({ ...owner(), search }, { pluginId: 'records' })
    expect(await searchPluginPeople({ ...SEARCH, text: '   ' })).toEqual([])
    expect(await searchPluginPeople({ ...SEARCH, limit: 0 })).toEqual([])
    expect(search).not.toHaveBeenCalled()
  })

  it('lets a failed search reach the caller', async () => {
    registerPluginPersonRecords(
      {
        ...owner(),
        async search() {
          throw new Error('index down')
        },
      },
      { pluginId: 'records' },
    )
    await expect(searchPluginPeople(SEARCH)).rejects.toThrow('index down')
  })
})

describe('the people a site holds, walked by change (AGL-3639)', () => {
  const REQUEST: PluginPersonChangesRequest = { hostId: 'h', after: null, limit: 50 }

  it('answers null while no plugin keeps people, or the one that does cannot walk them', async () => {
    expect(await pluginPeopleChangedSince(REQUEST)).toBeNull()
    registerPluginPersonRecords(owner(), { pluginId: 'records' })
    expect(await pluginPeopleChangedSince(REQUEST)).toBeNull()
  })

  it('hands the owner the request with its limit clamped, and its page back', async () => {
    const page: PluginPersonChangesPage = { people: [], next: 'cursor-2' }
    const changedSince = jest.fn(async () => page)
    registerPluginPersonRecords({ ...owner(), changedSince }, { pluginId: 'records' })
    expect(await pluginPeopleChangedSince({ ...REQUEST, limit: 10_000 })).toBe(page)
    expect(changedSince).toHaveBeenCalledWith({ ...REQUEST, limit: 500 })
    await pluginPeopleChangedSince({ ...REQUEST, limit: 0 })
    expect(changedSince).toHaveBeenLastCalledWith({ ...REQUEST, limit: 1 })
  })

  it('lets a failed read throw, so a walk never advances past what it did not read', async () => {
    registerPluginPersonRecords(
      { ...owner(), changedSince: async () => Promise.reject(new Error('quota')) },
      { pluginId: 'records' },
    )
    await expect(pluginPeopleChangedSince(REQUEST)).rejects.toThrow('quota')
  })
})
