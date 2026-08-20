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

// AGL-1692 — the detector behind the dependency-egress sweep.
//
// The sweep that produced "No other vendor that touches customer data was
// found" read OUR SOURCE. `gravatar` (AGL-1683) shipped an MD5 of every
// console member's email to Automattic from inside a dependency, and our
// source contained only `gravatarUrlFromEmail(email)`. The 2026-08-14
// re-sweep fixed that half by walking the closure for HOST LITERALS.
//
// This test covers the half BOTH sweeps missed. A host literal only finds a
// package that picks its own host. `undici` picks none — it is the transport
// our own code hands a host to (AGL-2480 promoted it out of devDependencies
// precisely because a production network path was renting it). A method that
// cannot see a transport cannot tell you where the next egress will appear.
//
// So the detector answers TWO questions per package, and the difference
// between them is the whole point:
//
//   VENDOR-CHOSEN host — a third-party host the package itself supplies, in
//   shipped code. Annex III candidate: a real recipient. NOT conditioned on a
//   co-located egress primitive, because `gravatar` performs no IO at all —
//   see the founding-case test below, which is what caught that rule.
//   CALLER-CHOSEN host — an egress primitive and no host of its own. NOT a
//   subprocessor; it is a production network path, and the place a future
//   recipient arrives without anybody editing the register.
//
//   node --test tools/scripts/lib/dependency-egress.test.mjs
//   npm run test:dependency-egress

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  classifyPackageEgress,
  compareToRegister,
  detectEgressPrimitives,
  extractEgressHosts,
  isSweptFile,
} from './dependency-egress.mjs'

describe('extractEgressHosts', () => {
  it('finds the host of an http(s) literal', () => {
    const hosts = extractEgressHosts(
      "const url = 'https://secure.gravatar.com/avatar/' + hash",
    )
    assert.deepEqual([...hosts], ['secure.gravatar.com'])
  })

  it('finds a host inside a template literal and a concatenation', () => {
    const hosts = extractEgressHosts(
      'fetch(`https://cdn.jsdelivr.net/npm/${pkg}`); ' +
        'x("http://firebaselogging.googleapis.com" + path)',
    )
    assert.deepEqual(
      [...hosts].sort(),
      ['cdn.jsdelivr.net', 'firebaselogging.googleapis.com'],
    )
  })

  it('drops the port, the credentials and the path', () => {
    const hosts = extractEgressHosts("'https://u:p@api.acme-vendor.io:8443/v1/x'")
    assert.deepEqual([...hosts], ['api.acme-vendor.io'])
  })

  it('drops spec, licence and documentation hosts', () => {
    // Every package on earth carries these IN CODE POSITION too (a licence
    // URL in a banner string, a spec URL in a thrown message). The denylist
    // is what keeps them out; the comment strip below is a separate cut.
    const hosts = extractEgressHosts(
      "x('http://www.apache.org/licenses/LICENSE-2.0');" +
        "x('https://www.w3.org/TR/html5/');" +
        "x('https://github.com/nodejs/undici');" +
        "x('https://tools.ietf.org/html/rfc7231');" +
        "x('https://opensource.org/licenses/MIT');" +
        "x('https://registry.npmjs.org/foo')",
    )
    assert.deepEqual([...hosts], [])
  })

  it('drops a host that appears only in a COMMENT', () => {
    // The discriminator that makes the run readable. Without it the sweep
    // reports 1,028 hosts — every `@see` in every package — which is the
    // unreadable output that stopped the last sweep being repeated.
    const hosts = extractEgressHosts(
      '// see https://firebase.google.com/docs/auth for the flow\n' +
        '/* and https://react.dev/reference/react */\n' +
        "const endpoint = 'https://identitytoolkit.googleapis.com/v1'",
    )
    assert.deepEqual([...hosts], ['identitytoolkit.googleapis.com'])
  })

  it('does not treat the // inside a URL string as a line comment', () => {
    // The founding case is `var base = 'https://secure.gravatar.com/avatar/'`.
    // A naive comment strip eats it at the `//` and the sweep reports
    // nothing — passing, silently, for the one package it exists to find.
    const hosts = extractEgressHosts(
      "var base = 'https://secure.gravatar.com/avatar/';\nvar x = 1",
    )
    assert.deepEqual([...hosts], ['secure.gravatar.com'])
  })

  it('keeps a host in an html attribute and a css url()', () => {
    // Neither is a JS string; both egress.
    assert.deepEqual(
      [...extractEgressHosts('<img src="https://pixel.vendor.io/p.gif">')],
      ['pixel.vendor.io'],
    )
    assert.deepEqual(
      [...extractEgressHosts('@font-face{src:url(https://fonts.gstatic.com/f.woff2)}')],
      ['fonts.gstatic.com'],
    )
  })

  it('drops a host inside an html comment', () => {
    assert.deepEqual(
      [...extractEgressHosts('<!-- https://old.vendor.io/x --><p>hi</p>')],
      [],
    )
  })

  it('survives an apostrophe in a comment without swallowing the file', () => {
    // `// don't do this` opens a quote that never closes; a scanner that
    // stays in string state from there reports nothing for the rest of the
    // file — a silent false negative, the worst failure this can have.
    const hosts = extractEgressHosts(
      "// don't do this\nconst u = 'https://collect.vendor.io/e'",
    )
    assert.deepEqual([...hosts], ['collect.vendor.io'])
  })

  it('keeps a localhost or example host out without keeping a real one out', () => {
    const hosts = extractEgressHosts(
      "'http://localhost:3000' 'https://example.com' 'https://api.stripe.com'",
    )
    assert.deepEqual([...hosts], ['api.stripe.com'])
  })

  it('is not fooled by a bare scheme with no host', () => {
    assert.deepEqual([...extractEgressHosts("'https://'")], [])
  })
})

