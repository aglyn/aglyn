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

import { deflateRawSync } from 'zlib'

import {
  escapeXmlText,
  parseXml,
  readOoxml,
  scanXml,
  writeOoxml,
  xmlTextContent,
} from './ooxml'
import { EmbeddedWriteError, type EmbeddedCandidate } from './types'
import {
  crc32,
  findZipEntry,
  readZip,
  readZipEntry,
  type ZipArchive,
} from './zip'

const encode = (text: string) => new TextEncoder().encode(text)
const NOW = new Date(Date.UTC(2026, 8, 24, 15, 30, 45, 123))

// ---------------------------------------------------------------------------
// Fixtures, built by hand
// ---------------------------------------------------------------------------

interface Part {
  name: string
  content: string | Uint8Array
  stored?: boolean
  descriptor?: boolean
}

/** A ZIP written without the module's own writer. */
function zip(parts: Part[]): Uint8Array {
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let position = 0
  const push = (bytes: Uint8Array) => {
    chunks.push(bytes)
    position += bytes.length
  }
  for (const part of parts) {
    const content =
      typeof part.content === 'string' ? encode(part.content) : part.content
    const data = part.stored ? content : new Uint8Array(deflateRawSync(content))
    const name = encode(part.name)
    const crc = crc32(content)
    const flags = part.descriptor ? 0x0008 : 0
    const offset = position
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, flags, true)
    lv.setUint16(8, part.stored ? 0 : 8, true)
    lv.setUint16(12, 0x21, true)
    if (!part.descriptor) {
      lv.setUint32(14, crc, true)
      lv.setUint32(18, data.length, true)
      lv.setUint32(22, content.length, true)
    }
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    push(local)
    push(data)
    if (part.descriptor) {
      const descriptor = new Uint8Array(16)
      const dv = new DataView(descriptor.buffer)
      dv.setUint32(0, 0x08074b50, true)
      dv.setUint32(4, crc, true)
      dv.setUint32(8, data.length, true)
      dv.setUint32(12, content.length, true)
      push(descriptor)
    }
    const record = new Uint8Array(46 + name.length)
    const cv = new DataView(record.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, flags, true)
    cv.setUint16(10, part.stored ? 0 : 8, true)
    cv.setUint16(14, 0x21, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, content.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    record.set(name, 46)
    central.push(record)
  }
  const centralOffset = position
  for (const record of central) push(record)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, parts.length, true)
  ev.setUint16(10, parts.length, true)
  ev.setUint32(12, position - centralOffset, true)
  ev.setUint32(16, centralOffset, true)
  push(eocd)
  const out = new Uint8Array(position)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
const NS = {
  cp: 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties',
  dc: 'http://purl.org/dc/elements/1.1/',
  dcterms: 'http://purl.org/dc/terms/',
  dcmitype: 'http://purl.org/dc/dcmitype/',
  xsi: 'http://www.w3.org/2001/XMLSchema-instance',
  vt: 'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes',
}
const FMTID = '{D5CDD505-2E9C-101B-9397-08002B2CF9AE}'

const CONTENT_TYPES =
  DECL +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Default Extension="png" ContentType="image/png"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
  '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
  '<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>' +
  '</Types>'

const rels = (entries: Array<[string, string, string]>) =>
  DECL +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  entries
    .map(
      ([id, type, target]) =>
        `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`,
    )
    .join('') +
  '</Relationships>'

const REL = {
  core: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  app: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties',
  custom:
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties',
  document:
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
}

const ROOT_RELS = rels([
  ['rId3', REL.app, 'docProps/app.xml'],
  ['rId2', REL.core, 'docProps/core.xml'],
  ['rId1', REL.document, 'word/document.xml'],
  ['rId4', REL.custom, 'docProps/custom.xml'],
])

const CORE =
  DECL +
  `<cp:coreProperties xmlns:cp="${NS.cp}" xmlns:dc="${NS.dc}" xmlns:dcterms="${NS.dcterms}" xmlns:dcmitype="${NS.dcmitype}" xmlns:xsi="${NS.xsi}">` +
  '<dc:title>Quarterly &amp; Annual Report</dc:title>' +
  '<dc:subject>Finance</dc:subject>' +
  '<dc:creator>Ada Lovelace; Charles Babbage</dc:creator>' +
  '<cp:keywords>budget, forecast; q3</cp:keywords>' +
  '<dc:description>Numbers, mostly.</dc:description>' +
  '<cp:lastModifiedBy>Grace Hopper</cp:lastModifiedBy>' +
  '<cp:revision>4</cp:revision>' +
  '<dcterms:created xsi:type="dcterms:W3CDTF">2024-01-02T03:04:05Z</dcterms:created>' +
  '<dcterms:modified xsi:type="dcterms:W3CDTF">2024-02-03T04:05:06Z</dcterms:modified>' +
  '<cp:category>Reports</cp:category>' +
  '</cp:coreProperties>'

