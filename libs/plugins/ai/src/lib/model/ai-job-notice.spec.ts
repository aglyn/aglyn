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
 * The notification a job's creator gets when it needs them, finishes or stops
 * (AGL-3593): its type, level and words, and where its link goes — AI jobs on
 * the job, or what a finished job built.
 */

import { normalizeNotificationLink, notificationLevel } from '@aglyn/aglyn/app-utils/notifications'
import { aiJobNotice, type AiJobNoticeSource } from './ai-job-notice'

const screen = (id: string, versionId = `${id}-v1`) => ({
  resource: 'screen' as const,
  id,
  versionId,
  hostId: 'host-doc',
  hostSubdomain: 'roofers',
  label: id,
})

function source(patch: Partial<AiJobNoticeSource> = {}): AiJobNoticeSource {
  return {
    $id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-doc',
    kind: 'site',
    review: null,
    outputs: [],
    error: null,
    ...patch,
  }
}

const context = { orgSlug: 'acme', hostId: 'host-doc', hostSubdomain: 'roofers' }

describe('a plan waiting to be confirmed', () => {
  it('asks the person to confirm it, as a warning, and opens AI jobs on the job', () => {
    const notice = aiJobNotice(source({ review: { reason: 'plan' } }), 'needs-review')
    expect(notice.type).toBe('content.aiJobNeedsYou')
    expect(notice.title).toBe('Your site plan is ready: confirm it to build')
    expect(notificationLevel(notice)).toBe('warning')
    expect(notice.orgId).toBe('org-1')
    expect(notice.hostId).toBe('host-doc')
    expect(normalizeNotificationLink(notice.link, context)).toBe('/acme/hosts/roofers/ai-jobs/job-1')
  })

  it('says a refused step needs the person, in the review’s own sentence', () => {
    const notice = aiJobNotice(
      source({ kind: 'page', review: { reason: 'doctrine', message: 'The page broke a building rule.' } }),
      'needs-review',
    )
    expect(notice.type).toBe('content.aiJobNeedsYou')
    expect(notice.title).toBe('Your page job needs you')
    expect(notice.body).toBe('The page broke a building rule.')
  })
})

describe('a finished job', () => {
  it('opens a site’s draft pages when it built several', () => {
    const notice = aiJobNotice(source({ outputs: [screen('home'), screen('about')] }), 'done')
    expect(notice.type).toBe('content.aiJobDone')
    expect(notice.title).toBe('Your site’s draft pages are ready')
    expect(notificationLevel(notice)).toBe('success')
    // A site job opens its build page, which leads with its pages (AGL-3594).
    expect(normalizeNotificationLink(notice.link, context)).toBe('/acme/hosts/roofers/ai-jobs/job-1')
  })

  it('says a guided start’s site is live once its pages are published (AGL-3596)', () => {
    const published = [{ id: 'home', label: 'Home', path: '/' }]
    const notice = aiJobNotice(
      source({ outputs: [screen('home')], sitePublish: { published, drafts: [] } }),
      'done',
    )
    expect(notice.title).toBe('Your site is live')
    expect(notice.body).toBe('Your pages are published. Open it to view your site or edit your pages.')
    expect(notificationLevel(notice)).toBe('success')
    expect(normalizeNotificationLink(notice.link, context)).toBe('/acme/hosts/roofers/ai-jobs/job-1')
    const someDrafts = aiJobNotice(
      source({
        sitePublish: {
          published,
          drafts: [{ id: 'about', label: 'About', reason: 'Its address is already used by another page.' }],
        },
      }),
      'done',
    )
    expect(someDrafts.body).toBe('Your pages are published, except one that stayed a draft. Open it to see why.')
  })

  /** The 2026-10-07 production guided start: Home failed on our side and was given back; Contact was built and put live. */
  const item = (slot: string, op: string, label: string, status: string, extra: Record<string, unknown> = {}) =>
    ({ slot, op, label, status, attempt: 1, creditsSpent: 0, creditsRefunded: 0, outputs: [], ...extra }) as never
  const PARTIAL = [
    item('l', 'layout', 'Main Layout', 'succeeded'),
    item('f', 'form', 'Contact Request Form', 'succeeded'),
    item('p0', 'page', 'Home', 'failed', { creditsSpent: 99, creditsRefunded: 99, failure: { ours: true, reason: 'doctrine-refused', message: 'x' } }),
    item('p1', 'page', 'Contact', 'succeeded'),
  ]
  const BUILT_ONE = 'Built 1 of 2 pages. Home couldn’t be built — that one’s on us, you weren’t charged for it. The 99 credits it used are back in your AI credits. Try again builds only what failed.'

  it('says what a partly built live site could not build, as a warning (AGL-3596)', () => {
    const published = [{ id: 'contact', label: 'Contact', path: '/contact' }]
    const notice = aiJobNotice(source({ items: PARTIAL, sitePublish: { published, drafts: [] } }), 'done')
    expect(notice.type).toBe('content.aiJobDone')
    expect(notificationLevel(notice)).toBe('warning')
    expect(notice.title).toBe('Your site is live, but part of it wasn’t built')
    expect(notice.body).toBe(`${BUILT_ONE} What was built is published.`)
    const withDraft = aiJobNotice(
      source({ items: PARTIAL, sitePublish: { published, drafts: [{ id: 'about', label: 'About', reason: 'Taken.' }] } }),
      'done',
    )
    expect(withDraft.body).toBe(`${BUILT_ONE} What was built is published, except one that stayed a draft.`)
    // Every item built: the good news, as it was.
    const whole = aiJobNotice(source({ items: PARTIAL.map((one) => ({ ...(one as object), status: 'succeeded' }) as never), sitePublish: { published, drafts: [] } }), 'done')
    expect(notificationLevel(whole)).toBe('success')
    expect(whole.title).toBe('Your site is live')
  })

  it('says what a partly built draft site and a partly built build could not build (AGL-3596)', () => {
    const drafts = aiJobNotice(source({ items: PARTIAL, sitePublish: { published: [], drafts: [] } }), 'done')
    expect(notificationLevel(drafts)).toBe('warning')
    expect(drafts.body).toBe(`${BUILT_ONE} Everything it built is an unpublished draft until you publish it.`)
    const build = aiJobNotice(source({ kind: 'build', items: PARTIAL }), 'done')
    expect(notificationLevel(build)).toBe('warning')
    expect(build.body).toBe('3 of 4 built; 1 failed. Everything it built is an unpublished draft until you publish it.')
  })

  it('keeps the drafts wording when nothing was published', () => {
    const notice = aiJobNotice(source({ outputs: [screen('home')], sitePublish: { published: [], drafts: [] } }), 'done')
    expect(notice.title).toBe('Your site’s draft pages are ready')
  })

  it('opens the one draft it built in the editor, on the version it wrote', () => {
    const notice = aiJobNotice(source({ kind: 'page', outputs: [screen('pricing')] }), 'done')
    expect(notice.title).toBe('Your draft page is ready')
    expect(normalizeNotificationLink(notice.link, context)).toBe(
      '/acme/hosts/roofers/screens/pricing/versions/pricing-v1/besigner',
    )
  })

  it('opens AI jobs on a job with nothing of its own to open', () => {
    const notice = aiJobNotice(source({ kind: 'insight', hostId: null }), 'done')
    expect(normalizeNotificationLink(notice.link, { orgSlug: 'acme' })).toBe('/acme?aiJob=job-1')
    expect(notice.hostId).toBeUndefined()
  })
})

