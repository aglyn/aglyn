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
 * A form is a besigner document, on the same four rails a component is.
 *
 * Making one kind designable is not a single change — it is a route, a
 * versions parent, a rules block and a create payload, and each of the four
 * fails DIFFERENTLY and quietly if it is the one that was missed:
 *
 *  - no route, and the detail page has nowhere to send the author;
 *  - no `PARENTS` entry, and minting the first version 400s on a kind the
 *    route does not recognise;
 *  - no nested rules block, and every save is denied — `forms` is named in
 *    all three of the host catch-all's exclusion lists, so a subpath with no
 *    dedicated block of its own matches nothing that allows;
 *  - no `nodes`/`rootId` in the create allow-list, and the form is created
 *    with the design silently stripped, so the besigner opens on an empty
 *    canvas and the author redraws a form that already existed.
 *
 * The routes are asserted through `buildRoute`, which is the thing callers
 * actually use. The rest are source assertions because the failure mode is an
 * absence, and an absence renders perfectly.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildRoute, Route } from '@aglyn/aglyn/server'

const readRepo = (rel: string) =>
  readFileSync(join(process.cwd(), rel), 'utf8')
// Jest's cwd is the repo root here, not apps/console.
const read = (rel: string) => readRepo(join('apps/console', rel))

const VERSIONS_ROUTE = 'app/api/hosts/versions/route.ts'
const RESOURCES_ROUTE = 'app/api/hosts/resources/route.ts'
const RULES = 'cloud/firebase-firestore.rules'

describe('a form has the routes a designable document needs', () => {
  const params = { orgSlug: 'acme', host: 'site-1', formId: 'form-abc' }

  it('routes to its own detail page, like a component does', () => {
    expect(buildRoute(Route.FORM_DETAILS, params)).toBe(
      '/acme/hosts/site-1/forms/form-abc',
    )
  })

  it('routes to a besigner keyed by form AND version', () => {
    // The versionId is what makes the editor a draft surface rather than a
    // direct edit of what the public is submitting to.
    expect(
      buildRoute(Route.FORM_BESIGNER, { ...params, versionId: 'v1' }),
    ).toBe('/acme/hosts/site-1/forms/form-abc/versions/v1/besigner')
  })

  it('routes to a preview of the same version', () => {
    expect(buildRoute(Route.FORM_PREVIEW, { ...params, versionId: 'v1' })).toBe(
      '/acme/hosts/site-1/forms/form-abc/versions/v1/preview',
    )
  })

  it('puts the list at the bare path, matching components and layouts', () => {
    expect(buildRoute(Route.HOST_FORMS, params)).toBe('/acme/hosts/site-1/forms')
  })

  it('nests the besigner under the detail path', () => {
    // A besigner URL that was not a child of the detail URL would make the
    // breadcrumb a fiction and the back button a guess.
    expect(
      buildRoute(Route.FORM_BESIGNER, { ...params, versionId: 'v1' }),
    ).toContain(buildRoute(Route.FORM_DETAILS, params))
  })
})

describe('the versions API knows what a form is', () => {
  it('lists forms among the parents that carry version history', () => {
    expect(read(VERSIONS_ROUTE)).toContain("form: 'forms',")
  })

  it('lets a version seed carry its back-pointer', () => {
    // `formId` is dropped by the allow-list if it is not named, and the
    // version then belongs to nothing.
    const source = read(VERSIONS_ROUTE)
    const keys = source.slice(
      source.indexOf('const VERSION_KEYS'),
      source.indexOf('])', source.indexOf('const VERSION_KEYS')),
    )
    expect(keys).toContain("'formId'")
    expect(keys).toContain("'nodes'")
    expect(keys).toContain("'rootId'")
  })

  it('does NOT invent a new activity type for a form', () => {
    // `HostActivityTarget['type']` is a persisted value that
    // `activity-presenter.ts` branches on. A member no presenter knows
    // renders as an unlinked row, so a form files under `content` — the
    // classification the resources route already gives it.
    const source = read(VERSIONS_ROUTE)
    expect(source).toContain("form: 'content',")
    expect(source).not.toContain("type: kind as 'screen' | 'layout' | 'component'")
  })
})

describe('creating a form creates a design, not just a declaration', () => {
  it('allows the canvas through the create allow-list', () => {
    const source = read(RESOURCES_ROUTE)
    const entry = source.slice(
      source.indexOf('  form: {'),
      source.indexOf('  },', source.indexOf('  form: {')),
    )
    expect(entry).toContain("collection: 'forms'")
    expect(entry).toContain("'rootId'")
    expect(entry).toContain("'nodes'")
  })

  it('keeps the declaration separate from the design', () => {
    // `fields` is what the submission path reads; `nodes` is what the author
    // draws. Publishing is where `checkFormContract` requires them to agree,
    // and collapsing them into one would remove the thing it compares.
    const source = read(RESOURCES_ROUTE)
    const entry = source.slice(
      source.indexOf('  form: {'),
      source.indexOf('  },', source.indexOf('  form: {')),
    )
    expect(entry).toContain("'fields'")
    expect(entry).toContain("'consentFieldName'")
    expect(entry).toContain("'routing'")
  })
})

