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

import { locateQuoteProofMedia, quoteProofMediaName, type QuoteProofMediaDeps } from './quote-proof-media'

jest.mock('@aglyn/tenant-data-admin', () => ({ firebaseAdmin: {}, resolveOrgMembership: jest.fn() }))

/**
 * Who may have which media library file as a quote's proof (AGL-4184): only the
 * quote's own site's and workspace's, only what the member could read, and only
 * what is live. Every "may not" answers the same.
 */

const REFUSED = {
  ok: false,
  status: 404,
  error: 'That file isn’t in a media library you can read for this site. Choose another.',
}

const ORG_FILE = {
  fileName: 'Banner.png',
  contentType: 'image/png',
  visibleTo: ['org'],
  storagePath: 'orgs/org-1/media/art/m1',
}

let docs: Record<string, Record<string, unknown> | undefined> = {}
let member: Record<string, unknown> | null = { role: 'editor', hostAccess: 'all', scopeTokens: ['org'] }
let blocked: 'locked' | 'quarantined' | null = null
const docsRead: string[] = []

const deps: QuoteProofMediaDeps = {
  mediaDoc: async (scope, mediaId) => {
    const path = `${scope.isOrg ? 'orgs' : 'hosts'}/${scope.scopeId}/media/${mediaId}`
    docsRead.push(path)
    return docs[path] ?? null
  },
  orgMember: async () => member as never,
  serveBlock: async () => blocked,
  objectPath: async ({ storagePath, base, mediaId }) =>
    String(storagePath).startsWith(`${base}/media/`) ? String(storagePath) : `${base}/media/${mediaId}`,
}

const ask = (mediaScope: string, mediaId = 'm1', uid = 'u1') =>
  locateQuoteProofMedia({ hostId: 'site1', orgId: 'org-1', uid, mediaScope, mediaId }, deps)

beforeEach(() => {
  docs = { 'orgs/org-1/media/m1': ORG_FILE }
  member = { role: 'editor', hostAccess: 'all', scopeTokens: ['org'] }
  blocked = null
  docsRead.length = 0
})

describe('whose library a proof can come from', () => {
  it('takes the workspace’s library and says where the bytes are', async () => {
    expect(await ask('org:org-1')).toEqual({ ok: true, path: 'orgs/org-1/media/art/m1', name: 'Banner.png' })
  })

  it('takes the workspace’s library in this site’s context', async () => {
    expect(await ask('org:org-1:site1')).toMatchObject({ ok: true })
  })

  it('takes this site’s own library', async () => {
    docs = { 'hosts/site1/media/m1': { fileName: 'a.pdf', contentType: 'application/pdf', storagePath: 'hosts/site1/media/m1' } }
    expect(await ask('site1')).toEqual({ ok: true, path: 'hosts/site1/media/m1', name: 'a.pdf' })
    // A site's library is its members', and `commerce.quotes` made them one: no roster is asked.
    member = null
    expect(await ask('site1')).toMatchObject({ ok: true })
  })

  it('refuses another workspace’s library, reading nothing', async () => {
    docs['orgs/org-2/media/m1'] = ORG_FILE
    expect(await ask('org:org-2')).toEqual(REFUSED)
    expect(docsRead).toEqual([])
  })

  it('refuses another site’s library, in the same workspace too, reading nothing', async () => {
    docs['hosts/site2/media/m1'] = { fileName: 'a.png', contentType: 'image/png' }
    expect(await ask('site2')).toEqual(REFUSED)
    expect(docsRead).toEqual([])
  })

  it('refuses the workspace’s library in another site’s context', async () => {
    expect(await ask('org:org-1:site2')).toEqual(REFUSED)
    expect(docsRead).toEqual([])
  })

  it('refuses a workspace it cannot name, and a scope or id it cannot read', async () => {
    expect(await locateQuoteProofMedia({ hostId: 'site1', orgId: '', uid: 'u1', mediaScope: 'org:', mediaId: 'm1' }, deps)).toEqual(REFUSED)
    expect(await ask('org:a:b:c')).toEqual(REFUSED)
    expect(await ask('org:org-1', '../../secret')).toEqual(REFUSED)
    expect(await ask('')).toEqual(REFUSED)
  })
})

describe('what the member may read', () => {
  it('refuses someone not on the workspace’s roster', async () => {
    member = null
    expect(await ask('org:org-1')).toEqual(REFUSED)
    expect(docsRead).toEqual([])
  })

  it('refuses a file outside a narrowed member’s reach, and takes one inside it', async () => {
    docs['orgs/org-1/media/m1'] = { ...ORG_FILE, visibleTo: ['host:site1'] }
    member = { role: 'editor', hostAccess: ['site2'], scopeTokens: ['host:site2'] }
    expect(await ask('org:org-1')).toEqual(REFUSED)
    member = { role: 'editor', hostAccess: ['site1'], scopeTokens: ['host:site1'] }
    expect(await ask('org:org-1')).toMatchObject({ ok: true })
  })

  it('refuses a file the workspace does not share with this site, whoever asks', async () => {
    docs['orgs/org-1/media/m1'] = { ...ORG_FILE, visibleTo: ['host:site2'] }
    expect(await ask('org:org-1')).toEqual(REFUSED)
  })

  it('refuses a file with no scope at all, as the rules do', async () => {
    docs['orgs/org-1/media/m1'] = { fileName: 'a.png', contentType: 'image/png' }
    expect(await ask('org:org-1')).toEqual(REFUSED)
  })
})

describe('whether the file is live', () => {
  it('refuses one that is gone or deleted, as it refuses one the member can’t read', async () => {
    expect(await ask('org:org-1', 'missing')).toEqual(REFUSED)
    docs['orgs/org-1/media/m1'] = { ...ORG_FILE, deletedAt: { seconds: 1 } }
    expect(await ask('org:org-1')).toEqual(REFUSED)
  })

  it('refuses a quarantined file or a locked library', async () => {
    for (const reason of ['quarantined', 'locked'] as const) {
      blocked = reason
      expect(await ask('org:org-1')).toEqual({ ok: false, status: 409, error: 'That file can’t be used right now. Choose another.' })
    }
  })

  it('takes a private file: the copy is as private as the proof it becomes', async () => {
    docs['orgs/org-1/media/m1'] = { ...ORG_FILE, private: true }
    expect(await ask('org:org-1')).toMatchObject({ ok: true })
  })

  it('never reads an object outside the library’s own media folder', async () => {
    docs['orgs/org-1/media/m1'] = { ...ORG_FILE, storagePath: 'orgs/org-2/media/secret.png' }
    expect(await ask('org:org-1')).toMatchObject({ ok: true, path: 'orgs/org-1/media/m1' })
  })
})

describe('the name a proof takes', () => {
  it('keeps a name that says what the file is', () => {
    expect(quoteProofMediaName('Banner.PNG', 'image/png')).toBe('Banner.PNG')
    expect(quoteProofMediaName('art.jpg', 'image/jpg')).toBe('art.jpg')
  })

  it('adds the stored type’s extension to one that does not', () => {
    expect(quoteProofMediaName('Banner final', 'image/png')).toBe('Banner final.png')
    expect(quoteProofMediaName('', 'application/pdf')).toBe('proof.pdf')
    expect(quoteProofMediaName('photo', 'image/jpg')).toBe('photo.jpg')
  })

  it('leaves a kind of file a proof can’t be for the upload’s check to refuse', () => {
    expect(quoteProofMediaName('clip.mp4', 'video/mp4')).toBe('clip.mp4')
  })
})