const APP =
  DECL +
  `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="${NS.vt}">` +
  '<Template>Normal.dotm</Template><TotalTime>3</TotalTime><Pages>7</Pages><Words>1200</Words>' +
  '<Application>Microsoft Office Word</Application><Company>Aglyn LLC</Company>' +
  '<AppVersion>16.0000</AppVersion></Properties>'

const property = (pid: number | string, name: string, value: string) =>
  `<property fmtid="${FMTID}" pid="${pid}" name="${name}">${value}</property>`

const CUSTOM =
  DECL +
  `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="${NS.vt}">` +
  property(2, 'Client', '<vt:lpwstr>Acme &lt;West&gt;</vt:lpwstr>') +
  property(3, 'Budget', '<vt:i4>42</vt:i4>') +
  property(4, 'Approved', '<vt:bool>1</vt:bool>') +
  property(5, 'Due', '<vt:filetime>2024-05-06T07:08:09Z</vt:filetime>') +
  property(6, 'Owner', '<vt:lpstr>Zed</vt:lpstr>') +
  property(7, 'Region|Code', '<vt:lpwstr>EU|1</vt:lpwstr>') +
  property(
    8,
    'Tags',
    '<vt:vector size="1" baseType="lpwstr"><vt:lpwstr>a</vt:lpwstr></vt:vector>',
  ) +
  '</Properties>'

const DOCUMENT =
  DECL +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>' +
  'Hello, world. '.repeat(400) +
  '</w:t></w:r></w:p></w:body></w:document>'
const IMAGE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5,
])

function docx(
  overrides: Partial<Record<string, string | null>> = {},
  extra: Part[] = [],
): Uint8Array {
  const base: Part[] = [
    { name: '[Content_Types].xml', content: CONTENT_TYPES },
    { name: '_rels/.rels', content: ROOT_RELS },
    { name: 'word/document.xml', content: DOCUMENT, descriptor: true },
    { name: 'word/media/image1.png', content: IMAGE, stored: true },
    { name: 'docProps/core.xml', content: CORE },
    { name: 'docProps/app.xml', content: APP },
    { name: 'docProps/custom.xml', content: CUSTOM },
  ]
  const parts = base
    .map((part) =>
      part.name in overrides
        ? { ...part, content: overrides[part.name] ?? '' }
        : part,
    )
    .filter((part) => overrides[part.name] !== null)
  return zip([...parts, ...extra])
}

const byKey = (candidates: EmbeddedCandidate[]) =>
  Object.fromEntries(candidates.map((candidate) => [candidate.key, candidate]))

const values = (bytes: Uint8Array) => {
  const read = readOoxml(bytes)
  if (!read) throw new Error('not read')
  return Object.fromEntries(
    read.candidates.map((candidate) => [candidate.key, candidate.value]),
  )
}

function partText(bytes: Uint8Array, name: string): string | null {
  const archive = readZip(bytes)
  const entry = archive && findZipEntry(archive, name)
  const content = archive && entry ? readZipEntry(archive, entry) : null
  return content ? new TextDecoder().decode(content) : null
}

/** An entry's local record — header, data and descriptor — as it sits in the file. */
function record(archive: ZipArchive, name: string): Buffer {
  const ordered = [...archive.entries].sort(
    (a, b) => a.localHeaderOffset - b.localHeaderOffset,
  )
  const index = ordered.findIndex((entry) => entry.name === name)
  const entry = ordered[index]
  if (!entry) throw new Error(`no ${name}`)
  const end =
    ordered[index + 1]?.localHeaderOffset ?? archive.centralDirectoryOffset
  return Buffer.from(archive.bytes.subarray(entry.localHeaderOffset, end))
}

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

