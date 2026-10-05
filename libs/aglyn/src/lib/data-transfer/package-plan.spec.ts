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

import type { ExistingPackageItem, PackageManifestItem } from './package'
import {
  TRANSFER_SITE_KIND,
  canApplyTransferPackage,
  existingPackageItemsOf,
  keepBothName,
  missingPackageAcknowledgements,
  packageIdMap,
  planTransferPackage,
  remapPackageReference,
  type PlanTransferPackageInput,
} from './package-plan'

const SEQ = 'outreach.sequences'
const TPL = 'crm.emailTemplates'
const MAILBOX = 'outreach.mailboxes'

const item = (
  kind: string,
  id: string,
  extra: { name?: string; hash?: string; deps?: [string, string][] } = {},
): PackageManifestItem => ({
  kind,
  $id: id,
  ...(extra.name ? { name: extra.name } : {}),
  contentHash: `sha256:${extra.hash ?? id}`,
  deps: (extra.deps ?? []).map(([depKind, depId]) => ({ kind: depKind, id: depId })),
})

const held = (kind: string, id: string, name: string, hash = id): ExistingPackageItem => ({
  kind,
  id,
  name,
  contentHash: `sha256:${hash}`,
})

function plan(input: Partial<PlanTransferPackageInput> & Pick<PlanTransferPackageInput, 'manifest'>) {
  let next = 0
  return planTransferPackage({
    ownedKinds: new Set([SEQ, TPL]),
    existing: [],
    newId: () => `new${(next += 1)}`,
    ...input,
  })
}

describe('keepBothName', () => {
  it('adds (copy), then counts, never stacking copies', () => {
    expect(keepBothName('Welcome', [])).toBe('Welcome (copy)')
    expect(keepBothName('Welcome', ['welcome (COPY)'])).toBe('Welcome (copy 2)')
    expect(keepBothName('Welcome (copy)', ['Welcome (copy)', 'Welcome (copy 2)'])).toBe('Welcome (copy 3)')
  })
})

