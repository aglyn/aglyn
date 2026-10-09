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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  validatePluginConfigValues,
  mergePluginConfig,
} from '@aglyn/aglyn/plugin-manager/plugin-config'
import {
  WEGLOT_CONNECT_HOSTS,
  WEGLOT_IMAGE_HOSTS,
  WEGLOT_PLUGIN_ID,
} from '../constants'
import {
  WEGLOT_CONFIG_SCHEMA,
  WEGLOT_MAX_TARGET_LANGUAGES,
  parseWeglotLanguageList,
  readWeglotSiteSettings,
  resolveWeglotSiteSettings,
  validateWeglotConfig,
} from './weglot-settings'

const KEY = 'wg_0123456789abcdef0123456789abcdef'

const valid = {
  enabled: true,
  apiKey: KEY,
  sourceLanguage: 'en',
  targetLanguages: 'fr, es,de',
  switcher: 'aglyn',
  switcherPosition: 'bottom-left',
}

describe('Weglot settings validation (AGL-3700)', () => {
  it('lets a switched-off form be saved half-filled', () => {
    expect(validateWeglotConfig({ enabled: false, apiKey: 'nope' })).toBeNull()
    expect(validateWeglotConfig(WEGLOT_CONFIG_SCHEMA.defaults)).toBeNull()
  })

  it('accepts a complete configuration', () => {
    expect(validateWeglotConfig(valid)).toBeNull()
  })

  it.each([
    [{ apiKey: '' }, /Add your Weglot API key/],
    [{ apiKey: 'sk_live_abcdefabcdefabcdef' }, /not a Weglot API key/],
    [{ apiKey: 'wg_short' }, /not a Weglot API key/],
    [{ apiKey: `${KEY}"};alert(1)//` }, /not a Weglot API key/],
    [{ sourceLanguage: 'English' }, /language your site is written in/],
    [{ targetLanguages: '' }, /at least one language/],
    [{ targetLanguages: 'fr, <script>' }, /Not a language code: <script>/],
    [{ targetLanguages: 'fr, en' }, /cannot include the language your site is written in/],
  ])('refuses %p', (patch, message) => {
    expect(validateWeglotConfig({ ...valid, ...patch })).toMatch(message)
  })

  it('caps the number of target languages', () => {
    const many = Array.from({ length: WEGLOT_MAX_TARGET_LANGUAGES + 1 }, (_, index) =>
      `x${String.fromCharCode(97 + (index % 26))}-r${index}`,
    ).join(',')
    expect(validateWeglotConfig({ ...valid, targetLanguages: many })).toMatch(/at most/)
  })

  it('is the schema validation the console card runs', () => {
    const result = validatePluginConfigValues(WEGLOT_CONFIG_SCHEMA, {
      ...valid,
      apiKey: 'nope',
    })
    expect(result.ok).toBe(false)
  })

  it('reads codes typed with commas or spaces, normalized and without repeats', () => {
    expect(parseWeglotLanguageList(' FR,es  de;fr pt-BR')).toEqual({
      codes: ['fr', 'es', 'de', 'pt-br'],
      invalid: [],
    })
  })
})

describe('what a published page may run', () => {
  it('resolves a valid configuration, normalized', () => {
    expect(
      resolveWeglotSiteSettings({ ...valid, sourceLanguage: ' EN ', apiKey: ` ${KEY} ` }),
    ).toEqual({
      apiKey: KEY,
      sourceLanguage: 'en',
      targetLanguages: ['fr', 'es', 'de'],
      switcher: 'aglyn',
      switcherPosition: 'bottom-left',
    })
  })

  it('answers null when switched off, invalid, or absent', () => {
    expect(resolveWeglotSiteSettings(null)).toBeNull()
    expect(resolveWeglotSiteSettings({ ...valid, enabled: false })).toBeNull()
    expect(resolveWeglotSiteSettings({ ...valid, enabled: 'true' })).toBeNull()
    expect(resolveWeglotSiteSettings({ ...valid, apiKey: 'nope' })).toBeNull()
    expect(resolveWeglotSiteSettings({ ...valid, targetLanguages: '' })).toBeNull()
  })

  it('falls back to the default switcher and corner for unknown values', () => {
    const settings = resolveWeglotSiteSettings({
      ...valid,
      switcher: 'iframe',
      switcherPosition: 'top-center',
    })
    expect(settings?.switcher).toBe('aglyn')
    expect(settings?.switcherPosition).toBe('bottom-right')
  })

  it('coerces stored documents through the schema before resolving', () => {
    const merged = mergePluginConfig(WEGLOT_CONFIG_SCHEMA, {
      ...valid,
      stray: 'dropped',
    })
    expect(merged).not.toHaveProperty('stray')
    expect(resolveWeglotSiteSettings(merged)).not.toBeNull()
  })

  it('re-reads a slice that crossed the wire, and refuses junk', () => {
    const settings = resolveWeglotSiteSettings(valid)
    expect(readWeglotSiteSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings)
    expect(readWeglotSiteSettings(undefined)).toBeNull()
    expect(readWeglotSiteSettings('wg_x')).toBeNull()
    expect(readWeglotSiteSettings({ ...settings, apiKey: 'wg_<x>' })).toBeNull()
    expect(
      readWeglotSiteSettings({ ...settings, targetLanguages: ['fr', '"x'] }),
    ).toBeNull()
  })
})

describe('the settings card', () => {
  it('says plainly that translations are for visitors, not search', () => {
    expect(WEGLOT_CONFIG_SCHEMA.notice).toMatch(/may not rank in other languages/)
    expect(WEGLOT_CONFIG_SCHEMA.notice).toMatch(/Business/)
    expect(WEGLOT_CONFIG_SCHEMA.affectsPublishedPages).toBe(true)
    // Its `?` links its own docs heading, not the generic settings section.
    expect(WEGLOT_CONFIG_SCHEMA.help).toEqual({ topic: 'weglot', anchor: '#settings' })
  })

  it('starts switched off', () => {
    expect(WEGLOT_CONFIG_SCHEMA.defaults['enabled']).toBe(false)
  })
})

describe('the plugins.config.json declaration', () => {
  const config = JSON.parse(
    readFileSync(join(__dirname, '../../../../../../plugins.config.json'), 'utf8'),
  ) as { plugins: Array<Record<string, any>> }
  const entry = config.plugins.find((plugin) => plugin['id'] === WEGLOT_PLUGIN_ID)

  it('declares exactly the hosts the loader reaches, behind the same switch', () => {
    expect(entry?.['siteCsp']).toMatchObject({
      switchField: 'enabled',
      variants: {
        default: {
          connect: [...WEGLOT_CONNECT_HOSTS],
          img: [...WEGLOT_IMAGE_HOSTS],
        },
      },
    })
    expect(entry?.['siteCsp']?.['variantField']).toBeUndefined()
  })

  it('is off on every site until an admin switches it on', () => {
    expect(entry?.['catalog']?.['defaultOffPerSite']).toBe(true)
  })
})