describe('parseXml', () => {
  it('resolves namespaces, decodes entities and records offsets', () => {
    const source =
      '<?xml version="1.0"?><!-- c --><a:root xmlns:a="urn:a" xmlns="urn:d" b:x="1" xmlns:b="urn:b">' +
      '<child k="&quot;&#65;&#x42;&amp;">t&lt;1&gt;<![CDATA[<raw>&amp;]]></child><empty/></a:root>'
    const root = parseXml(source)
    if (!root) throw new Error('refused')
    expect([root.ns, root.local, root.prefix]).toEqual(['urn:a', 'root', 'a'])
    expect(
      root.attributes.find((attribute) => attribute.local === 'x')?.ns,
    ).toBe('urn:b')
    const [child, empty] = root.children
    expect(child?.ns).toBe('urn:d')
    expect(child?.attributes[0]?.value).toBe('"AB&')
    expect(child && xmlTextContent(child)).toBe('t<1><raw>&amp;')
    expect(empty?.selfClosing).toBe(true)
    expect(child && source.slice(child.start, child.end)).toMatch(
      /^<child .*<\/child>$/,
    )
    expect(empty && source.slice(empty.start, empty.end)).toBe('<empty/>')
  })

  it('leaves unknown entities and invalid character references as written', () => {
    const root = parseXml('<r>&nbsp; &#0; &bogus &amp;</r>')
    expect(root && xmlTextContent(root)).toBe('&nbsp; &#0; &bogus &')
  })

  it('refuses a DOCTYPE outright, and any entity declaration', () => {
    expect(parseXml('<!DOCTYPE r><r/>')).toBeNull()
    expect(parseXml('<!DOCTYPE r [<!ENTITY a "b">]><r>&a;</r>')).toBeNull()
    expect(parseXml('<r/><!ENTITY a "b">')).toBeNull()
    expect(
      parseXml('<!DOCTYPE r SYSTEM "r.dtd"><r/>', {
        allowExternalDoctype: true,
      }),
    ).not.toBeNull()
    expect(
      parseXml('<!DOCTYPE r SYSTEM "r.dtd" [<!ENTITY a "b">]><r/>', {
        allowExternalDoctype: true,
      }),
    ).toBeNull()
  })

  it('refuses what is not well-formed', () => {
    for (const bad of [
      '',
      'text',
      '<a>',
      '<a></b>',
      '<a/><b/>',
      '<a x="1" x="2"/>',
      '<p:a/>',
      '<a p:x="1"/>',
      '<a x=1/>',
      '<a x="<"/>',
      '<a x="1"y="2"/>',
      'junk<a/>',
      '<a/>junk',
      '<a><!-- open</a>',
      '<a><![CDATA[open</a>',
    ]) {
      expect(parseXml(bad)).toBeNull()
    }
  })

  it('bounds depth and element count', () => {
    expect(parseXml('<a>'.repeat(300) + '</a>'.repeat(300))).toBeNull()
    expect(
      parseXml('<a>' + '<b/>'.repeat(20) + '</a>', { maxElements: 10 }),
    ).toBeNull()
  })

  it('reports a self-closing element as opened and closed', () => {
    const events: string[] = []
    scanXml('<a><b/></a>', {
      open: (tag) => events.push(`open ${tag.name}`),
      close: (tag) => events.push(`close ${tag.name}`),
    })
    expect(events).toEqual(['open a', 'open b', 'close b', 'close a'])
  })

  it('escapes text and drops what XML cannot carry', () => {
    expect(escapeXmlText('a & b < c > d \u0001\uffff')).toBe(
      'a &amp; b &lt; c &gt; d ',
    )
  })
})

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

