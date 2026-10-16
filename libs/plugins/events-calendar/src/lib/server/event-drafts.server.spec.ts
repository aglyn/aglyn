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
 * The `event` draft writer (AGL-3743), against the real plan table and the
 * real event rule: only the Admin SDK is a double, one that honors
 * transactions.
 *
 *  - THE REFUSAL is the Events page's gate: the add-on, and a write role.
 *  - THE CHECK reads wall times in a zone and holds the rest to `eventWrite`.
 *  - THE WRITE makes an event that starts after it, and asked again finds it.
 *  - PUBLISHED for the publishing role, as the Events page publishes; a
 *    member who may write but not publish gets a draft and a notice (AGL-3755).
 */

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({ __esModule: true, firebaseAdmin: {} }))

import { checkEventDraftContent, eventDraftInstant, readEventDraftContent } from '../model/event-draft-content'
import { EVENT_DEFAULT_DURATION_MS } from '../model/event-write'
import {
  createEventDraftWriter,
  EVENT_DRAFT_PLAN_REFUSAL,
  EVENT_DRAFT_ROLE_REFUSAL,
  EVENT_DRAFT_UNPUBLISHED_NOTICE,
  eventDraftPastRefusal,
} from './event-drafts.server'

const NOW = new Date('2026-10-12T15:00:00.000Z')

// ── Firestore double ─────────────────────────────────────────────────────

const store = new Map<string, Record<string, unknown>>()
let commits: string[] = []

function snapshotOf(path: string) {
  const data = store.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => (data ? data[field] : undefined),
  }
}

function docRef(path: string): Record<string, unknown> {
  return {
    kind: 'doc',
    path,
    id: path.split('/').pop(),
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get: async () => snapshotOf(path),
  }
}

function collectionRef(path: string): Record<string, unknown> {
  return { path, doc: (id: string) => docRef(`${path}/${id}`) }
}

const firestore = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async (body: (tx: unknown) => Promise<unknown>) => {
    const creates: Array<[string, Record<string, unknown>]> = []
    const result = await body({
      get: async (target: { path: string }) => snapshotOf(target.path),
      create: (ref: { path: string }, data: Record<string, unknown>) => {
        creates.push([ref.path, data])
      },
    })
    for (const [path, data] of creates) {
      if (store.has(path)) throw new Error(`6 ALREADY_EXISTS: ${path}`)
      store.set(path, data)
      commits.push(path)
    }
    return result
  },
} as unknown as FirebaseFirestore.Firestore

const writer = createEventDraftWriter({ firestore: () => firestore })

// ── Fixtures ─────────────────────────────────────────────────────────────

/** A workspace that bought the add-on. */
const WITH_ADDON = { plan: 'pro', entitlements: { features: { eventCalendar: true } } }
/** A paid plan without it: no plan includes the calendar. */
const WITHOUT_ADDON = { plan: 'business' }

const CONTENT = {
  title: 'Autumn sourdough workshop',
  startsAt: '2026-11-14T10:00',
  endsAt: '2026-11-14T13:00',
  timezone: 'America/Chicago',
  location: 'Hearth & Crumb Bakery, 412 Elm St, Austin',
  organizer: 'Hearth & Crumb Bakery',
  description: 'Mix, shape and bake a country loaf with our head baker. You take home your loaf and a jar of starter.',
}

/** 10:00 on 14 November 2026 in Chicago (CST, UTC−6). */
const STARTS = Date.UTC(2026, 10, 14, 16, 0)

const request = (patch: Record<string, unknown> = {}) => ({
  orgId: 'org-1',
  hostId: 'host-1',
  uid: 'uid-1',
  org: WITH_ADDON as Record<string, unknown>,
  now: NOW,
  id: 'job-1-i0',
  name: 'Autumn sourdough workshop',
  content: CONTENT,
  ...patch,
})

beforeEach(() => {
  store.clear()
  commits = []
  store.set('hosts/host-1', { memberRoles: { 'uid-1': 'editor', 'uid-2': 'viewer', 'uid-3': 'author' } })
})

