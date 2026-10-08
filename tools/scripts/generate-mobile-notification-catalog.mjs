#!/usr/bin/env node
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
 * The notification catalog as data for the native apps (AGL-3620, AGL-3651).
 *
 *   node tools/scripts/generate-mobile-notification-catalog.mjs          # write
 *   node tools/scripts/generate-mobile-notification-catalog.mjs --check  # CI
 *
 * The app's push settings list every notification type a member can receive,
 * by category, with the labels and console defaults the console's settings
 * page uses. Those live in the core's `notifications.ts`, whose imports reach
 * the plugin catalog and much of the core; the app reads them as generated
 * data instead, the theme tokens' precedent. A new type or category stales it.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
/** The catalog the native apps' push settings and notification rows read (docs/mobile/native-architecture.md §6). */
export const NATIVE_CATALOG_FILE = 'libs/native/contracts/notification-catalog.generated.json'
export const NATIVE_SETTINGS_CASES_FILE = 'libs/native/contracts/notification-settings-cases.generated.json'
const SOURCE = 'libs/aglyn/src/lib/app-utils/notifications.ts'

/** The catalog a member's push settings draw, from the core's notifications module. */
export function catalogFrom(notifications) {
  const categories = Object.keys(notifications.NOTIFICATION_CATEGORY_LABELS)
    .filter((category) => !notifications.STAFF_NOTIFICATION_CATEGORIES.has(category))
    .map((category) => ({
      id: category,
      label: notifications.NOTIFICATION_CATEGORY_LABELS[category],
      types: notifications.notificationTypesInCategory(category).map((type) => ({
        type,
        label: notifications.NOTIFICATION_TYPE_LABELS[type],
        consoleDefault: notifications.notificationTypeChannelDefault(type, 'console'),
      })),
    }))
    .filter((category) => category.types.length > 0)
  return { categories }
}

/**
 * The native apps' catalog: the same categories and types, plus each type's
 * level (red, amber, green, blue or routine) and the levels loudest first, so
 * a native notification row tints as the console's does.
 */
export function nativeCatalogFrom(notifications) {
  const { categories } = catalogFrom(notifications)
  return {
    levels: notifications.NOTIFICATION_LEVELS.map((id) => ({ id, label: notifications.NOTIFICATION_LEVEL_LABELS[id] })),
    categories: categories.map((category) => ({
      ...category,
      // The settings page's one-line answer for what the category covers,
      // and what each channel does when nobody has answered for it.
      description: notifications.NOTIFICATION_CATEGORY_DESCRIPTIONS[category.id] ?? '',
      channelDefaults: { ...notifications.NOTIFICATION_CHANNEL_DEFAULTS[category.id] },
      types: category.types.map((type) => ({
        ...type,
        emailDefault: notifications.notificationTypeChannelDefault(type.type, 'email'),
        level: notifications.NOTIFICATION_TYPE_LEVELS[type.type] ?? 'neutral',
        // A type that sends its own email: its Email switch says why instead.
        ...(notifications.NOTIFICATION_SELF_SENT_EMAIL_TYPES.has(type.type)
          ? { selfSentEmail: notifications.selfSentEmailNote(type.type) }
          : {}),
      })),
    })),
    // The digests the settings page lists, under the keys their senders read.
    digests: notifications.NOTIFICATION_DIGESTS.map(({ key, label, description }) => ({ key, label, description })),
    digestPrefsField: notifications.DIGEST_PREFS_FIELD,
    insightDigestsField: notifications.INSIGHT_DIGESTS_FIELD,
  }
}

/**
 * The console's own answers for the settings page's switches, replayed by
 * both native ports: the account card's category value (its own answer, the
 * legacy console mute, the category default) and type value (the resolver at
 * the account layer, `notificationChannelEnabled` with no scope), and the
 * scopes a person has changed.
 */
export function settingsCasesFrom(notifications) {
  const { categories } = catalogFrom(notifications)
  const fixtures = [
    { name: 'empty', settings: {}, legacy: {} },
    {
      name: 'account answers',
      settings: {
        account: { content: { email: false, console: false }, billing: { email: true } },
        accountTypes: { 'content.order': { email: true }, 'billing.invoice': { console: false } },
      },
      legacy: {},
    },
    { name: 'legacy mute', settings: { account: { team: { email: true } } }, legacy: { team: false, content: false } },
    {
      name: 'scopes',
      settings: {
        orgs: { 'org-b': { content: { console: false } }, 'org-a': {} },
        hosts: { 'host-1': { billing: {} } },
        orgTypes: { 'org-c': { 'content.order': { email: true } } },
        hostTypes: { 'host-2': { 'content.booking': { console: false } }, 'host-3': { 'content.order': {} } },
      },
      legacy: {},
    },
  ]
  return fixtures.map(({ name, settings, legacy }) => {
    const categoryValues = {}
    const typeValues = {}
    for (const category of categories) {
      for (const channel of ['console', 'email']) {
        const own = notifications.notificationScopePref(settings, { kind: 'account' }, category.id, channel)
        categoryValues[`${category.id}:${channel}`] =
          typeof own === 'boolean'
            ? own
            : channel === 'console' && legacy[category.id] === false
              ? false
              : notifications.NOTIFICATION_CHANNEL_DEFAULTS[category.id][channel]
        for (const { type } of category.types) {
          typeValues[`${type}:${channel}`] = notifications.notificationChannelEnabled(
            settings,
            channel,
            type,
            undefined,
            legacy,
          )
        }
      }
    }
    return {
      name,
      settings,
      legacy,
      categoryValues,
      typeValues,
      overridden: notifications.notificationOverriddenScopes(settings),
    }
  })
}

export function catalogContent(catalog, reader) {
  return `${JSON.stringify(
    {
      '//': [
        'GENERATED by tools/scripts/generate-mobile-notification-catalog.mjs — do not edit.',
        `The member notification types, labels and console defaults from ${SOURCE}, for ${reader}.`,
      ],
      ...catalog,
    },
    null,
    2,
  )}\n`
}

async function main() {
  const { createJiti } = createRequire(join(ROOT, 'package.json'))('jiti')
  const jiti = createJiti(join(ROOT, 'package.json'), { interopDefault: true, fsCache: false })
  const notifications = await jiti.import(join(ROOT, SOURCE))
  const outputs = [
    {
      file: NATIVE_CATALOG_FILE,
      content: catalogContent(nativeCatalogFrom(notifications), "the native apps' notification settings and rows"),
    },
    {
      file: NATIVE_SETTINGS_CASES_FILE,
      content: catalogContent(
        { cases: settingsCasesFrom(notifications) },
        "the native settings screens' tests, which replay the console's answers",
      ),
    },
  ]
  if (process.argv.includes('--check')) {
    const drifted = outputs.filter(({ file, content }) => {
      try {
        return readFileSync(join(ROOT, file), 'utf8') !== content
      } catch {
        return true // Absent is drift.
      }
    })
    if (drifted.length) {
      console.error(
        `${drifted.map(({ file }) => file).join('\n')}\nno longer match the notification catalog.\n` +
          'They are generated. Run: node tools/scripts/generate-mobile-notification-catalog.mjs',
      )
      process.exit(1)
    }
    for (const { file } of outputs) console.log(`ok ${file}`)
    return
  }
  for (const { file, content } of outputs) {
    mkdirSync(dirname(join(ROOT, file)), { recursive: true })
    writeFileSync(join(ROOT, file), content)
    console.log(`wrote ${file}`)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main()
}