describe('detectEgressPrimitives', () => {
  it('sees a fetch, an XHR and a sendBeacon', () => {
    assert.deepEqual(
      detectEgressPrimitives(
        'fetch(u); new XMLHttpRequest(); navigator.sendBeacon(u, b)',
      ).sort(),
      ['fetch', 'sendBeacon', 'xhr'],
    )
  })

  it('sees the tag-injection primitives a host literal never shows', () => {
    assert.deepEqual(
      detectEgressPrimitives(
        "document.createElement('script'); document.createElement(\"link\"); " +
          'new Image(); @font-face { src: url(x) } importScripts(u)',
      ).sort(),
      ['fontFace', 'imageElement', 'importScripts', 'linkElement', 'scriptElement'],
    )
  })

  it('sees the node transports — the class the host sweep is blind to', () => {
    assert.deepEqual(
      detectEgressPrimitives(
        "const net = require('node:net'); net.connect(opts); " +
          "tls.connect(o); http.request(o); new WebSocket(u)",
      ).sort(),
      ['httpRequest', 'netConnect', 'tlsConnect', 'webSocket'],
    )
  })

  it('reports nothing for a file that only does string work', () => {
    assert.deepEqual(detectEgressPrimitives('export const a = b.split(",")'), [])
  })
})

describe('isSweptFile', () => {
  it('sweeps shipped javascript, css and html', () => {
    assert.equal(isSweptFile('lib/index.js'), true)
    assert.equal(isSweptFile('dist/esm/client.mjs'), true)
    assert.equal(isSweptFile('styles/main.css'), true)
  })

  it('skips types, sourcemaps and changelogs — no code runs from them', () => {
    assert.equal(isSweptFile('types/index.d.ts'), false)
    assert.equal(isSweptFile('dist/index.js.map'), false)
    assert.equal(isSweptFile('CHANGELOG.md'), false)
  })

  it('skips a package demo, example and test tree', () => {
    // The 2026-08-14 sweep killed cdnjs/unpkg leads here one at a time;
    // the exclusion belongs in the detector, not in a person's judgement.
    assert.equal(isSweptFile('demo/index.html'), false)
    assert.equal(isSweptFile('examples/basic/app.js'), false)
    assert.equal(isSweptFile('test/fixtures/server.js'), false)
    assert.equal(isSweptFile('__tests__/client.js'), false)
  })

  it('skips package.json — author, funding and homepage are not egress', () => {
    // Measured: `substack.net`, `ko-fi.com`, `asana.com` and a dozen more
    // reached the findings purely as `author`/`funding`/`homepage` metadata.
    // A manifest is not code and nothing fetches from it.
    assert.equal(isSweptFile('package.json'), false)
    assert.equal(isSweptFile('dist/compiled/text-table/package.json'), false)
    // Other shipped json still counts — config and locale data can carry a
    // real endpoint.
    assert.equal(isSweptFile('dist/config.json'), true)
  })

  it('skips a bench fixture', () => {
    // `html-tokenize/bench/input.html` is a scraped page carrying
    // `www.telize.com` — a geolocation API, exactly the shape the issue
    // says to look hardest for, and a pure false positive.
    assert.equal(isSweptFile('bench/input.html'), false)
  })

  it('does not mistake a shipped path that merely CONTAINS the word', () => {
    // `src/attestation/...` contains "test"; `lib/demoted.js` contains "demo".
    assert.equal(isSweptFile('src/attestation/verify.js'), true)
    assert.equal(isSweptFile('lib/demoted.js'), true)
  })
})

