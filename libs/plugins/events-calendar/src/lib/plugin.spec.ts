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

import * as Aglyn from '@aglyn/aglyn'
import * as PluginSdk from '@aglyn/aglyn'
import { BUNDLE_ID } from './constants/bundle-common'
import {
  EVENTS_CALENDAR_BUNDLE,
  registerEventsCalendarPlugin,
} from './plugin'

describe('events-calendar plugin', () => {
  it('keeps the persisted event-list component id', () => {
    // The id is stored in screen docs — never rename (AGL-313).
    expect(
      EVENTS_CALENDAR_BUNDLE.map((entry) => entry.schema.$id),
    ).toContain('eventList')
  })

  it('registers a mui-dependent bundle + console extension once', () => {
    registerEventsCalendarPlugin()
    const bundle = Aglyn.plugins.getDependency(BUNDLE_ID)
    expect(bundle?.dependencies).toMatchObject({ [PluginSdk.MUI_BUNDLE_ID]: true })
    const extension = PluginSdk.listConsoleExtensions().find(
      (entry) => entry.pluginId === BUNDLE_ID,
    )
    expect(extension?.featureFlag).toBe('eventCalendar')
    registerEventsCalendarPlugin()
    expect(Aglyn.plugins.getDependency(BUNDLE_ID)).toBe(bundle)
  })
})
