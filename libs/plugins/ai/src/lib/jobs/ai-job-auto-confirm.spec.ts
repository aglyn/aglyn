/**
 * @jest-environment node
 *
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

import { aiEvalMemoryFirestore } from '../runtime/ai-eval-memory-firestore'
import { AI_SITE_INPUT_MAX_CHARS, aiSiteNameSentence, parseAiSiteJobInputs } from '../model/ai-site-job'
import { AI_SITE_START_ANSWERS, aiSiteStartInputs } from '../model/ai-site-start'
import { aiSiteSeoProposalForInputs } from '../model/ai-site-start-seo'
import { aiJobAdmittedInputs, aiJobAutoConfirms } from './ai-job-auto-confirm'
import { aiPlanSiteLines } from './ai-job-plan-step'
import { aiSiteBriefLines } from './ai-job-site-step'

describe('a guided site start confirms its own plan (AGL-3594)', () => {
  const { firestore } = aiEvalMemoryFirestore({
    'hosts/bare': { screens: {} },
    'hosts/starter': { screens: { scrHome: '/' }, defaultHomeScreenId: 'scrHome' },
    'hosts/live': { screens: { scrMine: '/' } },
  })
  const admit = (kind: string, hostId: string | null, inputs: Record<string, unknown>) =>
    aiJobAdmittedInputs(firestore, { kind, hostId, inputs })

  it('keeps it on a site job for a site that publishes nothing of the owner’s yet', async () => {
    await expect(admit('site', 'bare', { pages: 2, autoConfirm: true })).resolves.toEqual({ pages: 2, autoConfirm: true })
    await expect(admit('site', 'starter', { autoConfirm: true })).resolves.toEqual({ autoConfirm: true })
  })

  it('drops it everywhere else, so those jobs wait for a person', async () => {
    await expect(admit('site', 'live', { pages: 5, autoConfirm: true })).resolves.toEqual({ pages: 5 })
    await expect(admit('page', 'bare', { autoConfirm: true })).resolves.toEqual({})
    await expect(admit('site', null, { autoConfirm: true })).resolves.toEqual({})
    await expect(admit('site', 'missing', { autoConfirm: true })).resolves.toEqual({})
    await expect(admit('site', 'bare', { autoConfirm: 'yes' })).resolves.toEqual({})
    // A request that never asked is passed through untouched.
    const inputs = { pages: 2 }
    await expect(admit('site', 'bare', inputs)).resolves.toBe(inputs)
  })

  it('is read off the stored job by kind and input alone', () => {
    expect(aiJobAutoConfirms({ kind: 'site', inputs: { autoConfirm: true } })).toBe(true)
    expect(aiJobAutoConfirms({ kind: 'page', inputs: { autoConfirm: true } })).toBe(false)
    expect(aiJobAutoConfirms({ kind: 'site', inputs: {} })).toBe(false)
  })
})

describe('a site job carries its site’s own name (AGL-3596)', () => {
  const { firestore, reads } = countingFirestore({
    'hosts/hillside': { displayName: '  Hillside   Dog Grooming ', screens: {} },
    'hosts/unnamed': { screens: {} },
    'hosts/long': { displayName: 'x'.repeat(AI_SITE_INPUT_MAX_CHARS + 20), screens: { scrMine: '/' } },
  })
  const admit = (kind: string, hostId: string | null, inputs: Record<string, unknown>) =>
    aiJobAdmittedInputs(firestore, { kind, hostId, inputs })
  const guided = () => ({
    ...aiSiteStartInputs({
      ...AI_SITE_START_ANSWERS,
      siteType: 'A dog groomer in Austin',
      audience: 'Local dog owners',
    }),
    autoConfirm: true,
  })

  beforeEach(() => reads.splice(0))

  it('fills the guided start’s empty name from the site, in the one read the confirmation makes', async () => {
    const stored = await admit('site', 'hillside', guided())
    expect(stored).toMatchObject({ businessName: 'Hillside Dog Grooming', autoConfirm: true })
    expect(reads).toEqual(['hosts/hillside'])

    // Every unit is told the name, and told to use it as written.
    const inputs = parseAiSiteJobInputs(stored)
    if (typeof inputs === 'string') throw new Error(inputs)
    const lines = aiSiteBriefLines('A 4-page website for A dog groomer in Austin.', inputs).join('\n')
    expect(lines).toContain('name: Hillside Dog Grooming')
    expect(lines).toContain(aiSiteNameSentence('Hillside Dog Grooming'))
    // The plan is told the same.
    expect(aiPlanSiteLines({ kind: 'site', inputs: stored }, null, null)).toContain(
      aiSiteNameSentence('Hillside Dog Grooming'),
    )
    // The search listing leads with it.
    expect(aiSiteSeoProposalForInputs(stored)?.values['seo.title']).toMatch(/^Hillside Dog Grooming — /)
  })

  it('fills it for a site job that asked for no confirmation', async () => {
    await expect(admit('site', 'hillside', { businessType: 'groomer', pages: 4 })).resolves.toEqual({
      businessType: 'groomer',
      pages: 4,
      businessName: 'Hillside Dog Grooming',
    })
  })

  it('keeps a name the request gave, and reads nothing for it', async () => {
    const inputs = { businessType: 'groomer', businessName: 'Wag & Co' }
    await expect(admit('site', 'hillside', inputs)).resolves.toBe(inputs)
    expect(reads).toEqual([])
  })

  it('holds the name to what the job admits', async () => {
    const stored = await admit('site', 'long', { businessType: 'groomer' })
    expect(String(stored['businessName'])).toHaveLength(AI_SITE_INPUT_MAX_CHARS)
    expect(typeof parseAiSiteJobInputs({ ...stored, pages: 4 })).toBe('object')
  })

  it('names nothing for a site with no name, another kind, or no site', async () => {
    const inputs = { businessType: 'groomer' }
    await expect(admit('site', 'unnamed', inputs)).resolves.toBe(inputs)
    await expect(admit('site', 'missing', inputs)).resolves.toBe(inputs)
    await expect(admit('page', 'hillside', inputs)).resolves.toBe(inputs)
    await expect(admit('site', null, inputs)).resolves.toBe(inputs)
  })

  it('tells a plan with no name nothing about one', () => {
    expect(aiPlanSiteLines({ kind: 'site', inputs: { businessName: '' } }, null, null).join('\n')).not.toMatch(/business is named/)
  })
})

/** The memory Firestore, recording the path of every document read. */
function countingFirestore(seed: Record<string, Record<string, unknown>>) {
  const { firestore } = aiEvalMemoryFirestore(seed)
  const reads: string[] = []
  const collection = firestore.collection.bind(firestore)
  const wrapped = Object.create(firestore) as FirebaseFirestore.Firestore
  wrapped.collection = ((name: string) => {
    const ref = collection(name)
    const doc = ref.doc.bind(ref)
    return Object.assign(Object.create(ref), {
      doc: (id: string) => {
        const docRef = doc(id)
        return Object.assign(Object.create(docRef), {
          get: () => {
            reads.push(`${name}/${id}`)
            return docRef.get()
          },
        })
      },
    })
  }) as FirebaseFirestore.Firestore['collection']
  return { firestore: wrapped, reads }
}
