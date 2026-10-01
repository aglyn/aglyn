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
  driftStaffAlertText,
  driftStaffNotificationBody,
  driftStaffTitle,
  summariseSsoDrift,
  type SsoDomainDriftEntry,
} from './sso-domain-drift'

const drifted = (domain: string, orgId: string): SsoDomainDriftEntry => ({
  orgId,
  domain,
  outcome: 'drifted',
  consecutiveFailures: 3,
  daysFailing: 21,
  records: [],
})

describe('the staff side of an SSO drift report counts its domains (AGL-3432)', () => {
  it('names one domain alone, never "and 0 others"', () => {
    const summary = summariseSsoDrift([drifted('acme.com', 'o1')])
    expect(driftStaffTitle(summary)).toBe('1 SSO domain no longer proves ownership')
    expect(driftStaffNotificationBody(summary)).toMatch(/^acme\.com no longer proves ownership by DNS\./)
    expect(driftStaffNotificationBody(summary)).not.toMatch(/\b0 other/)
  })

  it('counts the rest in words that agree with the count', () => {
    const two = summariseSsoDrift([drifted('acme.com', 'o1'), drifted('beta.io', 'o2')])
    expect(driftStaffTitle(two)).toBe('2 SSO domains no longer prove ownership')
    expect(driftStaffNotificationBody(two)).toMatch(/^acme\.com and 1 other no longer prove ownership/)
    const three = summariseSsoDrift([
      drifted('acme.com', 'o1'),
      drifted('beta.io', 'o2'),
      drifted('gamma.dev', 'o3'),
    ])
    expect(driftStaffNotificationBody(three)).toMatch(/^acme\.com and 2 others no longer prove ownership/)
  })

  it('names each workspace beside its id in the mail, where its name was read', () => {
    const summary = summariseSsoDrift([drifted('acme.com', 'o1'), drifted('beta.io', 'o2')])
    const text = driftStaffAlertText(summary, 'https://app.example.com', new Map([['o1', 'Acme Co']]))
    expect(text.split('\n')[0]).toBe('2 SSO domains no longer prove ownership by DNS.')
    expect(text).toContain('  acme.com (Acme Co, org o1) — 3 consecutive failures over 21 days')
    expect(text).toContain('  beta.io (org o2) — 3 consecutive failures over 21 days')
  })
})
