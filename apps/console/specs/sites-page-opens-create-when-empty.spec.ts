import {
  markCreateOpenedWhenEmpty,
  shouldOpenCreateWhenEmpty,
  type OpenCreateWhenEmptyInput,
} from '../utils/open-create-when-empty'

const empty: OpenCreateWhenEmptyInput = {
  sitesLoaded: true,
  siteCount: 0,
  pendingInvites: 0,
  canCreate: true,
  askedByUrl: false,
  orgId: 'org-a',
}

describe('a workspace with no sites opens Create site by itself', () => {
  beforeEach(() => window.sessionStorage.clear())

  it('opens for a loaded, empty workspace the reader can create in', () => {
    expect(shouldOpenCreateWhenEmpty(empty)).toBe(true)
  })

  it('opens once per session per workspace', () => {
    markCreateOpenedWhenEmpty('org-a')
    expect(shouldOpenCreateWhenEmpty(empty)).toBe(false)
    expect(shouldOpenCreateWhenEmpty({ ...empty, orgId: 'org-b' })).toBe(true)
  })

  it.each<[string, Partial<OpenCreateWhenEmptyInput>]>([
    ['the site list has not loaded (or was refused)', { sitesLoaded: false }],
    ['the workspace already has a site', { siteCount: 1 }],
    ['an invite is waiting', { pendingInvites: 1 }],
    ['the reader cannot create sites', { canCreate: false }],
    ['the address already asks for it', { askedByUrl: true }],
    ['no workspace is resolved', { orgId: null }],
  ])('does not open when %s', (_, change) => {
    expect(shouldOpenCreateWhenEmpty({ ...empty, ...change })).toBe(false)
  })
})
