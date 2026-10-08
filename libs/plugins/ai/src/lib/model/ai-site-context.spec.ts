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

import { resolveBusinessProfile } from '@aglyn/aglyn/app-utils/business-profile'
import { AI_CACHE_PREFIX_TOKEN_CHARS } from '../runtime/ai-runtime'
import { aiHostPublishContext } from './ai-host-publish-context'
import {
  AI_SITE_CONTEXT_MAX_CHARS,
  AI_SITE_CONTEXT_RULE,
  aiSiteContextBlock,
  aiSiteContextSystemBlock,
  aiSiteInventoryIndex,
} from './ai-site-context'
import { emptyAiSiteInventory, type AiSiteInventory } from './ai-site-inventory'

const host = {
  orgId: 'org-1',
  displayName: 'Paws & Co',
  subdomain: 'paws',
  screens: { home: '/', services: '/services' },
  seo: {
    entity: {
      name: 'Paws and Company Grooming',
      description: 'Dog grooming with a calm, gentle hand.',
      telephone: '(512) 555-0100',
      email: 'hello@paws.example',
      openingHours: 'Mo-Fr 09:00-17:00',
      areaServed: ['Austin'],
    },
  },
  business: { socialLinks: [{ label: 'Instagram', url: 'https://instagram.com/paws' }] },
}

const fullProfile = resolveBusinessProfile({
  host,
  site: {
    services: ['Baths', 'Nail trims', 'De-shedding'],
    audience: 'Busy dog owners',
    tone: 'friendly',
    toneNotes: 'Never cutesy',
    sources: { services: 'owner', audience: 'start', tone: 'owner', toneNotes: 'owner' },
  },
})

const inventory = (): AiSiteInventory => ({
  ...emptyAiSiteInventory('host-1'),
  screens: [
    { id: 's1', name: 'Home', slug: '', layoutId: null, template: false },
    { id: 's2', name: 'Services', slug: 'services', layoutId: null, template: false },
    { id: 's3', name: 'About', slug: 'about', layoutId: null, template: false },
    { id: 's4', name: 'Post', slug: 'post', layoutId: null, template: true },
  ],
  forms: [{ id: 'f1', name: 'Contact', fields: ['Name', 'Email', 'Message'] }],
  components: [{ id: 'c1', name: 'Price card', props: { title: 'text' } }],
  layouts: [{ id: 'l1', name: 'Main', parentId: null }],
})

describe('aiSiteContextBlock (AGL-3661)', () => {
  it('states the profile, the real contact details, the site status and the memory, then the rule', () => {
    const text = aiSiteContextBlock({
      profile: fullProfile,
      publish: aiHostPublishContext(host),
      preferences: ['Prefers short, concise copy'],
    })
    expect(text).toContain('Business name: Paws and Company Grooming')
    expect(text).toContain('Services: Baths; Nail trims; De-shedding')
    expect(text).toContain('Tone of voice: Friendly and warm — Never cutesy')
    expect(text).toContain('phone (512) 555-0100')
    expect(text).toContain('Site: live at https://paws.')
    expect(text).toContain('Prefers short, concise copy')
    expect(text.endsWith(AI_SITE_CONTEXT_RULE)).toBe(true)
  })

  it('says no contact details were entered, rather than leaving room to invent them', () => {
    const text = aiSiteContextBlock({ profile: resolveBusinessProfile({ host: { displayName: 'New site' } }) })
    expect(text).toContain('Business name: New site')
    expect(text).toContain('Contact details: none entered yet.')
    expect(text).not.toMatch(/phone \(|email \S+@/)
    expect(text).toContain('Never invent')
  })

  it('leaves contact details and profiles out where the answer must print none', () => {
    const text = aiSiteContextBlock({ profile: fullProfile, contact: false })
    expect(text).not.toContain('555-0100')
    expect(text).not.toContain('instagram')
    expect(text).toContain('What it does: Dog grooming')
  })

  it('is empty when there is nothing to say, so no block is sent', () => {
    expect(aiSiteContextBlock({ profile: null })).toBe('')
    expect(aiSiteContextSystemBlock(null)).toEqual([])
  })

  it('holds the ceiling, dropping the index first and keeping the rule', () => {
    const big = inventory()
    big.screens = Array.from({ length: 40 }, (_, i) => ({
      id: `s${i}`,
      name: `A page with a long descriptive name number ${i}`,
      slug: `page-${i}`,
      layoutId: null,
      template: false,
    }))
    big.components = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, name: `Component ${i} with a long name`, props: {} }))
    const text = aiSiteContextBlock({
      profile: fullProfile,
      inventory: big,
      publish: aiHostPublishContext(host),
      preferences: Array.from({ length: 6 }, (_, i) => `Preference number ${i} with words`),
    })
    expect(text.length).toBeLessThanOrEqual(AI_SITE_CONTEXT_MAX_CHARS)
    expect(text).toContain(AI_SITE_CONTEXT_RULE)
    expect(text).toContain('Business name')
  })

  it('MEASURED: a full profile with status and memory, and the cap, in tokens', () => {
    const full = aiSiteContextBlock({
      profile: fullProfile,
      publish: aiHostPublishContext(host),
      preferences: ['Prefers short, concise copy', 'Removes testimonial and review sections'],
    })
    const empty = aiSiteContextBlock({ profile: resolveBusinessProfile({ host: { displayName: 'New site' } }) })
    const tokens = (text: string) => Math.ceil(text.length / AI_CACHE_PREFIX_TOKEN_CHARS)
    // The figures the report quotes; a change to the block moves them here first.
    expect(tokens(empty)).toBeLessThanOrEqual(150)
    expect(tokens(full)).toBeLessThanOrEqual(300)
    expect(AI_SITE_CONTEXT_MAX_CHARS / AI_CACHE_PREFIX_TOKEN_CHARS).toBe(400)
  })
})

describe('aiSiteContextSystemBlock (AGL-3661)', () => {
  it('is a cached breakpoint of its own, or volatile for a door out of breakpoints', () => {
    const input = { profile: fullProfile }
    expect(aiSiteContextSystemBlock(input)).toEqual([{ text: expect.any(String), cacheBreakpoint: true, site: true }])
    expect(aiSiteContextSystemBlock(input, { cache: false })).toEqual([{ text: expect.any(String), volatile: true, site: true }])
  })
})

describe('aiSiteInventoryIndex (AGL-3661)', () => {
  it('lists pages with whether each is live, forms by id with their size, components and layouts', () => {
    const lines = aiSiteInventoryIndex(inventory(), aiHostPublishContext(host))
    expect(lines).toEqual([
      'Pages: Home / (live); Services /services (live); About /about (draft)',
      'Forms: Contact [f1, 3 fields]',
      'Components: Price card [c1]',
      'Layouts: Main [l1]',
    ])
  })

  it('counts what it does not list', () => {
    const big = inventory()
    big.forms = Array.from({ length: 11 }, (_, i) => ({ id: `f${i}`, name: `Form ${i}`, fields: [] }))
    expect(aiSiteInventoryIndex(big)[1]).toMatch(/, and 3 more$/)
  })

  it('is empty without an inventory', () => {
    expect(aiSiteInventoryIndex(null)).toEqual([])
  })
})
