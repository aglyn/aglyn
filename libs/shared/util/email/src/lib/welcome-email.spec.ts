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

import { splitEmailDetailLine } from './email-render'
import { welcomeEmailMergeValues } from './welcome-email'

const INPUT = {
  orgName: 'Acme',
  slug: 'acme',
  consoleOrigin: 'https://app.aglyn.com/',
  docsOrigin: 'https://docs.aglyn.com',
}

describe('welcomeEmailMergeValues', () => {
  it('points an empty workspace at starting its first site', () => {
    const values = welcomeEmailMergeValues(INPUT)
    expect(values['welcome.intro']).toBe('Acme is ready. Here is how most people get their first site live.')
    const steps = values['welcome.steps'].split('\n').map((line) => splitEmailDetailLine(line))
    expect(steps.map((step) => step?.label)).toEqual([
      'Build your first site',
      'Let AI draft it for you',
      'Invite your team',
      'Connect your own domain',
    ])
    expect(steps[0]?.value).toBe('https://app.aglyn.com/acme/hosts')
    expect(steps[2]?.value).toBe('https://app.aglyn.com/acme/team')
    for (const step of steps) expect(step?.value).toMatch(/^https:\/\//)
  })

  it('points a workspace that came with its first site at taking it live', () => {
    const values = welcomeEmailMergeValues({ ...INPUT, start: 'first-site' })
    expect(values['welcome.intro']).toContain('your first site is in it')
    expect(values['welcome.steps']).toMatch(/^Finish and publish your site — https:\/\/app\.aglyn\.com\/acme\/hosts\n/)
  })

  it('links the console home when there is no slug', () => {
    const values = welcomeEmailMergeValues({ ...INPUT, slug: '' })
    expect(values['welcome.steps']).toContain('Build your first site — https://app.aglyn.com\n')
  })
})
