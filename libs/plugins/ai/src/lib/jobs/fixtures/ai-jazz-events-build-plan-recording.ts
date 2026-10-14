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
 * THE JAZZ NIGHTS BUILD PLAN (AGL-3755), as the live build plan eval of
 * 2026-10-13 answered "add our next three Friday night jazz shows at 8pm to
 * an events page" on a site with only a Home page: three correct `event`
 * items and no screen, so nothing listed them. The shape is the plan tool's
 * (items' arguments as one JSON string); the copy is the answer's in kind.
 */

export const AI_JAZZ_EVENTS_BRIEF = 'add our next three Friday night jazz shows at 8pm to an events page'

const show = (name: string, day: string) => ({
  op: 'event',
  name,
  why: 'One of the three Friday night jazz shows the request asks for.',
  dependsOn: [],
  degrade: 'omit',
  args: JSON.stringify({
    title: name,
    startsAt: `2026-10-${day}T20:00`,
    timezone: 'America/Chicago',
    description: 'Live jazz on a Friday night: a full set from the house band, with the bar open all evening.',
  }),
})

export const AI_JAZZ_EVENTS_BUILD_PLAN_ANSWER = {
  reuse: [],
  create: [],
  screens: [],
  items: [
    show('Friday Night Jazz — October 16', '16'),
    show('Friday Night Jazz — October 23', '23'),
    show('Friday Night Jazz — October 30', '30'),
  ],
}