describe('planTransferPackage', () => {
  it('creates new items under their own ids and skips identical ones', () => {
    const result = plan({
      manifest: { items: [item(TPL, 't1', { name: 'Intro' }), item(TPL, 't2', { name: 'Same', hash: 'h' })] },
      existing: [held(TPL, 'x9', 'Same', 'h')],
    })
    expect(result.items.map((one) => [one.key, one.verdict, one.reason ?? null])).toEqual([
      ['crm.emailTemplates/t1', 'create', null],
      ['crm.emailTemplates/t2', 'skip', 'identical'],
    ])
    expect(result.items[0]?.targetId).toBe('t1')
    expect(result.idMap).toEqual({ 'crm.emailTemplates/t1': 't1', 'crm.emailTemplates/t2': 'x9' })
    expect(result.blocking).toEqual([])
    expect(canApplyTransferPackage(result, [])).toBe(true)
  })

  it('never assumes a replace: a differing item waits for the person', () => {
    const manifest = { items: [item(TPL, 't1', { name: 'Intro', hash: 'new' })] }
    const existing = [held(TPL, 't1', 'Intro', 'old')]
    const waiting = plan({ manifest, existing })
    expect(waiting.items[0]).toMatchObject({ verdict: 'skip', needsChoice: true, decisions: ['replace', 'keepBoth', 'skip'] })
    expect(waiting.blocking).toHaveLength(1)
    expect(canApplyTransferPackage(waiting, [])).toBe(false)

    const replaced = plan({ manifest, existing, decisions: { 'crm.emailTemplates/t1': 'replace' } })
    expect(replaced.items[0]).toMatchObject({ verdict: 'replace', targetId: 't1', needsChoice: false })
    expect(replaced.acknowledgementsRequired).toEqual(['replace'])
    expect(missingPackageAcknowledgements(replaced, [])).toEqual(['replace'])
    expect(canApplyTransferPackage(replaced, ['replace'])).toBe(true)
  })

  it('keeps both under a new id and a free name, and rewrites references to the copy', () => {
    const result = plan({
      manifest: {
        items: [
          item(TPL, 't1', { name: 'Intro', hash: 'new' }),
          item(SEQ, 's1', { name: 'Founders', deps: [[TPL, 't1']] }),
        ],
      },
      existing: [held(TPL, 't1', 'Intro', 'old'), held(TPL, 't7', 'Intro (copy)')],
      decisions: { 'crm.emailTemplates/t1': 'keepBoth' },
    })
    expect(result.items[0]).toMatchObject({ verdict: 'keepBoth', targetId: 'new1', rename: { name: 'Intro (copy 2)' } })
    expect(result.idMap['crm.emailTemplates/t1']).toBe('new1')
    expect(result.order).toEqual(['crm.emailTemplates/t1', 'outreach.sequences/s1'])
    expect(remapPackageReference(packageIdMap(result.idMap), TPL, 't1')).toBe('new1')
  })

  it('points references at the workspace item when a matched item is skipped', () => {
    const result = plan({
      manifest: {
        items: [item(TPL, 't1', { name: 'Intro', hash: 'new' }), item(SEQ, 's1', { deps: [[TPL, 't1']] })],
      },
      existing: [held(TPL, 'mine', 'intro', 'old')],
      decisions: { 'crm.emailTemplates/t1': 'skip' },
    })
    expect(result.items[0]).toMatchObject({ verdict: 'skip', matchedBy: 'name', reason: 'chosen' })
    expect(result.idMap['crm.emailTemplates/t1']).toBe('mine')
    expect(result.references).toEqual([])
  })

  it('asks about a reference nothing satisfies, and offers the workspace targets', () => {
    const manifest = { items: [item(SEQ, 's1', { name: 'Founders', deps: [[MAILBOX, 'mb-old'], [TRANSFER_SITE_KIND, 'h-old']] })] }
    const references = [
      { kind: MAILBOX, label: 'Mailbox', targets: [{ id: 'mb-1', name: 'zach@' }] },
      { kind: TRANSFER_SITE_KIND, label: 'Site', targets: [{ id: 'h-1', name: 'Acme' }] },
    ]
    const open = plan({ manifest, references })
    expect(open.references.map((one) => [one.key, one.choices, one.targets.map((target) => target.id)])).toEqual([
      ['outreach.mailboxes/mb-old', ['mapTo', 'dropReference', 'skipItem'], ['mb-1']],
      ['site/h-old', ['mapTo', 'dropReference', 'skipItem'], ['h-1']],
    ])
    expect(open.blocking).toHaveLength(2)

    const answered = plan({
      manifest,
      references,
      dependencyChoices: {
        'outreach.mailboxes/mb-old': { action: 'mapTo', id: 'mb-1' },
        'site/h-old': { action: 'dropReference' },
      },
    })
    expect(answered.blocking).toEqual([])
    expect(answered.idMap).toMatchObject({ 'outreach.mailboxes/mb-old': 'mb-1', 'site/h-old': '' })
    expect(answered.acknowledgementsRequired).toEqual(['dropReference'])
    expect(remapPackageReference(packageIdMap(answered.idMap), TRANSFER_SITE_KIND, 'h-old')).toBeNull()

    const bogus = plan({ manifest, references, dependencyChoices: { 'site/h-old': { action: 'mapTo', id: 'not-mine' } } })
    expect(bogus.references.find((one) => one.key === 'site/h-old')?.choice).toBeNull()
  })

  it('resolves a reference the workspace already holds without asking', () => {
    const result = plan({
      manifest: { items: [item(SEQ, 's1', { deps: [[TPL, 'mine'], [MAILBOX, 'mb-1']] })] },
      existing: [held(TPL, 'mine', 'Intro')],
      references: [{ kind: MAILBOX, label: 'Mailbox', targets: [{ id: 'mb-1' }] }],
    })
    expect(result.references).toEqual([])
    expect(remapPackageReference(packageIdMap(result.idMap), TPL, 'mine')).toBe('mine')
  })

  it('skips every item that needs a reference skipped over, transitively', () => {
    const result = plan({
      manifest: {
        items: [
          item(TPL, 't1', { deps: [[MAILBOX, 'gone']] }),
          item(SEQ, 's1', { deps: [[TPL, 't1']] }),
        ],
      },
      dependencyChoices: { 'outreach.mailboxes/gone': { action: 'skipItem' }, 'crm.emailTemplates/t1': { action: 'skipItem' } },
    })
    expect(result.items.map((one) => [one.verdict, one.reason])).toEqual([
      ['skip', 'missingDependency'],
      ['skip', 'missingDependency'],
    ])
    expect(result.blocking).toEqual([])
    expect(canApplyTransferPackage(result, [])).toBe(false)
  })

  it('imports the package copy of a skipped new item when asked to', () => {
    const manifest = { items: [item(TPL, 't1', { name: 'Intro' }), item(SEQ, 's1', { deps: [[TPL, 't1']] })] }
    const skipped = plan({ manifest, decisions: { 'crm.emailTemplates/t1': 'skip' } })
    expect(skipped.references[0]).toMatchObject({ key: 'crm.emailTemplates/t1', inPackage: true, name: 'Intro' })
    expect(skipped.references[0]?.choices).toContain('import')

    const imported = plan({
      manifest,
      decisions: { 'crm.emailTemplates/t1': 'skip' },
      dependencyChoices: { 'crm.emailTemplates/t1': { action: 'import' } },
    })
    expect(imported.items[0]?.verdict).toBe('create')
    expect(imported.blocking).toEqual([])
  })

  it('sets aside items of a kind nothing here owns', () => {
    const result = plan({ manifest: { items: [item('stranger.things', 'x1')] } })
    expect(result.unknownKinds).toEqual(['stranger.things'])
    expect(result.items[0]).toMatchObject({ verdict: 'skip', reason: 'unknownKind' })
  })

  it('fails an item its plugin refuses, and asks for that to be acknowledged', () => {
    const result = plan({
      manifest: { items: [item(TPL, 't1'), item(TPL, 't2')] },
      problems: { 'crm.emailTemplates/t2': ['Name the template.'] },
    })
    expect(result.items.map((one) => one.verdict)).toEqual(['create', 'fail'])
    expect(result.items[1]?.problems).toEqual(['Name the template.'])
    expect(result.acknowledgementsRequired).toEqual(['failed'])
    expect(result.order).toEqual(['crm.emailTemplates/t1'])
  })
})

describe('existingPackageItemsOf', () => {
  it('hashes content the way an export does', async () => {
    const [one] = await existingPackageItemsOf(TPL, [{ id: 'a', name: 'A', content: { b: 1, a: 2 } }])
    const [two] = await existingPackageItemsOf(TPL, [{ id: 'a', name: 'A', content: { a: 2, b: 1 } }])
    expect(one?.contentHash).toBe(two?.contentHash)
    expect(one).toMatchObject({ kind: TPL, id: 'a', name: 'A' })
  })
})