describe('the event writer', () => {
  it('writes and publishes the event the editor saves, at the instant its wall time names (AGL-3755)', async () => {
    const written = await writer.write(request())
    expect(written).toEqual({
      ok: true,
      replayed: false,
      id: 'job-1-i0',
      name: 'Autumn sourdough workshop',
      versionId: null,
      facts: { status: 'published', startsAtMs: STARTS, endsAtMs: STARTS + 3 * 60 * 60 * 1000 },
      live: true,
    })
    expect(store.get('hosts/host-1/events/job-1-i0')).toEqual({
      title: 'Autumn sourdough workshop',
      startsAtMs: STARTS,
      endsAtMs: STARTS + 3 * 60 * 60 * 1000,
      location: CONTENT.location,
      organizer: CONTENT.organizer,
      description: CONTENT.description,
      status: 'published',
      createdAt: NOW,
      updatedAt: NOW,
      createdBy: 'uid-1',
    })
  })

  it('gives an event with no end the editor’s default length', async () => {
    await writer.write(request({ content: { ...CONTENT, endsAt: undefined } }))
    expect(store.get('hosts/host-1/events/job-1-i0')).toMatchObject({
      startsAtMs: STARTS,
      endsAtMs: STARTS + EVENT_DEFAULT_DURATION_MS,
    })
  })

  it('refuses a start that is not after the write, and writes nothing', async () => {
    const written = await writer.write(request({ content: { ...CONTENT, startsAt: '2026-10-01T10:00', endsAt: undefined } }))
    expect(written).toEqual({ ok: false, status: 400, error: eventDraftPastRefusal('2026-10-01 10:00') })
    expect(commits).toEqual([])
  })

  it('finds its draft when asked again under the same id, and writes nothing more', async () => {
    await writer.write(request())
    commits = []
    expect(await writer.write(request({ name: 'Something else' }))).toMatchObject({
      ok: true,
      replayed: true,
      id: 'job-1-i0',
      name: 'Autumn sourdough workshop',
      facts: { status: 'published' },
      live: true,
    })
    expect(commits).toEqual([])
    expect(await writer.read({ hostId: 'host-1', id: 'job-1-i0' })).toMatchObject({ id: 'job-1-i0', versionId: null })
    expect(await writer.read({ hostId: 'host-1', id: 'nothing' })).toBeNull()
  })

  it('never brings back an event a person deleted, and reads it as gone', async () => {
    await writer.write(request())
    store.set('hosts/host-1/events/job-1-i0', { ...store.get('hosts/host-1/events/job-1-i0'), status: 'deleted', deletedAt: NOW })
    expect(await writer.read({ hostId: 'host-1', id: 'job-1-i0' })).toBeNull()
    expect(await writer.write(request())).toMatchObject({ ok: false, status: 409 })
  })

  it('keeps an author’s event as a draft, saying why, since an author may write but not publish (AGL-3755)', async () => {
    const written = await writer.write(request({ uid: 'uid-3' }))
    expect(written).toMatchObject({
      ok: true,
      facts: { status: 'draft' },
      live: false,
      notice: EVENT_DRAFT_UNPUBLISHED_NOTICE,
    })
    expect(store.get('hosts/host-1/events/job-1-i0')).toMatchObject({ status: 'draft', createdBy: 'uid-3' })
  })

  it('publishes for an admin too, and nothing beyond the status the Events page sets', async () => {
    store.set('hosts/host-1', { memberRoles: { 'uid-1': 'admin' } })
    await writer.write(request())
    const stored = store.get('hosts/host-1/events/job-1-i0') as Record<string, unknown>
    expect(stored['status']).toBe('published')
    expect(Object.keys(stored).sort()).toEqual(
      ['createdAt', 'createdBy', 'description', 'endsAtMs', 'location', 'organizer', 'startsAtMs', 'status', 'title', 'updatedAt'],
    )
  })

  it('reports an author’s draft as published once a person publishes it', async () => {
    await writer.write(request({ uid: 'uid-3' }))
    store.set('hosts/host-1/events/job-1-i0', { ...store.get('hosts/host-1/events/job-1-i0'), status: 'published' })
    expect(await writer.read({ hostId: 'host-1', id: 'job-1-i0' })).toMatchObject({ facts: { status: 'published' }, live: true })
  })

  describe('its cover (AGL-3755)', () => {
    const PICK = { src: 'media:hosts/host-1/m-1', url: '/api/media/cdn/hosts/host-1/m-1', width: 1600, height: 1067, origin: 'library' as const }
    const picking = (answer: unknown = PICK) => {
      const pick = jest.fn(async () => answer as never)
      return { pick, writer: createEventDraftWriter({ firestore: () => firestore, stockPhotos: () => ({ pick }) }) }
    }

    it('asks the picker for a photo of the title, scoped to the act, and stores its address in the cover field', async () => {
      const { pick, writer: covered } = picking()
      const written = await covered.write({ ...request(), act: { id: 'job-1', business: 'a sourdough bakery in Austin' } })
      expect(pick).toHaveBeenCalledWith({
        hostId: 'host-1',
        uid: 'uid-1',
        subject: 'Autumn sourdough workshop',
        business: 'a sourdough bakery in Austin',
        orientation: 'horizontal',
        scope: 'job-1',
        seed: 'job-1-i0',
      })
      expect(written).toMatchObject({ ok: true, facts: { coverImage: PICK.url } })
      const stored = store.get('hosts/host-1/events/job-1-i0') as Record<string, unknown>
      expect(stored['coverImage']).toBe(PICK.url)
      // No description is invented: the list shows the cover beside the title that names it.
      expect(stored['coverImageAlt']).toBeUndefined()
    })

    it('stores the words the picker describes the photo by, so the list never draws it with an empty alt (AGL-3856)', async () => {
      const { writer: covered } = picking({ ...PICK, alt: 'A barbell, crossfit and lifting' })
      await covered.write(request())
      const stored = store.get('hosts/host-1/events/job-1-i0') as Record<string, unknown>
      expect(stored['coverImage']).toBe(PICK.url)
      expect(stored['coverImageAlt']).toBe('A barbell, crossfit and lifting')
    })

    it('takes a starter photo’s path as it takes a library photo’s', async () => {
      const { writer: covered } = picking({ ...PICK, src: '/_static/starter/desk.jpg', url: '/_static/starter/desk.jpg', origin: 'starter' })
      await covered.write(request())
      expect(store.get('hosts/host-1/events/job-1-i0')).toMatchObject({ coverImage: '/_static/starter/desk.jpg' })
    })

    it('keeps the cover the content names, and asks for none', async () => {
      const { pick, writer: covered } = picking()
      await covered.write(request({ content: { ...CONTENT, coverImage: 'https://example.com/loaf.jpg' } }))
      expect(pick).not.toHaveBeenCalled()
      expect(store.get('hosts/host-1/events/job-1-i0')).toMatchObject({ coverImage: 'https://example.com/loaf.jpg' })
    })

    it('fetches nothing for a replay, a refused member or a workspace without the add-on', async () => {
      const { pick, writer: covered } = picking()
      await covered.write(request())
      pick.mockClear()
      await covered.write(request())
      await covered.write(request({ id: 'job-1-i1', uid: 'uid-2' }))
      await covered.write(request({ id: 'job-1-i2', org: WITHOUT_ADDON }))
      expect(pick).not.toHaveBeenCalled()
    })

    it('writes the event without a cover when the picker has none, fails, or answers an address the field refuses', async () => {
      for (const [index, answer] of [null, { ...PICK, url: 'javascript:alert(1)' }].entries()) {
        const { writer: covered } = picking(answer)
        await covered.write(request({ id: `job-1-n${index}` }))
        expect(store.get(`hosts/host-1/events/job-1-n${index}`)).not.toHaveProperty('coverImage')
      }
      const failing = createEventDraftWriter({
        firestore: () => firestore,
        stockPhotos: () => ({ pick: async () => { throw new Error('library down') } }),
      })
      expect(await failing.write(request({ id: 'job-1-f' }))).toMatchObject({ ok: true })
      expect(store.get('hosts/host-1/events/job-1-f')).not.toHaveProperty('coverImage')
      const none = createEventDraftWriter({ firestore: () => firestore, stockPhotos: () => null })
      expect(await none.write(request({ id: 'job-1-x' }))).toMatchObject({ ok: true })
    })
  })

  it('refuses content the check refuses, with its first problem', async () => {
    expect(await writer.write(request({ name: '', content: { ...CONTENT, title: ' ' } }))).toEqual({
      ok: false,
      status: 400,
      error: 'The event needs a title',
    })
    expect(commits).toEqual([])
  })
})

