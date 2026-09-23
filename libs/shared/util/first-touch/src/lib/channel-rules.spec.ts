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
  ACQUISITION_CHANNELS,
  classifyChannel,
  DEFAULT_CHANNEL_RULES,
  displayHost,
  matchChannelRule,
  sourceAndMedium,
  type ChannelRule,
} from './channel-rules'
import type { FirstTouch } from './first-touch'

const at = Date.UTC(2026, 8, 23)
const touch = (overrides: Partial<FirstTouch> = {}): FirstTouch => ({
  v: 1,
  at,
  host: 'example.com',
  path: '/pricing',
  ref: null,
  ...overrides,
})

describe('the channel rule table', () => {
  it.each<[string, Partial<FirstTouch>, string]>([
    // The incident this was built for: a review site's link.
    ['a review site referral', { ref: 'www.g2.com' }, 'referral'],
    ['a search engine referrer', { ref: 'www.google.com' }, 'organic-search'],
    ['a country search engine', { ref: 'www.google.com.au' }, 'organic-search'],
    ['a second engine', { ref: 'duckduckgo.com' }, 'organic-search'],
    ['a tagged organic source', { utm: { source: 'bing' } }, 'organic-search'],
    ['utm_medium=organic from anywhere', { utm: { source: 'newsletter-x', medium: 'organic' } }, 'organic-search'],
    ['an ad click id', { click: ['gclid'] }, 'paid-search'],
    ['the other ad network', { click: ['msclkid'] }, 'paid-search'],
    ['a cpc medium', { utm: { source: 'capterra', medium: 'cpc' } }, 'paid-search'],
    ['a social referrer', { ref: 'www.linkedin.com' }, 'social'],
    ['a social shortener', { ref: 't.co' }, 'social'],
    ['a paid social post stays social', { utm: { source: 'linkedin', medium: 'cpc' } }, 'social'],
    ['the social click id', { click: ['fbclid'] }, 'social'],
    ['an email medium', { utm: { source: 'mailer', medium: 'email' } }, 'email'],
    ['a newsletter source', { utm: { source: 'newsletter' } }, 'email'],
    ['a webmail referrer', { ref: 'mail.google.com' }, 'email'],
    ['a tag with no known medium', { utm: { source: 'partner-x' } }, 'referral'],
    ['nothing external at all', {}, 'direct'],
    ['only an internal hop', { via: 'docs.example.com' }, 'direct'],
  ])('%s → the right channel', (_label, overrides, channel) => {
    expect(classifyChannel(touch(overrides))).toBe(channel)
  })

  it('puts an ad click ahead of a social referrer, and email ahead of both', () => {
    expect(classifyChannel(touch({ ref: 'www.linkedin.com', click: ['gclid'] }))).toBe('paid-search')
    expect(classifyChannel(touch({ utm: { medium: 'email' }, click: ['gclid'] }))).toBe('email')
  })

  it('does not mistake another product on a search engine domain for search', () => {
    expect(classifyChannel(touch({ ref: 'docs.google.com' }))).toBe('referral')
  })

  it('answers unknown when there is no touch to classify', () => {
    expect(classifyChannel(null)).toBe('unknown')
    expect(matchChannelRule(undefined)).toBeNull()
  })

  it('only ever answers one of the six channels for a real touch', () => {
    const channels = new Set(DEFAULT_CHANNEL_RULES.map((rule) => rule.channel))
    for (const channel of channels) expect(ACQUISITION_CHANNELS).toContain(channel)
    expect(DEFAULT_CHANNEL_RULES.every((rule) => rule.reason.length > 10)).toBe(true)
  })

  it('takes an install’s own table', () => {
    const rules: ChannelRule[] = [
      { channel: 'referral', reason: 'Everything external is a referral here', external: true },
    ]
    expect(classifyChannel(touch({ ref: 'www.google.com' }), rules)).toBe('referral')
    expect(classifyChannel(touch(), rules)).toBe('direct')
  })
})

describe('source and medium', () => {
  it('prefers the tags, then the referrer, then the ad network a click id names', () => {
    expect(sourceAndMedium(touch({ utm: { source: 'g2', medium: 'listing' }, ref: 'www.g2.com' }))).toEqual({
      source: 'g2',
      medium: 'listing',
    })
    expect(sourceAndMedium(touch({ ref: 'www.g2.com' }))).toEqual({ source: 'g2.com', medium: 'referral' })
    expect(sourceAndMedium(touch({ ref: 'www.google.com' }))).toEqual({ source: 'google.com', medium: 'organic' })
    expect(sourceAndMedium(touch({ click: ['gclid'] }))).toEqual({ source: 'google', medium: 'cpc' })
  })

  it('spells a direct visit and a missing touch the way reports do', () => {
    expect(sourceAndMedium(touch())).toEqual({ source: '(direct)', medium: '(none)' })
    expect(sourceAndMedium(null)).toEqual({ source: 'unknown', medium: 'unknown' })
  })

  it('drops the www. a browser adds, and nothing else', () => {
    expect(displayHost('www.g2.com')).toBe('g2.com')
    expect(displayHost('news.ycombinator.com')).toBe('news.ycombinator.com')
    expect(displayHost(null)).toBe('')
  })
})
