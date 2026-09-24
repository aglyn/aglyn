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
  OUTREACH_CURATION_SYSTEM,
  outreachCurationPrompt,
  parseOutreachCurationAnswer,
  type OutreachCurationFacts,
  type OutreachCurationStep,
} from './curation-prompt'

/**
 * What the AI is asked when it drafts one person's emails (AGL-3324): the
 * playbook's rules in the standing block, the person's facts and the steps
 * as written in the prompt, and an answer read only when it is whole.
 */

const facts: OutreachCurationFacts = {
  name: 'Casey Morgan',
  email: 'casey@example.com',
  company: 'Example Agency',
  title: 'Head of Operations',
  website: 'https://example-agency.com',
  tags: ['agency', 'wordpress'],
  sources: ['import'],
  campaigns: ['Outbound · ICP 2 brands'],
  notes: 'Runs twelve client sites.',
  record: 'lead',
  siteName: 'Example Shop',
  senderName: 'Avery Quinn',
  personalLine: 'Saw the portfolio launch last week.',
}

const steps: OutreachCurationStep[] = [
  {
    stepIndex: 0,
    position: 1,
    count: 2,
    subject: "{{contact.company}}'s client sites",
    body: 'Hi {{contact.firstName}},\n\n{{enrollment.personalLine}}\n\nWorth 20 minutes?\n\n{{sender.firstName}}',
    startsThread: true,
  },
  { stepIndex: 2, position: 2, count: 2, subject: '', body: 'Following up, {{contact.firstName}}.', startsThread: false },
]

describe('the standing instructions', () => {
  it('carry the playbook: one link, list price, no invented facts, plain text, no footer, JSON back', () => {
    for (const rule of [
      'One link at most',
      'List price only',
      'Never invent facts, anecdotes, statistics',
      'Plain text only',
      'Do not write a signature block',
      'has no subject',
      'Answer with JSON only',
    ]) {
      expect(OUTREACH_CURATION_SYSTEM).toContain(rule)
    }
  })
})

describe('outreachCurationPrompt', () => {
  it('states the sender, every fact the record holds, the personal line, and each email as written', () => {
    const prompt = outreachCurationPrompt(facts, steps)
    expect(prompt).toContain('Sender: Avery Quinn at Example Shop')
    expect(prompt).toContain('Name: Casey Morgan')
    expect(prompt).toContain('Company: Example Agency')
    expect(prompt).toContain('Title: Head of Operations')
    expect(prompt).toContain('Website: https://example-agency.com')
    expect(prompt).toContain('Tags: agency, wordpress')
    expect(prompt).toContain('How they came to us: import')
    expect(prompt).toContain('Campaigns: Outbound · ICP 2 brands')
    expect(prompt).toContain('Notes: Runs twelve client sites.')
    expect(prompt).toContain('Record: a lead')
    expect(prompt).toContain('Why the sender is writing now: Saw the portfolio launch last week.')
    expect(prompt).toContain('Emails to rewrite (2 of the sequence’s 2):')
    expect(prompt).toContain('--- Email 1 of 2 · stepIndex 0 · starts the thread ---')
    expect(prompt).toContain("Subject: {{contact.company}}'s client sites")
    expect(prompt).toContain('--- Email 2 of 2 · stepIndex 2 · a reply in the thread (no subject) ---')
    expect(prompt).toContain('Following up, {{contact.firstName}}.')
  })

  it('leaves out a fact the record does not hold rather than print an empty label', () => {
    const prompt = outreachCurationPrompt(
      { ...facts, website: '', tags: [], campaigns: [], notes: '', personalLine: '   ', record: 'contact' },
      steps,
    )
    expect(prompt).not.toContain('Website:')
    expect(prompt).not.toContain('Tags:')
    expect(prompt).not.toContain('Campaigns:')
    expect(prompt).not.toContain('Notes:')
    expect(prompt).toContain('Record: a contact')
    expect(prompt).toContain('(the sender wrote no personal line)')
  })
})

describe('parseOutreachCurationAnswer', () => {
  const answer = JSON.stringify({
    steps: [
      { stepIndex: 0, subject: '  Casey, your client sites ', body: 'Hi Casey,\r\n\r\nSaw the launch.\r\n' },
      { stepIndex: 2, subject: 'ignored on a reply', body: 'Following up, Casey.' },
    ],
  })

  it('reads one draft per step, in step order, normalizing line breaks and dropping an in-thread subject', () => {
    expect(parseOutreachCurationAnswer(answer, steps)).toEqual([
      { stepIndex: 0, subject: 'Casey, your client sites', body: 'Hi Casey,\n\nSaw the launch.' },
      { stepIndex: 2, subject: null, body: 'Following up, Casey.' },
    ])
  })

  it('forgives a code fence and prose around the JSON', () => {
    expect(parseOutreachCurationAnswer('```json\n' + answer + '\n```', steps)).toHaveLength(2)
    expect(parseOutreachCurationAnswer('Here you go: ' + answer + ' Hope that helps.', steps)).toHaveLength(2)
  })

  it('refuses an answer that skips a step, names one twice, names an unknown one, or is not JSON', () => {
    expect(parseOutreachCurationAnswer(JSON.stringify({ steps: [{ stepIndex: 0, body: 'x' }] }), steps)).toBeNull()
    expect(
      parseOutreachCurationAnswer(
        JSON.stringify({ steps: [{ stepIndex: 0, body: 'x' }, { stepIndex: 0, body: 'y' }] }),
        steps,
      ),
    ).toBeNull()
    expect(
      parseOutreachCurationAnswer(
        JSON.stringify({ steps: [{ stepIndex: 0, body: 'x' }, { stepIndex: 5, body: 'y' }] }),
        steps,
      ),
    ).toBeNull()
    expect(parseOutreachCurationAnswer('Sure! Hi Casey, ...', steps)).toBeNull()
    expect(parseOutreachCurationAnswer('{"drafts": []}', steps)).toBeNull()
  })
})