describe('the refusal', () => {
  it('admits an editor on a workspace with the add-on', async () => {
    expect(await writer.refusal(request())).toBeNull()
  })

  it('refuses a workspace without the add-on, whatever its plan', async () => {
    const refusal = { status: 403, error: EVENT_DRAFT_PLAN_REFUSAL }
    expect(await writer.refusal(request({ org: WITHOUT_ADDON }))).toEqual(refusal)
    expect(await writer.write(request({ org: WITHOUT_ADDON }))).toEqual({ ok: false, ...refusal })
    expect(commits).toEqual([])
  })

  it('refuses a member who may not write the site', async () => {
    const refusal = { status: 403, error: EVENT_DRAFT_ROLE_REFUSAL }
    expect(await writer.refusal(request({ uid: 'uid-2' }))).toEqual(refusal)
    expect(await writer.write(request({ uid: 'uid-2' }))).toEqual({ ok: false, ...refusal })
  })

  it('answers an unknown site', async () => {
    expect(await writer.refusal(request({ hostId: 'host-x' }))).toEqual({ status: 404, error: 'Unknown site' })
    expect(await writer.write(request({ hostId: 'host-x' }))).toEqual({ ok: false, status: 404, error: 'Unknown site' })
  })
})

describe('the check', () => {
  const problemsOf = (patch: Record<string, unknown>) => {
    const check = checkEventDraftContent({ ...CONTENT, ...patch })
    return check.ok === false ? check.problems : []
  }

  it('passes the content with when it starts, as its own zone reads it', () => {
    expect(checkEventDraftContent(CONTENT)).toEqual({
      ok: true,
      facts: { status: 'draft', startsAtMs: STARTS, timezone: 'America/Chicago', startsAt: '2026-11-14 10:00' },
    })
  })

  it('reads a wall time across a change of clocks in the zone it names', () => {
    // CDT (UTC−5) in October, CST (UTC−6) in November.
    expect(eventDraftInstant('2026-10-20T19:00', 'America/Chicago')).toBe(Date.UTC(2026, 9, 21, 0, 0))
    expect(eventDraftInstant('2026-11-20T19:00', 'America/Chicago')).toBe(Date.UTC(2026, 10, 21, 1, 0))
    expect(eventDraftInstant('2026-11-20T19:00', 'Europe/London')).toBe(Date.UTC(2026, 10, 20, 19, 0))
  })

  it('needs a title, a real zone and a real start', () => {
    expect(problemsOf({ title: '' })).toEqual(['The event needs a title'])
    expect(problemsOf({ title: 'x'.repeat(151) })).toEqual(['The title is longer than 150 characters'])
    expect(problemsOf({ timezone: 'Mars/Olympus_Mons' })).toEqual(['The time zone is an IANA zone, such as America/Chicago'])
    for (const startsAt of ['2026-11-14', '14/11/2026 10:00', '2026-13-01T10:00', '2026-02-30T10:00', '2026-11-14T24:30']) {
      expect([startsAt, problemsOf({ startsAt })]).toEqual([startsAt, ['The start is a date and time, written YYYY-MM-DDTHH:MM']])
    }
  })

  it('holds the end after the start', () => {
    expect(problemsOf({ endsAt: '2026-11-14T09:00' })).toEqual(['The end is after the start'])
    expect(problemsOf({ endsAt: '2026-11-14T10:00' })).toEqual(['The end is after the start'])
    expect(problemsOf({ endsAt: 'later' })).toEqual(['The end is a date and time, written YYYY-MM-DDTHH:MM'])
  })

  it('holds text to what the editor stores, and a cover to an address', () => {
    expect(problemsOf({ location: 'x'.repeat(201) })).toEqual(['The location is longer than 200 characters'])
    expect(problemsOf({ description: 42 })).toEqual(['The description is text'])
    expect(problemsOf({ coverImage: 'javascript:alert(1)' })).toEqual(['The cover image is an https address or a path on the site'])
    expect(problemsOf({ coverImage: 'https://images.example.com/loaf.jpg', coverImageAlt: 'A scored country loaf' })).toEqual([])
  })

  it('reads every event as a draft, whatever the content says', () => {
    const read = readEventDraftContent({ ...CONTENT, status: 'published' })
    expect(read.ok && read.value.status).toBe('draft')
  })
})