/**
 * The check is only worth having if it stands BETWEEN the author and the
 * write.
 *
 * `form-contract.spec.ts` proves the rule is right. Nothing there proves it
 * runs, and a contract check that is called after the publish, or whose
 * result is computed and not acted on, is indistinguishable from no check at
 * all while looking exactly like one in review.
 */
describe('the besigner publish path is gated on the contract', () => {
  const FORM_BESIGNER_PAGE =
    'app/(editor)/[orgSlug]/hosts/[host]/forms/[formId]/versions/[versionId]/besigner/page.tsx'

  const source = () => read(FORM_BESIGNER_PAGE)

  it('runs the check before the write that publishes', () => {
    const text = source()
    const checkedAt = text.indexOf('checkFormContract')
    const publishedAt = text.indexOf("updateDoc(doc(firestore, 'hosts', hostId, 'forms', formId)")
    expect(checkedAt).toBeGreaterThan(-1)
    expect(publishedAt).toBeGreaterThan(-1)
    expect(checkedAt).toBeLessThan(publishedAt)
  })

  it('returns on a violation rather than only reporting one', () => {
    // A computed-and-ignored result is the shape this is guarding against.
    // The early return has to sit between the two positions above.
    const text = source()
    const refusedAt = text.indexOf('if (!Aglyn.formContractIsSatisfied(violations)) {')
    const publishedAt = text.indexOf("updateDoc(doc(firestore, 'hosts', hostId, 'forms', formId)")
    expect(refusedAt).toBeGreaterThan(-1)
    expect(refusedAt).toBeLessThan(publishedAt)
    expect(text.slice(refusedAt, publishedAt)).toContain('return enqueueSnackbar')
  })

  it('makes the refusal persist, so it cannot be missed', () => {
    // An auto-dismissed warning is how somebody walks away believing the form
    // shipped.
    const text = source()
    const refusedAt = text.indexOf('if (!Aglyn.formContractIsSatisfied(violations)) {')
    const publishedAt = text.indexOf("updateDoc(doc(firestore, 'hosts', hostId, 'forms', formId)")
    expect(text.slice(refusedAt, publishedAt)).toContain('persist: true')
  })

  it('publishes the declaration derived from the same tree it checked', () => {
    // `fields` is what the submit route reads and what the detail page's
    // consent picker offers. Writing `nodes` without it is how the two drift
    // straight back apart after the check passed.
    const text = source()
    const publishedAt = text.indexOf("updateDoc(doc(firestore, 'hosts', hostId, 'forms', formId)")
    const write = text.slice(publishedAt, publishedAt + 400)
    expect(text).toContain('formFieldDeclsFromNodes')
    expect(write).toContain('fields,')
    expect(write).toContain('nodes: publishedNodes')
  })
})

describe('the rules let a form version be written at all', () => {
  const formsBlock = () => {
    const source = readRepo(RULES)
    const start = source.indexOf('match /forms/{formId} {')
    expect(start).toBeGreaterThan(-1)
    // Up to the next sibling `match` at the same indent, which is where this
    // block's nested matchers stop.
    const end = source.indexOf('\n      match /', start + 1)
    return source.slice(start, end === -1 ? undefined : end)
  }

  it('carries a draft block, so the besigner can save', () => {
    expect(formsBlock()).toContain(
      'match /versions/{versionId}/draft/{draftId} {',
    )
  })

  it('carries a subcollection block, so a version document is reachable', () => {
    // Without this, `forms/{id}/versions/{v}` matches only the host catch-all,
    // which names `forms` in its create, update AND delete exclusion lists —
    // so the write is denied and the besigner cannot save at all.
    expect(formsBlock()).toContain('match /{sub}/{document=**} {')
  })

  it('still keeps a version delete behind the publish role', () => {
    // Same asymmetry components have: clearing a DRAFT is authoring, deleting
    // a VERSION is not.
    expect(formsBlock()).toContain("(canPublishHostContent(hostId) || sub != 'versions')")
  })

  it('still refuses a client write to the stats counters', () => {
    // The pre-existing protection, re-asserted because the nested blocks were
    // added inside this same matcher and a careless edit could widen it.
    expect(formsBlock()).toContain("affectedKeys().hasAny(['stats'])")
  })

  it('still denies a client-direct create of the form itself', () => {
    // Creation routes through /api/hosts/resources so the entitlement and
    // FORMS_MAX_PER_HOST are enforced server-side.
    expect(formsBlock()).toContain('allow create: if isStaff();')
  })
})
