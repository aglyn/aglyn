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
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * A third workspace for the seeded member, "Lakeside Studio", shaped like a
 * workspace that has been running in production for months rather than one
 * this seed writes fresh (AGL-3993). Every drive before it ran on data written
 * to match what the apps expect; this one carries the older shapes production
 * holds, read key by key and type by type from a long-lived enterprise
 * workspace (field names and types only, values invented):
 *
 * - the workspace stores NO `enabledPlugins` (it never touched the
 *   switchboard), NO `memberRoles` projection, an enterprise plan granted as a
 *   comp (`entitlements.planComp`) with per-workspace feature overrides, and a
 *   release-flag override;
 * - its main site stores EMPTY plugin lists (`enabledPlugins: []`,
 *   `disabledPlugins: []`), and its second site stores neither field;
 * - actions as the element-interaction era left them: deleted, some
 *   `migratedToNode` with a selector trigger, beside live CRM and form ones
 *   with explicitly nulled trigger fields;
 * - a workflow whose one step posts to a webhook, functions with a deleted
 *   one, variables bound to a workflow by id and name;
 * - components and forms whose `nodes` is a numeric-key map (a byte array
 *   written as a map), with `props` and `rootId`; a layout with a `versions`
 *   array and an explicit `deletedAt: null`; an archived form whose
 *   `archivedAt` is epoch milliseconds;
 * - pages with no `parentId` or `order`, one deleted;
 * - content collections with `listScreenId`/`entryScreenId` and entries with
 *   `publishSortAt`, `titleTokens` and no category;
 * - datasets with no `names`, fields as `{ name, type }` (one `sorted` with a
 *   `customType`), the legacy `fields` array beside `model.order`, and
 *   `visibleTo: ['org']`;
 * - audience lists of both kinds and an email campaign migrated from a site.
 *
 * The documents live in libs/native/contracts/production-shapes.json, which
 * both apps' list tests read too: the seed and the tests can never disagree
 * about what production holds.
 */

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '../../../libs/native/contracts/production-shapes.json')
const DAY = 24 * 60 * 60 * 1000

/** The fixture's ids: the workspace and its two sites. */
export const LEGACY_IDS = JSON.parse(readFileSync(FIXTURE, 'utf8')).ids

/** One fixture value as stored: its placeholders filled, its markers made into dates, numbers and byte maps. */
export function expandFixtureValue(value, { uid, now }) {
  const text = (s) =>
    s
      .replaceAll('{org}', LEGACY_IDS.org)
      .replaceAll('{secondSite}', LEGACY_IDS.secondSite)
      .replaceAll('{site}', LEGACY_IDS.site)
      .replaceAll('{uid}', uid)
  const walk = (v) => {
    if (typeof v === 'string') return text(v)
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      if (typeof v.$daysAgo === 'number') return new Date(now.getTime() - v.$daysAgo * DAY)
      if (typeof v.$epochMsDaysAgo === 'number') return now.getTime() - v.$epochMsDaysAgo * DAY
      if (typeof v.$bytes === 'number') {
        return Object.fromEntries(Array.from({ length: v.$bytes }, (_, index) => [String(index), (index * 37) % 256]))
      }
      return Object.fromEntries(Object.entries(v).map(([key, item]) => [text(key), walk(item)]))
    }
    return v
  }
  return walk(value)
}

export async function seedLegacyWorkspace({ put, uid, now }) {
  const { documents } = JSON.parse(readFileSync(FIXTURE, 'utf8'))
  for (const { path, data } of documents) {
    await put(expandFixtureValue(path, { uid, now }), expandFixtureValue(data, { uid, now }))
  }
  return { orgId: LEGACY_IDS.org, hostId: LEGACY_IDS.site, secondId: LEGACY_IDS.secondSite }
}
