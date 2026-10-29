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
 * The API half of "the rules and the API agree about a custom role".
 *
 * `cloud/rules-org-data-permission.spec.mjs` asks Firestore what each
 * principal may do. This asks the SERVER's own resolver about the same
 * principals, from the same table, so the claim is an assertion rather than
 * two suites each restating whatever their side happens to do.
 *
 * ## The direction the disagreement actually ran
 *
 * It is worth stating precisely, because it was easy to guess backwards. A
 * custom role NARROWED, the API honored the narrowing, and the rules did not:
 * an editor whose `data.manage` was revoked was refused a create by the API
 * and permitted every dataset edit and record delete by the rules, which are
 * the only gate on those paths. The rules were the leak.
 *
 * ## The key alone (AGL-4047)
 *
 * Both sides then gated on the owner, admin or editor role AND the key, so a
 * grant could never WIDEN: a viewer whose custom role granted `data.manage`
 * was refused by both. Every action is permission-checked and a role is only
 * a preset, so both now ask the key and nothing else. Its default is exactly
 * those three roles, which keeps every member nobody granted or refused it
 * where they were; a grant now opens the route and the rules alike.
 *
 * ## Anti-vacuity
 *
 * `resolveOrgPermissions` is the real resolver, not a double: it is what
 * `memberHasOrgPermission` delegates to, so a stub here would leave this
 * asserting that a stub was consulted. The table is checked for both verdicts
 * being present, because a table of all-false rows agrees with a gate that
 * refuses everybody.
 */

import { resolveOrgPermissions, type OrgPermission } from '@aglyn/aglyn'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface Principal {
  uid: string
  note: string
  rulesOnly?: boolean
  member: Record<string, unknown>
  customRole: { id: string; permissions: Record<string, boolean> } | null
  mayWriteDatasets: boolean
}

const FIXTURE = join(
  __dirname,
  '../../../cloud/rules-fixtures/org-data-principals.json',
)
const ROUTE = join(
  __dirname,
  '../../../libs/plugins/data/src/lib/server/datasets-route.ts',
)

const principals: Principal[] = JSON.parse(
  readFileSync(FIXTURE, 'utf8'),
).principals

/** Rows the API expresses through a different mechanism than a permission. */
const shared = principals.filter((principal) => principal.rulesOnly !== true)

/**
 * The route's own gate, rebuilt: the member's resolved `data.manage`.
 *
 * Asserted to still be the route's below, so this cannot quietly go on
 * describing a check that was removed, or miss one that was added back.
 */
const apiMayWriteDatasets = (principal: Principal): boolean => {
  const granted = resolveOrgPermissions(
    principal.member as never,
    principal.customRole
      ? ({ permissions: principal.customRole.permissions } as never)
      : null,
  )
  return granted['data.manage' as OrgPermission] === true
}

