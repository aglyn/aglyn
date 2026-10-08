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

import type { PluginConfigSchema } from '@aglyn/aglyn/plugin-manager/plugin-config'
import { WEGLOT_PLUGIN_ID } from '../constants'

/**
 * A site's Weglot settings (AGL-3700), and the one parse every reader shares.
 *
 * Stored through the platform's generic plugin settings
 * (`orgs/{orgId}/pluginSettings/weglot`, narrowed per site by
 * `hosts/{hostId}/pluginSettings/weglot`), so the console draws the form from
 * {@link WEGLOT_CONFIG_SCHEMA} and nothing here is a UI.
 *
 * Those documents are writable by a workspace manager or a site admin from
 * the browser, so the published page never trusts them: the server enricher
 * runs {@link resolveWeglotSiteSettings}, which answers `null` for anything it
 * cannot vouch for, and what reaches the page's inline boot is only ever a
 * format-checked key and format-checked language codes.
 */

/**
 * A Weglot project's public API key: `wg_` and an alphanumeric id. Public by
 * design — Weglot's own install puts it in every page's source.
 */
export const WEGLOT_API_KEY_PATTERN = /^wg_[A-Za-z0-9]{16,64}$/

/**
 * A language code as Weglot names one: ISO 639-1 (`fr`), the few three-letter
 * codes Weglot uses, and a region or script suffix (`pt-br`, `zh-tw`). Stored
 * lowercase.
 */
export const WEGLOT_LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/

/** More than this many target languages is a typo, not a site. */
export const WEGLOT_MAX_TARGET_LANGUAGES = 30

export type WeglotSwitcherStyle = 'aglyn' | 'weglot'
export type WeglotSwitcherPosition = 'bottom-right' | 'bottom-left'

export const WEGLOT_SWITCHER_STYLES: readonly WeglotSwitcherStyle[] = ['aglyn', 'weglot']
export const WEGLOT_SWITCHER_POSITIONS: readonly WeglotSwitcherPosition[] = [
  'bottom-right',
  'bottom-left',
]

/** What a published page is handed: everything checked, nothing optional. */
export interface WeglotSiteSettings {
  apiKey: string
  sourceLanguage: string
  targetLanguages: string[]
  switcher: WeglotSwitcherStyle
  switcherPosition: WeglotSwitcherPosition
}

/** The words the settings card shows above its fields. */
export const WEGLOT_SETTINGS_NOTICE =
  'Weglot translates your pages in the visitor’s browser, using your own ' +
  'Weglot account and its plan. Translated pages are for visitors: search ' +
  'engines index your site in its original language, and the translations ' +
  'may not rank in other languages. Translating a site needs the Business ' +
  'plan or above; on other plans nothing is added to your pages. Saving on a ' +
  'site’s own plugin page updates its published pages at once.'

export const WEGLOT_CONFIG_SCHEMA: PluginConfigSchema = {
  pluginId: WEGLOT_PLUGIN_ID,
  notice: WEGLOT_SETTINGS_NOTICE,
  affectsPublishedPages: true,
  fields: [
    {
      key: 'enabled',
      label: 'Translate this site with Weglot',
      type: 'boolean',
      description:
        'Adds Weglot’s script and a language switcher to every published page.',
    },
    {
      key: 'apiKey',
      label: 'Weglot API key',
      type: 'string',
      description:
        'Your Weglot project’s public key, starting with wg_. It is public by design and appears in your pages’ source.',
    },
    {
      key: 'sourceLanguage',
      label: 'Language your site is written in',
      type: 'string',
      description:
        'A language code such as en. It must match the original language of your Weglot project.',
    },
    {
      key: 'targetLanguages',
      label: 'Languages to translate into',
      type: 'string',
      description:
        'Codes separated by commas, such as fr, es, de. Add the same languages to your Weglot project; the switcher offers only languages Weglot serves.',
    },
    {
      key: 'switcher',
      label: 'Language switcher',
      type: 'select',
      options: [
        { value: 'aglyn', label: 'Matches your site’s theme' },
        { value: 'weglot', label: 'Weglot’s own switcher' },
      ],
    },
    {
      key: 'switcherPosition',
      label: 'Switcher position',
      type: 'select',
      options: [
        { value: 'bottom-right', label: 'Bottom right' },
        { value: 'bottom-left', label: 'Bottom left' },
      ],
    },
  ],
  defaults: {
    enabled: false,
    apiKey: '',
    sourceLanguage: 'en',
    targetLanguages: '',
    switcher: 'aglyn',
    switcherPosition: 'bottom-right',
  },
  validate: (values) => validateWeglotConfig(values),
}

