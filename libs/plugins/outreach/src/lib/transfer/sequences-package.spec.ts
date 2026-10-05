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
  OUTREACH_CAMPAIGN_REFERENCE_KIND,
  OUTREACH_MAILBOX_REFERENCE_KIND,
  OUTREACH_TEMPLATE_REFERENCE_KIND,
  outreachSequenceDependencies,
  outreachSequencePackageContent,
  remapOutreachSequenceIds,
} from './sequences-package'

const STORED = {
  id: 'seq-1',
  name: 'Founders',
  hostId: 'host-1',
  mailboxId: 'mb-1',
  status: 'active',
  stats: { sent: 40 },
  campaignIds: ['camp-1'],
  steps: [
    { id: 'a', kind: 'email', delayBusinessDays: 0, subject: 'Hi', replyInThread: false, body: 'Hello', templateId: 'tpl-1' },
    { id: 'b', kind: 'task', taskKind: 'call', title: 'Call', delayBusinessDays: 2 },
  ],
  settings: {},
  createdAtMs: 1,
  updatedAtMs: 2,
}

describe('a sequence as a package item (AGL-3535)', () => {
  it('carries how it reads, never its status, counters or stamps', () => {
    const content = outreachSequencePackageContent(STORED) as unknown as Record<string, unknown>
    expect(content['name']).toBe('Founders')
    expect(content).not.toHaveProperty('status')
    expect(content).not.toHaveProperty('stats')
    expect(content).not.toHaveProperty('createdAtMs')
  })

  it('names its site, mailbox, campaigns and templates', () => {
    expect(outreachSequenceDependencies(outreachSequencePackageContent(STORED))).toEqual([
      { kind: 'site', id: 'host-1' },
      { kind: OUTREACH_MAILBOX_REFERENCE_KIND, id: 'mb-1' },
      { kind: OUTREACH_CAMPAIGN_REFERENCE_KIND, id: 'camp-1' },
      { kind: OUTREACH_TEMPLATE_REFERENCE_KIND, id: 'tpl-1' },
    ])
  })

  it('moves each reference, and empties one that was dropped', () => {
    const idMap = new Map([
      ['site/host-1', 'host-9'],
      [`${OUTREACH_MAILBOX_REFERENCE_KIND}/mb-1`, ''],
      [`${OUTREACH_CAMPAIGN_REFERENCE_KIND}/camp-1`, ''],
      [`${OUTREACH_TEMPLATE_REFERENCE_KIND}/tpl-1`, 'tpl-copy'],
    ])
    const moved = remapOutreachSequenceIds(outreachSequencePackageContent(STORED), idMap)
    expect(moved.hostId).toBe('host-9')
    expect(moved.mailboxId).toBe('')
    expect(moved.campaignIds).toEqual([])
    expect(moved.steps[0]).toMatchObject({ templateId: 'tpl-copy' })
  })
})