describe('classifyPackageEgress', () => {
  it('calls a package with its own host VENDOR-CHOSEN even with no primitive', () => {
    // THE FOUNDING CASE (AGL-1683). `gravatar` performs no IO at all: it
    // returns a string and OUR `<img>` makes the request. A detector that
    // demands a co-located egress primitive calls this inert, which is the
    // exact miss the whole issue is about.
    const found = classifyPackageEgress({
      name: 'gravatar',
      files: [
        {
          path: 'lib/gravatar.js',
          source:
            "var base = 'https://secure.gravatar.com/avatar/';\n" +
            'function url(email) { return base + md5(email) }',
        },
      ],
    })
    assert.equal(found.class, 'vendor-host')
    assert.deepEqual(found.hosts, ['secure.gravatar.com'])
    assert.deepEqual(found.primitives, [])
    // `direct: false` is the reader's signal that the package hands the URL
    // out rather than fetching it — where to go looking on our side.
    assert.equal(found.evidence[0].direct, false)
  })

  it('marks a package that fetches its own host direct', () => {
    const found = classifyPackageEgress({
      name: 'selfcaller',
      files: [
        { path: 'lib/i.js', source: "fetch('https://api.acme-vendor.io/v1')" },
      ],
    })
    assert.equal(found.class, 'vendor-host')
    assert.equal(found.evidence[0].direct, true)
  })

  it('calls a transport with no host of its own CALLER-CHOSEN', () => {
    // undici's shape, and the reason this file exists.
    const found = classifyPackageEgress({
      name: 'undici',
      files: [
        {
          path: 'lib/core/connect.js',
          source:
            "const net = require('node:net')\n" +
            'function connect (opts) { return net.connect(opts) }',
        },
      ],
    })
    assert.equal(found.class, 'caller-host')
    assert.deepEqual(found.hosts, [])
    assert.deepEqual(found.primitives, ['netConnect'])
  })

  it('does not need the host and the primitive in the same file', () => {
    // Deliberately NOT co-located. A host literal anywhere in shipped code
    // is a destination somebody chose; which file does the IO is evidence,
    // not the test. The false-positive pressure is carried by the demo/test
    // exclusion and the documentation denylist instead.
    const found = classifyPackageEgress({
      name: 'split-brain',
      files: [
        { path: 'lib/url.js', source: "const u = 'https://cdn.jsdelivr.net/npm/x'" },
        { path: 'lib/io.js', source: 'net.connect(opts)' },
      ],
    })
    assert.equal(found.class, 'vendor-host')
    assert.deepEqual(found.hosts, ['cdn.jsdelivr.net'])
    assert.deepEqual(found.primitives, ['netConnect'])
  })

  it('calls a package with neither INERT', () => {
    const found = classifyPackageEgress({
      name: 'lodash',
      files: [{ path: 'index.js', source: 'module.exports = { map: f }' }],
    })
    assert.equal(found.class, 'inert')
  })

  it('reports the evidence file, not just the verdict', () => {
    // A finding a person cannot go and read is a finding they have to
    // re-derive. The 2026-08-14 pass had to open vendor source by hand.
    const found = classifyPackageEgress({
      name: 'beaconer',
      files: [
        { path: 'a.js', source: 'const x = 1' },
        {
          path: 'dist/b.js',
          source: "navigator.sendBeacon('https://collect.vendor.io/e', d)",
        },
      ],
    })
    assert.deepEqual(found.evidence, [
      {
        path: 'dist/b.js',
        hosts: ['collect.vendor.io'],
        primitives: ['sendBeacon'],
        direct: true,
      },
    ])
  })

  it('ignores a demo file when deciding the class', () => {
    const found = classifyPackageEgress({
      name: 'cytoscape-fcose',
      files: [
        {
          path: 'demo/demo.html',
          source: "<script src='https://cdnjs.cloudflare.com/x.js'></script>",
        },
        { path: 'src/index.js', source: 'module.exports = layout' },
      ],
    })
    assert.equal(found.class, 'inert')
    assert.deepEqual(found.hosts, [])
  })
})

