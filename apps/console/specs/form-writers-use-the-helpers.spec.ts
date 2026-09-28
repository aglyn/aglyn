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
 * Every write to a form document goes through the helpers that keep the
 * Forms list's query fields true (AGL-3330), swept across the whole repo.
 *
 * The Forms list filters and searches on the query, by fields each writer
 * has to store, and a writer that skips one leaves a form that still lists
 * and that the filter or the search can no longer find — which nobody would
 * notice. Three such holes were found in the list that shipped: a retire and
 * a restore that left Updated where it was, and nothing to say a writer of
 * the name or the campaigns had to restamp what the list asks. So a write to
 * `hosts/{hostId}/forms/{formId}` is held to:
 *
 *   - a NAME: `displayName` written only beside `formListFields` (a rename)
 *     or `newFormListFields` (a create), which restamp the search keys;
 *   - CAMPAIGNS: `campaignIds` written only through `formCampaignFields`
 *     (or `newFormListFields`), which stamps `inCampaign` beside it;
 *   - an EDIT: every update carries `updatedAt`, because Updated is what the
 *     list says about when the form was last changed. The counters' own
 *     bookkeeping — the submit path's increment, the recount, the backfills'
 *     planned patches, the `inCampaign` restamp — is not an edit and is
 *     named below, each with why.
 *
 * The CREATE doors that write a form by a collection variable — the
 * resources route, duplicate, the AI draft, the CRM seed — are pinned by
 * name to `newFormListFields`, and the campaign deletion pass to
 * `restampFormsInCampaign`, because their writes do not spell `forms` at the
 * call. The rules hold the same three from the other side
 * (`cloud/firebase-firestore.rules`, `match /forms/{formId}`).
 */

import {
  type DocumentWrite,
  documentWrites,
  isCreate,
  literalKeys,
  readCode,
  readSource,
  trackedSources,
  withoutComments,
} from './document-writes'

/**
 * A form reference handed IN rather than spelled: the one name every writer
 * that takes a form's reference as a parameter or field gives it.
 */
const PASSED_REF = 'formRef'

/** Every write to a form document in one comment-free source. */
const formWrites = (source: string): DocumentWrite[] =>
  documentWrites(source, 'forms', PASSED_REF)

/**
 * The writes that are bookkeeping rather than edits, whose data this sweep
 * cannot read, by the text of their data argument, each with why it carries
 * no `updatedAt`. A literal whose every key is under `stats.` is bookkeeping
 * on its face and needs no entry.
 */
const BOOKKEEPING: ReadonlyArray<{ file: string; data: string; why: string }> = [
  {
    file: 'apps/tenant/utils/increment-form-stats.ts',
    data: 'patch',
    why: "a submission's counters; a visitor's submission is not an edit to the form",
  },
  {
    file: 'libs/plugins/forms/src/lib/server/form-stats.ts',
    data: 'formCounterPatch(recounted)',
    why: 'the recount puts the counters back to what the rows say',
  },
  {
    file: 'tools/scripts/recount-form-stats.mjs',
    data: 'formCounterPatch(recounted)',
    why: 'the same recount, over every form',
  },
  {
    file: 'libs/plugins/marketing/src/lib/server/campaign-form-flags.ts',
    data: '{ inCampaign }',
    why: 'the mirror restamped after the campaign deletion pass, whose own write bumped updatedAt',
  },
]

