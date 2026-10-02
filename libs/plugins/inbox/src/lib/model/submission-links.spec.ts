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
 * An open submission links to the form, the page and the person it filed
 * (AGL-3461) — each through the plugin that owns it, and as plain text where
 * none answers.
 */

import { submissionFiledUnder, submissionLinks } from './submission-links'

const hrefOf = (kind: string, id: string) => `/acme/hosts/site/${kind}/${id}`

describe('submissionLinks', () => {
  it('links the form, the page and the lead, in that order', () => {
    const links = submissionLinks({
      submission: {
        formId: 'form_1',
        formName: 'Next client site',
        path: '/next-client-site',
        capturedRecord: { kind: 'lead', id: 'lead_1' },
      },
      hrefOf,
      siteOrigin: 'https://aglyn.com',
    })

    expect(links).toEqual([
      { key: 'form', label: 'Form', text: 'Next client site', href: '/acme/hosts/site/form/form_1' },
      {
        key: 'page',
        label: 'Page',
        text: '/next-client-site',
        href: 'https://aglyn.com/next-client-site',
        external: true,
      },
      { key: 'record', label: 'Lead', text: 'Open the lead', href: '/acme/hosts/site/lead/lead_1' },
    ])
  })

  it('names a contact as a contact', () => {
    const [record] = submissionLinks({
      submission: { capturedRecord: { kind: 'contact', id: 'c_1' } },
      hrefOf,
      siteOrigin: null,
    })
    expect(record).toMatchObject({ label: 'Contact', href: '/acme/hosts/site/contact/c_1' })
  })

  it('draws text where no owner answers, and never joins a foreign path', () => {
    const links = submissionLinks({
      submission: { formName: 'Popup', path: '//evil.example/x' },
      hrefOf: () => null,
      siteOrigin: 'https://aglyn.com',
    })
    expect(links.map((link) => link.href)).toEqual([null, null])
  })

  it('leaves out what the row does not carry', () => {
    expect(submissionLinks({ submission: {}, hrefOf, siteOrigin: null })).toEqual([])
  })
})

describe('submissionFiledUnder', () => {
  it('is the form’s campaigns then the page’s, deduped', () => {
    expect(
      submissionFiledUnder({ campaignIds: ['a', 'b'], pageCampaignIds: ['b', 'c'] }),
    ).toEqual(['a', 'b', 'c'])
    expect(submissionFiledUnder(null)).toEqual([])
  })
})