describe('readOoxml', () => {
  it('reads core, extended and custom properties', () => {
    const read = readOoxml(docx())
    if (!read) throw new Error('not read')
    const fields = byKey(read.candidates)
    expect(fields['title']?.value).toBe('Quarterly & Annual Report')
    expect(fields['subject']?.value).toBe('Finance')
    expect(fields['creator']?.value).toEqual([
      'Ada Lovelace',
      'Charles Babbage',
    ])
    expect(fields['keywords']?.value).toEqual(['budget', 'forecast', 'q3'])
    expect(fields['description']?.value).toBe('Numbers, mostly.')
    expect(fields['category']?.value).toBe('Reports')
    expect(fields['lastModifiedBy']?.value).toBe('Grace Hopper')
    expect(fields['createdAt']?.value).toBe('2024-01-02T03:04:05Z')
    expect(fields['modifiedAt']?.value).toBe('2024-02-03T04:05:06Z')
    expect(fields['software']?.value).toBe('Microsoft Office Word')
    expect(fields['company']?.value).toBe('Aglyn LLC')
    expect(fields['pageCount']?.value).toBe('7')
    expect(
      read.candidates.every((candidate) => candidate.source === 'ooxml'),
    ).toBe(true)
  })

  it('reads custom properties as other keys, editable only when text', () => {
    const fields = byKey(readOoxml(docx())?.candidates ?? [])
    expect(fields['ooxml|Client']).toEqual({
      key: 'ooxml|Client',
      value: 'Acme <West>',
      source: 'ooxml',
      label: 'Client',
    })
    expect(fields['ooxml|Owner']?.editable).toBeUndefined()
    expect(fields['ooxml|Budget']).toMatchObject({
      value: '42',
      editable: false,
    })
    expect(fields['ooxml|Approved']).toMatchObject({
      value: 'true',
      editable: false,
    })
    expect(fields['ooxml|Due']).toMatchObject({
      value: '2024-05-06T07:08:09Z',
      editable: false,
    })
    expect(fields['ooxml|Region|Code']).toMatchObject({
      value: 'EU|1',
      label: 'Region|Code',
    })
    // A vector is not shown.
    expect(fields['ooxml|Tags']).toBeUndefined()
  })

  it('finds the property parts through the relationships, not their names', () => {
    const bytes = docx(
      {
        '_rels/.rels': rels([
          ['R1', REL.core, '/meta/props.xml'],
          ['R2', REL.app, './meta/../meta/app.xml'],
        ]),
        'docProps/core.xml': null,
        'docProps/app.xml': null,
        'docProps/custom.xml': null,
      },
      [
        { name: 'meta/props.xml', content: CORE },
        {
          name: 'meta/app.xml',
          content: APP.replace('<Pages>7</Pages>', '<Slides>12</Slides>'),
        },
      ],
    )
    const fields = values(bytes)
    expect(fields['title']).toBe('Quarterly & Annual Report')
    expect(fields['pageCount']).toBe('12')
  })

  it('matches namespaces by URI, whatever the prefixes', () => {
    const core =
      `<ns0:coreProperties xmlns:ns0="${NS.cp}" xmlns:ns1="${NS.dc}" xmlns:ns2="${NS.dcterms}">` +
      '<ns1:title>Renamed prefixes</ns1:title><ns2:created>2021-05-03T10:11:12.1234+05:30</ns2:created>' +
      '<title>not dc</title></ns0:coreProperties>'
    const fields = values(docx({ 'docProps/core.xml': core }))
    expect(fields['title']).toBe('Renamed prefixes')
    expect(fields['createdAt']).toBe('2021-05-03T10:11:12.123+05:30')
  })

  it('reads the Strict namespaces of extended properties', () => {
    const app =
      '<Properties xmlns="http://purl.oclc.org/ooxml/officeDocument/extendedProperties">' +
      '<Application>LibreOffice</Application></Properties>'
    expect(values(docx({ 'docProps/app.xml': app }))['software']).toBe(
      'LibreOffice',
    )
  })

  it('costs a damaged part only its own fields', () => {
    const fields = values(
      docx({
        'docProps/core.xml':
          '<!DOCTYPE x [<!ENTITY a "b">]>' + CORE.slice(DECL.length),
      }),
    )
    expect(fields['title']).toBeUndefined()
    expect(fields['software']).toBe('Microsoft Office Word')
    expect(fields['ooxml|Client']).toBe('Acme <West>')
  })

  it('reads a UTF-16 part and a UTF-8 part with a byte-order mark', () => {
    const utf16 = new Uint8Array(2 + CORE.length * 2)
    utf16.set([0xff, 0xfe])
    for (let index = 0; index < CORE.length; index++) {
      utf16[2 + index * 2] = CORE.charCodeAt(index) & 0xff
      utf16[3 + index * 2] = CORE.charCodeAt(index) >> 8
    }
    const read16 = readOoxml(
      zip([
        { name: '[Content_Types].xml', content: CONTENT_TYPES },
        { name: '_rels/.rels', content: ROOT_RELS },
        { name: 'docProps/core.xml', content: utf16 },
      ]),
    )
    expect(byKey(read16?.candidates ?? [])['subject']?.value).toBe('Finance')
    expect(
      values(docx({ 'docProps/core.xml': '\ufeff' + CORE }))['subject'],
    ).toBe('Finance')
  })

  it('is null for what is not an OPC package, and empty for a bare one', () => {
    expect(readOoxml(encode('plain text'))).toBeNull()
    expect(readOoxml(zip([{ name: 'readme.txt', content: 'hi' }]))).toBeNull()
    expect(
      readOoxml(zip([{ name: '[Content_Types].xml', content: CONTENT_TYPES }])),
    ).toEqual({
      candidates: [],
    })
  })
})

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