describe('a job that stopped', () => {
  it('says so in the job’s own customer-safe sentence', () => {
    const notice = aiJobNotice(source({ error: 'The site could not be planned.' }), 'failed')
    expect(notice.type).toBe('content.aiJobFailed')
    expect(notice.title).toBe('Your site job stopped')
    expect(notice.body).toBe('The site could not be planned.')
    expect(normalizeNotificationLink(notice.link, context)).toBe('/acme/hosts/roofers/ai-jobs/job-1')
  })

  it('tells the person a failure on our side cost them nothing, with the credits the job recorded giving back (AGL-3596)', () => {
    const failed = aiJobNotice(
      source({ error: 'Something went wrong building your site, and it was not built.', creditsSpent: 102, refundedCredits: 102 }),
      'failed',
    )
    expect(failed.body).toBe(
      'Something went wrong building your site, and it was not built. This one’s on us — you weren’t charged. The 102 credits it used are back in your AI credits.',
    )
    const parked = aiJobNotice(
      source({ review: { reason: 'doctrine', message: 'It could not be built within the building rules.' }, creditsSpent: 6, refundedCredits: 6 }),
      'needs-review',
    )
    expect(parked.body).toContain('This one’s on us — you weren’t charged. The 6 credits it used are back in your AI credits.')
    // Nothing given back, nothing promised.
    expect(aiJobNotice(source({ error: 'It stopped.', creditsSpent: 6 }), 'failed').body).toBe('It stopped.')
  })
})

describe('a building rule never reaches the notification (AGL-3596)', () => {
  const RULE = "This could not be built within the building rules. Rule 16 (Third-party players are named in the plan): The page embeds a player the plan does not list."

  it('says the plain refusal for a job parked on a rule, and for one that stopped on one', () => {
    const parked = aiJobNotice(source({ kind: 'page', review: { reason: 'doctrine', message: RULE }, error: RULE }), 'needs-review')
    expect(parked.body).toBe("Aglyn AI couldn’t lay this page out cleanly, so we stopped rather than publish a broken page.")
    const stopped = aiJobNotice(source({ kind: 'form', error: RULE }), 'failed')
    expect(stopped.body).toBe("Aglyn AI couldn’t build this cleanly, so we stopped rather than give you something broken.")
  })
})