/** One language code, normalized, or `null`. */
export function parseWeglotLanguage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const code = raw.trim().toLowerCase()
  return WEGLOT_LANGUAGE_PATTERN.test(code) ? code : null
}

/**
 * The target list as typed — commas or spaces between codes. Answers the
 * normalized codes in the order typed, without repeats, and the entries it
 * could not read, so a form can name them.
 */
export function parseWeglotLanguageList(raw: unknown): {
  codes: string[]
  invalid: string[]
} {
  const codes: string[] = []
  const invalid: string[] = []
  if (typeof raw !== 'string') return { codes, invalid }
  for (const entry of raw.split(/[\s,;]+/)) {
    if (!entry) continue
    const code = parseWeglotLanguage(entry)
    if (!code) invalid.push(entry)
    else if (!codes.includes(code)) codes.push(code)
  }
  return { codes, invalid }
}

/**
 * The settings card's pre-save check, against the values the site will RUN
 * with. Switched off, anything may be saved — a half-filled form is how a
 * merchant gets ready before turning it on.
 */
export function validateWeglotConfig(values: Record<string, unknown>): string | null {
  if (values['enabled'] !== true) return null
  const apiKey = typeof values['apiKey'] === 'string' ? values['apiKey'].trim() : ''
  if (!apiKey) return 'Add your Weglot API key before turning translation on.'
  if (!WEGLOT_API_KEY_PATTERN.test(apiKey)) {
    return 'That is not a Weglot API key. Copy the key that starts with wg_ from your Weglot project settings.'
  }
  const source = parseWeglotLanguage(values['sourceLanguage'])
  if (!source) {
    return 'Enter the language your site is written in as a code, such as en.'
  }
  const { codes, invalid } = parseWeglotLanguageList(values['targetLanguages'])
  if (invalid.length) {
    return `Not a language code: ${invalid.join(', ')}. Use codes such as fr or pt-br.`
  }
  if (!codes.length) return 'Add at least one language to translate into.'
  if (codes.includes(source)) {
    return 'The languages to translate into cannot include the language your site is written in.'
  }
  if (codes.length > WEGLOT_MAX_TARGET_LANGUAGES) {
    return `Weglot translates into at most ${WEGLOT_MAX_TARGET_LANGUAGES} languages here.`
  }
  return null
}

/**
 * What a published page may run, or `null`.
 *
 * `null` for a site that is switched off, and equally for one whose stored
 * values do not pass {@link validateWeglotConfig}: a page never loads Weglot
 * with a key or a language it could not read, and never half-configured.
 */
export function resolveWeglotSiteSettings(
  config: Record<string, unknown> | null | undefined,
): WeglotSiteSettings | null {
  if (!config || config['enabled'] !== true) return null
  if (validateWeglotConfig(config)) return null
  const switcher = WEGLOT_SWITCHER_STYLES.includes(config['switcher'] as WeglotSwitcherStyle)
    ? (config['switcher'] as WeglotSwitcherStyle)
    : 'aglyn'
  const switcherPosition = WEGLOT_SWITCHER_POSITIONS.includes(
    config['switcherPosition'] as WeglotSwitcherPosition,
  )
    ? (config['switcherPosition'] as WeglotSwitcherPosition)
    : 'bottom-right'
  return {
    apiKey: String(config['apiKey']).trim(),
    sourceLanguage: parseWeglotLanguage(config['sourceLanguage']) as string,
    targetLanguages: parseWeglotLanguageList(config['targetLanguages']).codes,
    switcher,
    switcherPosition,
  }
}

/**
 * The same check, for a slice that has crossed the wire into the page. The
 * runtime re-reads what the enricher wrote rather than trusting its shape:
 * an editor preview, an older cached page or a hand-built test hands it
 * whatever it has.
 */
export function readWeglotSiteSettings(raw: unknown): WeglotSiteSettings | null {
  if (!raw || typeof raw !== 'object') return null
  const slice = raw as Record<string, unknown>
  return resolveWeglotSiteSettings({
    enabled: true,
    apiKey: slice['apiKey'],
    sourceLanguage: slice['sourceLanguage'],
    targetLanguages: Array.isArray(slice['targetLanguages'])
      ? (slice['targetLanguages'] as unknown[]).filter((code) => typeof code === 'string').join(',')
      : undefined,
    switcher: slice['switcher'],
    switcherPosition: slice['switcherPosition'],
  })
}
