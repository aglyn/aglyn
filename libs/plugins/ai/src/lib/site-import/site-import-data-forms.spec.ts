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
 * A form whose fields live in data, not in the page's markup (AGL-4152): the
 * shapes it comes in, what only looks like one, and what is never run.
 */

import { extractSiteImportPage } from './site-import-html'
import { siteImportLayout, siteImportLayoutCounts } from './site-import-layout'
import type { SiteImportFrameSource } from './site-import-nav'
import { SITE_READ_JSON_FORM_URL, SITE_READ_ORIGIN, siteReadPage } from './fixtures/site-layout-recordings'

const sameSite = (url: URL) => url.origin === SITE_READ_ORIGIN

describe('a form defined in data', () => {
  const page = (body: string, head = '') => extractSiteImportPage(`<html><head>${head}</head><body>${body}</body></html>`, 'https://example.com/contact', (url) => url.origin === 'https://example.com', { structure: true })

  it('reads a script block’s fields, past the arrays that only look like fields, and places it', () => {
    const read = extractSiteImportPage(siteReadPage('json-form.html'), SITE_READ_JSON_FORM_URL, sameSite, { structure: true })
    expect(read.forms.kept).toEqual([
      {
        fields: [
          { type: 'text', name: 'your-name', label: 'Your name', required: true },
          { type: 'email', name: 'email', label: 'Email', required: true, placeholder: 'you@example.com' },
          { type: 'tel', name: 'phone', label: 'Phone' },
          { type: 'select', name: 'how-can-we-help', label: 'How can we help?', options: ['Monthly books', 'Year-end help'] },
          { type: 'textarea', name: 'message', label: 'Message', required: true },
        ],
        submit: 'Send it',
        leftOut: ['Attach a statement'],
      },
    ])
    const layout = siteImportLayout(read as SiteImportFrameSource, [])
    expect(siteImportLayoutCounts(layout as NonNullable<typeof layout>, read.blocks).forms).toBe(1)
    // The words beside it stay, and no line of the data becomes one.
    const words = read.blocks.map((block) => (block.kind === 'image' ? '' : block.text)).join(' ')
    expect(words).toContain('Say hello')
    expect(words).not.toMatch(/Address Line|formFields|Monthly books/)
    // Nothing a page wrote ran.
    expect(read.title).toBe('Contact Harbor Lane Bookkeeping')
  })

  it('reads a second shape: `label` and `isRequired`-free fields in a `data-*` attribute, with `{label, value}` choices', () => {
    const fields = JSON.stringify([
      { type: 'text', label: 'Company', required: false, name: 'company' },
      { type: 'tel', label: 'Best number', required: 'true' },
      { type: 'radio', label: 'Preferred time', required: 0, choices: [{ label: 'Mornings', value: 'am' }, { label: 'Afternoons', value: 'pm' }] },
      { type: 'hidden', name: 'campaign' },
      { type: 'submit', label: 'Request a quote' },
    ]).replace(/"/g, '&quot;')
    const read = page(`<h1>Get a quote</h1><section class="quote-form" data-schema="${fields}"><p>We answer the same day.</p></section>`)
    expect(read.forms.kept).toEqual([
      {
        fields: [
          { type: 'text', name: 'company', label: 'Company' },
          { type: 'tel', name: 'best-number', label: 'Best number', required: true },
          { type: 'radio', name: 'preferred-time', label: 'Preferred time', options: ['Mornings', 'Afternoons'] },
        ],
        submit: 'Request a quote',
      },
    ])
  })

  it('reads a third shape: inline JavaScript that is no JSON, without running a line of it', () => {
    const script = `<script>
      (function () { launchMissiles(); })();
      window.ContactWidget.mount("#widget", {
        // written by hand: bare keys, single quotes, a trailing comma
        fields: [
          { type: 'email', title: 'Work email', required: true, },
          { type: 'multiline', title: 'What do you need?', required: false },
        ],
        submitLabel: 'Ask us',
      });
    </script>`
    const read = page(`<h1>Talk to us</h1><div id="widget" class="contactForm"></div>${script}`)
    expect(read.forms.kept).toEqual([
      {
        fields: [
          { type: 'email', name: 'work-email', label: 'Work email', required: true },
          { type: 'textarea', name: 'what-do-you-need', label: 'What do you need?' },
        ],
        submit: 'Ask us',
      },
    ])
    expect(read.structure?.elements.some((element) => element.form === 0)).toBe(true)
  })

  it('finds the form’s place when its data sits apart, in the page’s head', () => {
    const read = page('<h1>Write to us</h1><div class="contact-form"></div>', '<script type="application/json">{"fields":[{"type":"email","label":"Email","required":true}]}</script>')
    expect(read.forms.kept).toHaveLength(1)
    const marker = read.structure?.elements.find((entry) => entry.form === 0)
    expect(read.structure?.elements[marker?.parent as number]?.attrs.class).toBe('contact-form')
  })

  it('reads nothing with no element that says it is a form to attach to', () => {
    const read = page('<h1>Hi</h1><div class="hero"></div>', '<script type="application/json">{"fields":[{"type":"email","label":"Email","required":true}]}</script>')
    expect(read.forms.kept).toEqual([])
  })

  it('takes no word that only contains “form” for a hint', () => {
    const data = '<script type="application/json">{"fields":[{"type":"email","label":"Email","required":true}]}</script>'
    expect(page(`<div class="transform platform information uniform"></div>${data}`).forms.kept).toEqual([])
    expect(page(`<div class="search-form"></div>${data}`).forms.kept).toEqual([])
  })

  it('needs the three keys: a menu of links and a list of blocks are no form', () => {
    const near = '<div class="form-block"></div>'
    const blocks = '<script type="application/json">[{"type":"text","title":"About us"},{"type":"image","title":"Boats"}]</script>'
    const menu = '<script>var nav = [{type:"link",label:"Home",required:false}];</script>'
    const formats = '<script type="application/json">{"fields":[{"type":"FIELD","label":"City","required":true}]}</script>'
    expect(page(`${near}${blocks}${menu}${formats}`).forms.kept).toEqual([])
  })

  it('leaves a page with a form of its own as that form, and one search box does not count', () => {
    const data = '<script type="application/json">{"fields":[{"type":"email","label":"Email","required":true}]}</script>'
    const real = page(`<div class="contact-form"><form><label for="m">Message</label><textarea id="m" name="m"></textarea></form></div>${data}`)
    expect(real.forms.kept).toHaveLength(1)
    expect(real.forms.kept[0]?.fields[0]?.name).toBe('m')
    const search = page(`<form role="search" class="site-search"><input type="search" name="q"></form><div class="contact-form"></div>${data}`)
    // The data's own form comes first; the search box still reads as the form it always did.
    expect(search.forms.kept.map((form) => form.fields[0]?.name)).toEqual(['email', 'q'])
  })

  it('takes one form once, however many places hold its data', () => {
    const fields = '[{"type":"email","label":"Email","required":true}]'
    const read = page(`<div class="contact-form" data-fields='${fields}'></div><script type="application/json">{"fields":${fields}}</script>`)
    expect(read.forms.kept).toHaveLength(1)
  })

  it('never keeps a form that asks for a password or a card', () => {
    const read = page('<div class="pay-form"></div><script type="application/json">{"fields":[{"type":"text","label":"Card number","name":"cc-number","required":true}]}</script><div class="login-form"></div><script type="application/json">{"fields":[{"type":"password","label":"Password","required":true}]}</script>')
    expect(read.forms.kept).toEqual([])
    expect(read.forms.removed).toBe(2)
  })

  it('never reads structured data as a form', () => {
    const read = page('<div class="contact-form"></div><script type="application/ld+json">{"fields":[{"type":"email","label":"Email","required":true}]}</script>')
    expect(read.forms.kept).toEqual([])
  })

  it('gives up on a broken or huge block rather than on the page', () => {
    const broken = '<script>var form = {fields: [{type: "email", label: "Email", required: tru</script>'
    const huge = `<script>var x = [${'{"type":"x"},'.repeat(200_000)}];</script>`
    const read = page(`<h1>Still here</h1><div class="contact-form"></div>${broken}${huge}`)
    expect(read.forms.kept).toEqual([])
    expect(read.blocks.some((block) => block.kind === 'heading' && block.text === 'Still here')).toBe(true)
  })
})