describe('compareToRegister', () => {
  const register = {
    'secure.gravatar.com': { decision: 'removed', issue: 'AGL-1683' },
    'cdn.jsdelivr.net': { decision: 'disclosed', issue: 'AGL-1779' },
    undici: { decision: 'transport', issue: 'AGL-2480' },
  }

  it('passes when every finding already carries a decision', () => {
    const result = compareToRegister(
      [
        { name: 'undici', class: 'caller-host', hosts: [] },
        {
          name: 'monaco-editor',
          class: 'vendor-host',
          hosts: ['cdn.jsdelivr.net'],
        },
        { name: 'gravatar', class: 'vendor-host', hosts: ['secure.gravatar.com'] },
      ],
      register,
    )
    assert.deepEqual(result.undecided, [])
    assert.deepEqual(result.stale, [])
    assert.equal(result.ok, true)
  })

  it('FAILS on a vendor host nobody has decided about', () => {
    // The whole control. A new dependency that phones a new host has to
    // stop a build, not wait for a person to run a sweep.
    const result = compareToRegister(
      [{ name: 'newpkg', class: 'vendor-host', hosts: ['telemetry.newpkg.io'] }],
      register,
    )
    assert.equal(result.ok, false)
    assert.deepEqual(result.undecided, [
      { key: 'telemetry.newpkg.io', package: 'newpkg', class: 'vendor-host' },
    ])
  })

  it('FAILS on a new transport too, keyed by package name', () => {
    // A transport is not an Annex III row, but a new production network
    // path is still a thing somebody has to have looked at.
    const result = compareToRegister(
      [{ name: 'got', class: 'caller-host', hosts: [] }],
      register,
    )
    assert.equal(result.ok, false)
    assert.deepEqual(result.undecided, [
      { key: 'got', package: 'got', class: 'caller-host' },
    ])
  })

  it('reports a register row whose package is gone as STALE', () => {
    // A register that only grows is a register that lies. `gravatar` left
    // the tree; a row claiming a live recipient is a false representation.
    const result = compareToRegister(
      [{ name: 'undici', class: 'caller-host', hosts: [] }],
      register,
    )
    assert.deepEqual(result.stale.sort(), [
      'cdn.jsdelivr.net',
      'secure.gravatar.com',
    ])
  })

  it('does not let an inert package satisfy a register row', () => {
    const result = compareToRegister(
      [{ name: 'lodash', class: 'inert', hosts: [] }],
      { lodash: { decision: 'transport', issue: 'AGL-0000' } },
    )
    assert.deepEqual(result.stale, ['lodash'])
  })
})