describe('writeOoxml', () => {
  const original = docx()
  const source = readZip(original)
  if (!source) throw new Error('fixture unreadable')

  it('writes every canonical key and reads them back', () => {
    const out = writeOoxml(
      original,
      {
        title: 'Q4 <Draft> & "final"',
        subject: 'Budgets',
        creator: ['Ada Lovelace', 'Alan Turing'],
        keywords: ['alpha', 'beta'],
        description: 'Line one\nline two',
        category: 'Plans',
      },
      { now: NOW },
    )
    const fields = values(out)
    expect(fields['title']).toBe('Q4 <Draft> & "final"')
    expect(fields['subject']).toBe('Budgets')
    expect(fields['creator']).toEqual(['Ada Lovelace', 'Alan Turing'])
    expect(fields['keywords']).toEqual(['alpha', 'beta'])
    expect(fields['description']).toBe('Line one\nline two')
    expect(fields['category']).toBe('Plans')
    expect(fields['modifiedAt']).toBe('2026-09-24T15:30:45Z')
    // Untouched fields survive.
    expect(fields['lastModifiedBy']).toBe('Grace Hopper')
    expect(fields['createdAt']).toBe('2024-01-02T03:04:05Z')
    expect(fields['software']).toBe('Microsoft Office Word')
    expect(fields['ooxml|Client']).toBe('Acme <West>')
    expect(partText(out, 'docProps/core.xml')).toContain(
      '<dc:creator>Ada Lovelace; Alan Turing</dc:creator>',
    )
    expect(partText(out, 'docProps/core.xml')).toContain(
      '<cp:keywords>alpha, beta</cp:keywords>',
    )
  })

  it('edits core.xml surgically and copies every other part byte for byte', () => {
    const out = writeOoxml(original, { title: 'New title' }, { now: NOW })
    expect(partText(out, 'docProps/core.xml')).toBe(
      CORE.replace('Quarterly &amp; Annual Report', 'New title').replace(
        '2024-02-03T04:05:06Z',
        '2026-09-24T15:30:45Z',
      ),
    )
    const rewritten = readZip(out)
    if (!rewritten) throw new Error('output unreadable')
    for (const name of [
      '[Content_Types].xml',
      '_rels/.rels',
      'word/document.xml',
      'word/media/image1.png',
      'docProps/app.xml',
      'docProps/custom.xml',
    ]) {
      expect(record(rewritten, name).equals(record(source, name))).toBe(true)
    }
    // Every entry still passes its CRC.
    for (const entry of rewritten.entries) {
      expect(readZipEntry(rewritten, entry)).not.toBeNull()
    }
  })

  it('removes a property on null and inserts a missing one', () => {
    const core =
      DECL +
      `<cp:coreProperties xmlns:cp="${NS.cp}" xmlns:dc="${NS.dc}">` +
      '<dc:title>Keep</dc:title><dc:subject>Drop me</dc:subject><dc:subject>and my twin</dc:subject>' +
      '</cp:coreProperties>'
    const out = writeOoxml(
      docx({ 'docProps/core.xml': core }),
      { subject: null, category: 'Added', creator: ['Solo'] },
      { now: NOW },
    )
    const text = partText(out, 'docProps/core.xml') ?? ''
    expect(text).toBe(
      DECL +
        `<cp:coreProperties xmlns:cp="${NS.cp}" xmlns:dc="${NS.dc}">` +
        '<dc:title>Keep</dc:title>' +
        '<cp:category>Added</cp:category><dc:creator>Solo</dc:creator>' +
        `<dcterms:modified xmlns:dcterms="${NS.dcterms}" xmlns:xsi="${NS.xsi}" xsi:type="dcterms:W3CDTF">2026-09-24T15:30:45Z</dcterms:modified>` +
        '</cp:coreProperties>',
    )
    const fields = values(out)
    expect(fields['subject']).toBeUndefined()
    expect(fields['category']).toBe('Added')
    expect(fields['modifiedAt']).toBe('2026-09-24T15:30:45Z')
  })

  it('expands self-closing elements, and a self-closing root', () => {
    const selfClosing =
      `<cp:coreProperties xmlns:cp="${NS.cp}" xmlns:dc="${NS.dc}" xmlns:dcterms="${NS.dcterms}" xmlns:xsi="${NS.xsi}">` +
      '<dc:title /></cp:coreProperties>'
    const out = writeOoxml(
      docx({ 'docProps/core.xml': selfClosing }),
      { title: 'Filled' },
      { now: NOW },
    )
    expect(partText(out, 'docProps/core.xml')).toContain(
      '<dc:title>Filled</dc:title>',
    )
    const emptyRoot = `<cp:coreProperties xmlns:cp="${NS.cp}" xmlns:dc="${NS.dc}"/>`
    const out2 = writeOoxml(
      docx({ 'docProps/core.xml': emptyRoot }),
      { title: 'Filled' },
      { now: NOW },
    )
    expect(values(out2)['title']).toBe('Filled')
    expect(partText(out2, 'docProps/core.xml')).toMatch(
      /<\/cp:coreProperties>$/,
    )
  })

  it('keeps a byte-order mark on the part it edits', () => {
    const out = writeOoxml(
      docx({ 'docProps/core.xml': '\ufeff' + CORE }),
      { title: 'B' },
      { now: NOW },
    )
    const archive = readZip(out)
    const entry = archive && findZipEntry(archive, 'docProps/core.xml')
    const bytes = archive && entry ? readZipEntry(archive, entry) : null
    expect(bytes && Array.from(bytes.subarray(0, 3))).toEqual([
      0xef, 0xbb, 0xbf,
    ])
    expect(values(out)['title']).toBe('B')
  })

  it('edits and removes custom text properties', () => {
    const out = writeOoxml(
      original,
      {
        'ooxml|Client': 'Globex & Co',
        'ooxml|Owner': null,
        'ooxml|Region|Code': 'US|2',
      },
      { now: NOW },
    )
    const fields = values(out)
    expect(fields['ooxml|Client']).toBe('Globex & Co')
    expect(fields['ooxml|Owner']).toBeUndefined()
    expect(fields['ooxml|Region|Code']).toBe('US|2')
    expect(fields['ooxml|Budget']).toBe('42')
    const custom = partText(out, 'docProps/custom.xml') ?? ''
    expect(custom).toBe(
      CUSTOM.replace('Acme &lt;West&gt;', 'Globex &amp; Co')
        .replace(property(6, 'Owner', '<vt:lpstr>Zed</vt:lpstr>'), '')
        .replace('EU|1', 'US|2'),
    )
    // pids 2, 3, 4, 5, 7, 8: a gap is not a violation, so none moved.
    expect(custom.match(/pid="\d+"/g)).toEqual([
      'pid="2"',
      'pid="3"',
      'pid="4"',
      'pid="5"',
      'pid="7"',
      'pid="8"',
    ])
  })

  it('renumbers only a pid that was already broken', () => {
    const custom =
      `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="${NS.vt}">` +
      property(2, 'A', '<vt:lpwstr>a</vt:lpwstr>') +
      property(5, 'B', '<vt:lpwstr>b</vt:lpwstr>') +
      property(5, 'C', '<vt:lpwstr>c</vt:lpwstr>') +
      property(1, 'D', '<vt:lpwstr>d</vt:lpwstr>') +
      property(9, 'E', '<vt:lpwstr>e</vt:lpwstr>') +
      '</Properties>'
    const out = writeOoxml(
      docx({ 'docProps/custom.xml': custom }),
      { 'ooxml|E': null },
      { now: NOW },
    )
    const text = partText(out, 'docProps/custom.xml') ?? ''
    expect(text.match(/pid="\d+" name="\w"/g)).toEqual([
      'pid="2" name="A"',
      'pid="5" name="B"',
      'pid="6" name="C"',
      'pid="7" name="D"',
    ])
  })

  it('refuses keys it cannot write', () => {
    const attempt = (patch: Record<string, string | string[] | null>) => () =>
      writeOoxml(original, patch, { now: NOW })
    expect(attempt({ 'ooxml|Nope': 'x' })).toThrow(EmbeddedWriteError)
    expect(attempt({ 'ooxml|Budget': '43' })).toThrow(/not a text property/)
    expect(attempt({ copyright: 'x' })).toThrow(EmbeddedWriteError)
    expect(attempt({ modifiedAt: '2020-01-01' })).toThrow(EmbeddedWriteError)
    expect(attempt({ 'png|Comment': 'x' })).toThrow(EmbeddedWriteError)
    expect(() =>
      writeOoxml(
        docx({ 'docProps/custom.xml': null }),
        { 'ooxml|Client': 'x' },
        { now: NOW },
      ),
    ).toThrow(EmbeddedWriteError)
  })

  it('refuses a part with a DOCTYPE, and a file that is not a package', () => {
    const doctype = docx({
      'docProps/core.xml':
        '<!DOCTYPE cp:coreProperties>' + CORE.slice(DECL.length),
    })
    expect(() => writeOoxml(doctype, { title: 'x' }, { now: NOW })).toThrow(
      EmbeddedWriteError,
    )
    expect(() =>
      writeOoxml(encode('nope'), { title: 'x' }, { now: NOW }),
    ).toThrow(EmbeddedWriteError)
    expect(() =>
      writeOoxml(
        zip([{ name: 'a.txt', content: 'a' }]),
        { title: 'x' },
        { now: NOW },
      ),
    ).toThrow(EmbeddedWriteError)
  })

  it('creates a core part — and its override and relationship — when there is none', () => {
    const bare = docx({
      'docProps/core.xml': null,
      '_rels/.rels': rels([
        ['rId1', REL.document, 'word/document.xml'],
        ['rId3', REL.app, 'docProps/app.xml'],
        ['rId4', REL.custom, 'docProps/custom.xml'],
      ]),
      '[Content_Types].xml': CONTENT_TYPES.replace(
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
        '',
      ),
    })
    const out = writeOoxml(
      bare,
      { title: 'Born here', 'ooxml|Client': 'Initech' },
      { now: NOW },
    )
    const fields = values(out)
    expect(fields['title']).toBe('Born here')
    expect(fields['modifiedAt']).toBe('2026-09-24T15:30:45Z')
    expect(fields['ooxml|Client']).toBe('Initech')
    expect(partText(out, '_rels/.rels')).toContain(
      // rId4 is taken, so the next free id.
      `<Relationship Id="rId5" Type="${REL.core}" Target="docProps/core.xml"/></Relationships>`,
    )
    expect(partText(out, '[Content_Types].xml')).toContain(
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
    )
    const rewritten = readZip(out)
    const before = readZip(bare)
    if (!rewritten || !before) throw new Error('unreadable')
    expect(rewritten.entries.at(-1)?.name).toBe('docProps/core.xml')
    for (const name of [
      'word/document.xml',
      'word/media/image1.png',
      'docProps/app.xml',
    ]) {
      expect(record(rewritten, name).equals(record(before, name))).toBe(true)
    }
  })

  it('creates the part a dangling relationship names, without a second relationship', () => {
    const dangling = docx({ 'docProps/core.xml': null })
    const out = writeOoxml(dangling, { title: 'Found' }, { now: NOW })
    expect(values(out)['title']).toBe('Found')
    expect(partText(out, '_rels/.rels')).toBe(ROOT_RELS)
    // The override was already there.
    expect(partText(out, '[Content_Types].xml')).toBe(CONTENT_TYPES)
  })

  it('never throws anything but EmbeddedWriteError, and never returns a bad file', () => {
    let seed = 11
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed
    }
    let written = 0
    for (let round = 0; round < 250; round++) {
      const bytes = original.slice()
      for (let flips = 0; flips < 1 + (round % 5); flips++) {
        bytes[random() % bytes.length] = random() & 0xff
      }
      expect(() => readOoxml(bytes)).not.toThrow()
      try {
        const out = writeOoxml(bytes, { title: 'x' }, { now: NOW })
        const archive = readZip(out)
        expect(archive).not.toBeNull()
        for (const entry of archive?.entries ?? []) {
          const touched = ['docProps/core.xml'].includes(entry.name)
          if (touched)
            expect(readZipEntry(archive as ZipArchive, entry)).not.toBeNull()
        }
        expect(values(out)['title']).toBe('x')
        written++
      } catch (error) {
        expect(error).toBeInstanceOf(EmbeddedWriteError)
      }
    }
    // Most damage lands in the document's deflate stream, copied untouched.
    expect(written).toBeGreaterThan(50)
  })
})