describe('the dataset write authority', () => {
  it('is the same for the API as the table the rules are held to', () => {
    const disagreements = shared
      .filter(
        (principal) =>
          apiMayWriteDatasets(principal) !== principal.mayWriteDatasets,
      )
      .map((principal) => `${principal.uid}: ${principal.note}`)
    expect(disagreements).toEqual([])
  })

  it('resolves a REVOKING custom role to a refusal, as the rules now do', () => {
    // The defect, isolated. Same role, same everything, one revoked key.
    const revoked = shared.find((p) => p.uid === 'uid-editor-revoked')
    expect(revoked).toBeDefined()
    expect(apiMayWriteDatasets(revoked as Principal)).toBe(false)
    expect((revoked as Principal).mayWriteDatasets).toBe(false)
  })

  it('a GRANTING custom role or override widens a viewer, on either side (AGL-4047)', () => {
    // The mirror. The key decides; the role is only its preset.
    for (const uid of ['uid-viewer-granted', 'uid-viewer-member-granted', 'uid-viewer-override-only-granted']) {
      const granted = shared.find((p) => p.uid === uid)
      expect(granted).toBeDefined()
      expect(apiMayWriteDatasets(granted as Principal)).toBe(true)
      expect((granted as Principal).mayWriteDatasets).toBe(true)
    }
  })

  it('the presets keep today: owner, admin and editor yes; a viewer or a site author no', () => {
    const verdicts = Object.fromEntries(
      ['uid-owner', 'uid-admin-bare', 'uid-editor', 'uid-editor-bare', 'uid-viewer', 'uid-viewer-bare', 'uid-site-author'].map(
        (uid) => [uid, apiMayWriteDatasets(shared.find((p) => p.uid === uid) as Principal)],
      ),
    )
    expect(verdicts).toEqual({
      'uid-owner': true,
      'uid-admin-bare': true,
      'uid-editor': true,
      'uid-editor-bare': true,
      'uid-viewer': false,
      'uid-viewer-bare': false,
      'uid-site-author': false,
    })
  })

  it('an editor whose own permissions deny the key is refused, on either side', () => {
    const denied = shared.find((p) => p.uid === 'uid-editor-member-denied')
    expect(denied).toBeDefined()
    expect(apiMayWriteDatasets(denied as Principal)).toBe(false)
    expect((denied as Principal).mayWriteDatasets).toBe(false)
  })

  it('a per-member override beats the custom role, on either side', () => {
    const restored = shared.find((p) => p.uid === 'uid-editor-restored')
    expect(restored).toBeDefined()
    expect(apiMayWriteDatasets(restored as Principal)).toBe(true)
    expect((restored as Principal).mayWriteDatasets).toBe(true)
  })

  it('ANTI-VACUITY: the table carries both verdicts, several of each', () => {
    // A table of all-false rows agrees with a gate that refuses everybody,
    // and a table of all-true rows agrees with one that refuses nobody.
    const permitted = shared.filter((p) => p.mayWriteDatasets)
    const refused = shared.filter((p) => !p.mayWriteDatasets)
    expect(permitted.length).toBeGreaterThan(2)
    expect(refused.length).toBeGreaterThan(2)
  })

  it('ANTI-VACUITY: the table covers a member with NO resolved map', () => {
    // The row that decides whether this ships as a mass lockout. It must be
    // in the table and it must be permitted.
    const bare = shared.find((p) => p.uid === 'uid-editor-bare')
    expect(bare).toBeDefined()
    expect((bare as Principal).member['resolvedPermissions']).toBeUndefined()
    expect((bare as Principal).mayWriteDatasets).toBe(true)
    // And its mirror, so "absent" cannot be reading as "everything allowed".
    const bareViewer = shared.find((p) => p.uid === 'uid-viewer-bare')
    expect(bareViewer).toBeDefined()
    expect(
      (bareViewer as Principal).member['resolvedPermissions'],
    ).toBeUndefined()
    expect((bareViewer as Principal).mayWriteDatasets).toBe(false)
  })

  it('the route applies the one gate this file models, and no role gate', () => {
    /*
     * A source assertion, because the function above is a model of the
     * route and a model drifts. If the key's check is removed, or a role
     * gate comes back beside it, every agreement claim here is worthless.
     */
    const source = readFileSync(ROUTE, 'utf8')
    expect(source).toContain("const DATASETS_PERMISSION = 'data.manage'")
    expect(source).toContain('memberHasOrgPermission(orgId, member, DATASETS_PERMISSION)')
    expect(source).not.toContain('WRITER_ROLES')
    expect(source).not.toMatch(/member\.role\b/)
  })

  it('the RULES read the denormalized map, not the role alone', () => {
    /*
     * The other end of the same worry. The emulator suite proves the rules
     * behave; this proves the behavior comes from the resolved map rather
     * than from some coincidence of the fixture's roles — the rules file is
     * deployed by hand, outside this pipeline, so a revert here is silent.
     */
    const rules = readFileSync(
      join(__dirname, '../../../cloud/firebase-firestore.rules'),
      'utf8',
    )
    expect(rules).toContain('function memberKeyOrOverride(permission, presetRoles)')
    expect(rules).toContain(
      "memberKeyOrOverride('data.manage', ['owner', 'admin', 'editor'])",
    )
    // The default chain, which is what stops an absent map answering either
    // "everything" or "nothing".
    expect(rules).toContain(
      "orgMember().get('permissions', {}))",
    )
    // And no role gate beside it on the dataset writes.
    const datasets = rules.slice(
      rules.indexOf('function canWriteOrgDatasets()'),
      rules.indexOf('function canReadTransferJobs()'),
    )
    expect(datasets).not.toContain('canWriteOrgData()')
    expect(datasets).not.toMatch(/\.role\s+in\b/)
  })
})
