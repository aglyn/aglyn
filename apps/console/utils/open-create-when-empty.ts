/**
 * A workspace with no sites opens "Create site" by itself (AGL-3761 family,
 * decided 2026-11-11).
 *
 * The activation review found that the largest single place new accounts
 * stop is a workspace with no site: they reach the sites page, see "No sites
 * yet" and a button, and leave. Now that page opens the start chooser for
 * them, the same dialog the button opens, so the first thing they see is the
 * choice of how their site starts.
 *
 * Once per browser session per workspace: a person who closes it has said
 * "not now", and reopening it on every visit to the page would stop them
 * from looking around. A storage that refuses to answer (a private window,
 * blocked site data) counts as not yet opened, and the open is not
 * remembered, which at worst opens it again on the next visit.
 */

const KEY_PREFIX = 'aglyn:create-site-auto-opened:'

export interface OpenCreateWhenEmptyInput {
  /** The site list read finished and is trustworthy (AGL-1066). */
  sitesLoaded: boolean
  /** How many sites the workspace holds. */
  siteCount: number
  /** A pending invite leads instead (AGL-234). */
  pendingInvites: number
  /** The reader may create sites here. */
  canCreate: boolean
  /** The page was reached with `?create=site`, which opens it already. */
  askedByUrl: boolean
  /** The workspace the page shows. */
  orgId: string | null | undefined
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

function alreadyOpened(orgId: string): boolean {
  try {
    return storage()?.getItem(KEY_PREFIX + orgId) === '1'
  } catch {
    return false
  }
}

/** Whether the sites page should open "Create site" now. */
export function shouldOpenCreateWhenEmpty(input: OpenCreateWhenEmptyInput): boolean {
  if (!input.orgId) return false
  if (!input.sitesLoaded || input.siteCount > 0) return false
  if (input.pendingInvites > 0 || !input.canCreate || input.askedByUrl) return false
  return !alreadyOpened(input.orgId)
}

/** Remember that "Create site" opened by itself for this workspace. */
export function markCreateOpenedWhenEmpty(orgId: string): void {
  try {
    storage()?.setItem(KEY_PREFIX + orgId, '1')
  } catch {
    // Storage refused: it may open once more on the next visit.
  }
}