/** Whether a literal writes nothing but the counters under `stats.`. */
function countersOnly(data: string): boolean {
  const keys = literalKeys(data)
  return Boolean(keys?.length) && keys!.every((key) => /^\[?\s*[`'"]stats\./.test(key))
}

/** What is wrong with one write, or nothing. */
function violations(file: string, write: DocumentWrite): string[] {
  const found: string[] = []
  const { data } = write
  const writesName = /(?:^|[{,\s])displayName\s*[:,}]/.test(data)
  const namesHelper = /\b(?:newFormListFields|formListFields)\(/.test(data)
  if (writesName && !namesHelper) {
    found.push('sets displayName without formListFields/newFormListFields')
  }
  const writesCampaigns =
    /(?:^|[{,\s])campaignIds\s*[:,}]|\[\s*(?:Aglyn\.)?CAMPAIGN_MEMBERSHIP_FIELD\s*\]/.test(data)
  if (writesCampaigns && !/\b(?:formCampaignFields|newFormListFields)\(/.test(data)) {
    found.push('sets campaignIds without formCampaignFields')
  }
  const bookkeeping =
    countersOnly(data) || BOOKKEEPING.some((entry) => entry.file === file && entry.data === data)
  if (!isCreate(write) && !bookkeeping && !/\bupdatedAt\b/.test(data)) {
    found.push('updates a form without updatedAt')
  }
  return found
}

describe('AGL-3330 · every write to a form keeps the Forms list true', () => {
  const sites = (() => {
    const found: Array<{ file: string; write: DocumentWrite }> = []
    for (const file of trackedSources()) {
      const raw = readSource(file)
      if (!raw.includes("'forms'") && !raw.includes('formRef')) continue
      for (const write of formWrites(withoutComments(raw))) found.push({ file, write })
    }
    return found
  })()

  it('finds the writers it is meant to hold, so a silent pass means something', () => {
    const files = new Set(sites.map((site) => site.file))
    for (const file of [
      'libs/plugins/forms/src/lib/components/host-forms-card.component.tsx',
      'libs/plugins/forms/src/lib/components/form-detail-card.tsx',
      'libs/plugins/crm/src/lib/components/lead-surfaces-note.tsx',
      'apps/console/app/api/hosts/forms/promote/route.ts',
      'apps/console/app/(editor)/[orgSlug]/hosts/[host]/forms/[formId]/versions/[versionId]/besigner/page.tsx',
      'apps/tenant/utils/increment-form-stats.ts',
    ]) {
      expect([file, files.has(file)]).toEqual([file, true])
    }
  })

  it('finds no write that skips the name keys, the campaign flag or Updated', () => {
    const offenders: string[] = []
    for (const { file, write } of sites) {
      for (const problem of violations(file, write)) offenders.push(`${file}: ${problem} — ${write.at}`)
    }
    expect(offenders.sort()).toEqual([])
  })

  it('names only bookkeeping that still exists', () => {
    for (const entry of BOOKKEEPING) {
      const present = sites.some((site) => site.file === entry.file && site.write.data === entry.data)
      expect([entry.file, entry.data, present]).toEqual([entry.file, entry.data, true])
    }
  })

  it('pins the create doors that write a form by a collection variable', () => {
    for (const file of [
      'apps/console/app/api/hosts/resources/route.ts',
      'libs/tenant/data/admin/src/lib/server/duplicate-resource.ts',
      'libs/plugins/ai/src/lib/jobs/ai-job-drafts.ts',
      'tools/scripts/lib/crm-fixtures.mjs',
    ]) {
      expect([file, /\bnewFormListFields\(/.test(readCode(file))]).toEqual([file, true])
    }
    // The campaign deletion pass removes an id with `arrayRemove`, which
    // cannot say whether the array came out empty: it restamps the flag.
    const detach = readCode('libs/plugins/marketing/src/lib/server/campaign-manage.ts')
    expect(detach).toMatch(/restampFormsInCampaign\(firestore,/)
    expect(detach).toMatch(/isForms \? \{ updatedAt:/)
  })

  /**
   * The shapes the writers had before (AGL-3330), and the ones that stay
   * legal. A detector that has never gone red is not yet a detector.
   */
  it('refuses the shapes the writers used, and passes the helpers', () => {
    const refused: Array<[string, string]> = [
      [
        "await updateDoc(doc(firestore, 'hosts', hostId, 'forms', formId), { archivedAt: Date.now(), retired: true })",
        'updates a form without updatedAt',
      ],
      [
        "await updateDoc(doc(firestore, 'hosts', hostId, 'forms', formId), { displayName: next, updatedAt: Timestamp.now() })",
        'sets displayName without formListFields/newFormListFields',
      ],
      [
        "await firestore.collection('hosts').doc(h).collection('forms').doc(id).update({ campaignIds: ids, updatedAt: now })",
        'sets campaignIds without formCampaignFields',
      ],
      [
        "const formRef = hostRef.collection('forms').doc(formId)\nawait formRef.update({ consentFieldName: 'c' })",
        'updates a form without updatedAt',
      ],
      [
        "tx.update(hostRef.collection('forms').doc(formId), { [Aglyn.CAMPAIGN_MEMBERSHIP_FIELD]: ids, updatedAt: now })",
        'sets campaignIds without formCampaignFields',
      ],
      [
        "await updateDoc(doc(firestore, 'hosts', hostId, 'forms', formId), { campaignIds, updatedAt: Timestamp.now() })",
        'sets campaignIds without formCampaignFields',
      ],
    ]
    for (const [shape, problem] of refused) {
      const writes = formWrites(shape)
      expect([shape, writes.length]).toEqual([shape, 1])
      expect(violations('x.ts', writes[0])).toContain(problem)
    }

    const allowed = [
      "await updateDoc(doc(firestore, 'hosts', hostId, 'forms', formId), { displayName: n, ...Aglyn.formListFields({ id, displayName: n }), updatedAt: Timestamp.now() })",
      "await updateDoc(doc(firestore, 'hosts', hostId, 'forms', formId), { ...Aglyn.formCampaignFields(ids), updatedAt: Timestamp.now() })",
      "await updateDoc(doc(firestore, 'hosts', hostId, 'forms', form.$id), { 'routing.lead': true, updatedAt: serverTimestamp() })",
      "tx.create(hostRef.collection('forms').doc(id), { displayName: name, ...newFormListFields({ id, displayName: name }) })",
      "const snapshot = await hostRef.collection('forms').doc(formId).get()",
    ]
    for (const shape of allowed) {
      for (const write of formWrites(shape)) expect([shape, violations('x.ts', write)]).toEqual([shape, []])
    }
  })
})
