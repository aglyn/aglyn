/* eslint-disable */
/**
 * @license
 * Copyright 2022 Aglyn LLC
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

/* eslint-disable */

// Pin the suite's timezone at PROCESS LAUNCH (AGL-1617). This file is
// evaluated in the jest parent before any worker is forked, so workers
// inherit TZ through their environment and start with the zone already
// applied — which is the only moment it can be applied at all.
//
// Inside a test it CANNOT be. V8 realizes the zone when the vm context is
// created, and `process.env.TZ = …` reassignment there does not move the
// clock: measured under this very config, `new Date(Date.parse(
// '2026-11-02T00:30:00Z')).getDate()` reads 2 both before and after the
// assignment, under jsdom and under `@jest-environment node` alike, and
// whether the assignment is made mid-test or at module top. Plain node
// honours the same reassignment, which is why this reads as working
// everywhere except here. `collection-entry-date-hydration.spec.ts` records
// the same finding from the other direction.
//
// The consequence, before this line existed: a spec that set TZ itself
// asserted against the MACHINE's zone, so it passed on a Chicago laptop and
// failed on a UTC runner — `analytics-day-cache.spec.ts` › "counts back in
// UTC days, not local ones" was red in CI for exactly that reason, and its
// premise guard (which is why it was red rather than silently vacuous) is
// what made the cause legible.
//
// America/Chicago because it observes DST, which is the condition the
// UTC-day arithmetic has to survive; a UTC runner cannot exercise it at all,
// since local and UTC arithmetic agree there. Verified load-bearing by
// mutation: with local-calendar arithmetic substituted into `recentDayIds`,
// the spec fails on its real assertion with the pin, and only on its premise
// guard without it.
process.env.TZ = 'America/Chicago'

module.exports = {
  displayName: 'console',
  preset: '../../jest.preset.js',
  transform: {
    '^(?!.*\\.(js|jsx|ts|tsx|css|json)$)': '@nx/react/plugins/jest',
    '^.+\\.[tj]sx?$': ['babel-jest', { presets: ['@nx/next/babel'] }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  coverageDirectory: '../../coverage/apps/console',
  // The suite's heavy RTL specs (full MUI trees under emotion) cost 1-2 s of
  // CPU per test even on an idle machine. Under parallel workers a starved
  // worker blows jest's default 5 s testTimeout on whichever of them loses
  // the CPU lottery that run — captured as "Exceeded timeout of 5000 ms" on
  // reusable-components-provider (AGL-1257) and publish-plugin-form. The
  // timeout exists to catch hangs, not to race the scheduler: 30 s still
  // fails a genuine hang, and assertion failures are unaffected.
  testTimeout: 30000,
}
