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

'use strict'

/**
 * The app definition holds to the rules `zapier validate` checks (AGL-3643),
 * read here because the platform package is not installed in the repo: keys
 * match their entries, every operation can run, every dropdown and search
 * names a key that exists, and every sample has an id.
 */

const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const app = require('../index')

const KEY = /^[a-zA-Z]+[a-zA-Z0-9_]*$/

const entries = (group) => Object.entries(app[group] || {})

describe('the Aglyn Zapier app definition (AGL-3643)', () => {
  it('names its version and the platform it is built on, from its package', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))
    expect(app.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(app.version).toBe(pkg.version)
    expect(app.platformVersion).toMatch(/^\d+\.\d+\.\d+$/)
    expect(app.platformVersion).toBe(pkg.dependencies['zapier-platform-core'])
  })

  it('holds the triggers, actions and searches the docs promise, and no more', () => {
    expect(Object.keys(app.triggers).sort()).toEqual(
      ['new_booking', 'new_contact', 'new_form_submission', 'new_paid_order', 'site', 'updated_booking', 'updated_order'].sort(),
    )
    expect(Object.keys(app.creates).sort()).toEqual(['create_contact', 'fulfill_order', 'update_contact'])
    expect(Object.keys(app.searches).sort()).toEqual(['find_contact', 'find_order'])
  })

  for (const group of ['triggers', 'creates', 'searches']) {
    it(`gives every ${group} entry a key that matches, a noun, words and an operation that can run`, () => {
      for (const [key, entry] of entries(group)) {
        expect(entry.key).toBe(key)
        expect(key).toMatch(KEY)
        expect(typeof entry.noun).toBe('string')
        expect(entry.display.label.length).toBeGreaterThan(0)
        expect(entry.display.description.length).toBeGreaterThan(0)
        expect(typeof entry.operation.perform).toBe('function')
        expect(entry.operation.sample).toEqual(expect.objectContaining({ id: expect.any(String) }))
        for (const field of entry.operation.inputFields || []) expect(field.key).toMatch(KEY)
      }
    })
  }

  it('describes each visible trigger as Zapier asks, “Triggers when…”', () => {
    for (const [, trigger] of entries('triggers')) {
      if (trigger.display.hidden) continue
      expect(trigger.display.description).toMatch(/^Triggers when /)
    }
  })

  it('gives every instant trigger a subscribe, an unsubscribe and a list for the sample', () => {
    const hooks = entries('triggers').filter(([, trigger]) => trigger.operation.type === 'hook')
    expect(hooks).toHaveLength(6)
    for (const [, trigger] of hooks) {
      expect(typeof trigger.operation.performSubscribe).toBe('function')
      expect(typeof trigger.operation.performUnsubscribe).toBe('function')
      expect(typeof trigger.operation.performList).toBe('function')
      expect(trigger.operation.inputFields[0]).toMatchObject({ key: 'siteId', required: true, dynamic: 'site.id.name' })
    }
  })

  it('points every dropdown and search field at a key that exists', () => {
    const all = [...entries('triggers'), ...entries('creates'), ...entries('searches')]
    for (const [, entry] of all) {
      for (const field of entry.operation.inputFields || []) {
        if (field.dynamic) {
          const [trigger, id, label] = field.dynamic.split('.')
          expect(app.triggers[trigger]).toBeDefined()
          expect(app.triggers[trigger].operation.sample).toHaveProperty(id)
          expect(app.triggers[trigger].operation.sample).toHaveProperty(label)
        }
        if (field.search) {
          const [search, id] = field.search.split('.')
          expect(app.searches[search]).toBeDefined()
          expect(app.searches[search].operation.sample).toHaveProperty(id)
        }
      }
    }
  })

  it('pairs Find Contact with Create Contact, the create taking every field the search does', () => {
    const pair = app.searchOrCreates.find_contact
    expect(pair.key).toBe(pair.search)
    expect(app.searches[pair.search]).toBeDefined()
    expect(app.creates[pair.create]).toBeDefined()
    const createKeys = app.creates[pair.create].operation.inputFields.map((field) => field.key)
    for (const field of app.searches[pair.search].operation.inputFields) expect(createKeys).toContain(field.key)
  })

  it('keeps a boolean or choice default a string, as the platform reads them', () => {
    for (const [, entry] of entries('creates')) {
      for (const field of entry.operation.inputFields || []) {
        if ('default' in field) expect(typeof field.default).toBe('string')
        if (field.choices && field.default) expect(Object.keys(field.choices)).toContain(field.default)
      }
    }
  })

  it('authenticates with an API key, as a password field', () => {
    expect(app.authentication.type).toBe('custom')
    expect(app.authentication.fields).toEqual([expect.objectContaining({ key: 'apiKey', type: 'password', required: true })])
  })
})
