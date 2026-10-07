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
})
