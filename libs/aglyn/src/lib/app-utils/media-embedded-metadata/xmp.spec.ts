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
 * AGL-3331: reading XMP into canonical and other keys, and writing edits
 * back SURGICALLY.
 *
 * Most write assertions here are whole-string equalities against the input
 * with only the intended substrings replaced. That is the lossless promise
 * stated as a test: a Photoshop develop history, a Lightroom face region,
 * the packet's padding — everything the edit did not name — must come out
 * byte for byte, and a looser "the new value reads back" check would pass
 * a writer that re-serialized the whole packet.
 */

import { otherEmbeddedKey } from '../media-embedded-fields'
import { type EmbeddedCandidate, EmbeddedWriteError } from './types'
import { parseXml } from './xml'
import { normalizeXmpDate, readXmp, writeXmp, XMP_NAMESPACES } from './xmp'

const NOW = new Date('2026-09-24T12:00:00.000Z')
const STAMP = '2026-09-24T12:00:00Z'
const IMAGE = { profile: 'image', now: NOW } as const
const PDF = { profile: 'pdf', now: NOW } as const

const PADDING = (' '.repeat(100) + '\n').repeat(20)

/** A packet as Photoshop's serializer writes it: 3-space indents, elements. */
const PHOTOSHOP = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.6-c140 79.160451, 2017/05/06-01:08:21        ">
   <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
      <rdf:Description rdf:about=""
            xmlns:xmp="http://ns.adobe.com/xap/1.0/"
            xmlns:dc="http://purl.org/dc/elements/1.1/"
            xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
            xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"
            xmlns:stEvt="http://ns.adobe.com/xap/1.0/sType/ResourceEvent#"
            xmlns:stRef="http://ns.adobe.com/xap/1.0/sType/ResourceRef#"
            xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/"
            xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"
            xmlns:tiff="http://ns.adobe.com/tiff/1.0/"
            xmlns:exif="http://ns.adobe.com/exif/1.0/">
         <xmp:CreatorTool>Adobe Photoshop CC 2019 (Macintosh)</xmp:CreatorTool>
         <xmp:CreateDate>2019-03-14T09:26:53-05:00</xmp:CreateDate>
         <xmp:ModifyDate>2019-03-14T10:02:11-05:00</xmp:ModifyDate>
         <xmp:MetadataDate>2019-03-14T10:02:11-05:00</xmp:MetadataDate>
         <dc:format>image/jpeg</dc:format>
         <dc:title>
            <rdf:Alt>
               <rdf:li xml:lang="x-default">Harbor at dawn</rdf:li>
               <rdf:li xml:lang="en-US">Harbor at dawn</rdf:li>
               <rdf:li xml:lang="fr-FR">Le port &#xE0; l&apos;aube</rdf:li>
            </rdf:Alt>
         </dc:title>
         <dc:description>
            <rdf:Alt>
               <rdf:li xml:lang="x-default">Fishing boats &amp; fog, Portland Head</rdf:li>
            </rdf:Alt>
         </dc:description>
         <dc:creator>
            <rdf:Seq>
               <rdf:li>Jane Doe</rdf:li>
               <rdf:li>John Roe</rdf:li>
            </rdf:Seq>
         </dc:creator>
         <dc:subject>
            <rdf:Bag>
               <rdf:li>harbor</rdf:li>
               <rdf:li>fog</rdf:li>
               <rdf:li>boats</rdf:li>
            </rdf:Bag>
         </dc:subject>
         <dc:rights>
            <rdf:Alt>
               <rdf:li xml:lang="x-default">\u00A9 2019 Jane Doe</rdf:li>
            </rdf:Alt>
         </dc:rights>
         <photoshop:ColorMode>3</photoshop:ColorMode>
         <photoshop:ICCProfile>sRGB IEC61966-2.1</photoshop:ICCProfile>
         <photoshop:Headline>Morning on the water</photoshop:Headline>
         <photoshop:City>Cape Elizabeth</photoshop:City>
         <photoshop:State>Maine</photoshop:State>
         <photoshop:Country>United States</photoshop:Country>
         <photoshop:Credit>Doe Photo</photoshop:Credit>
         <photoshop:DateCreated>2019-03-14T06:12:40</photoshop:DateCreated>
         <photoshop:TransmissionReference>JOB-2019-0314</photoshop:TransmissionReference>
         <photoshop:LegacyIPTCDigest>0DDA1E4A5E0D5F7D4D8C5E1A7B3B1C2D</photoshop:LegacyIPTCDigest>
         <photoshop:DocumentAncestors>
            <rdf:Bag>
               <rdf:li>xmp.did:0180117407206811822AA6C1D2B8E4F7</rdf:li>
            </rdf:Bag>
         </photoshop:DocumentAncestors>
         <xmpMM:InstanceID>xmp.iid:8f9a1c2e-4b1d-4f7a-9c1e-2d3b4a5c6d7e</xmpMM:InstanceID>
         <xmpMM:DocumentID>adobe:docid:photoshop:1a2b3c4d-5e6f-11e9-8a9b-0c1d2e3f4a5b</xmpMM:DocumentID>
         <xmpMM:History>
            <rdf:Seq>
               <rdf:li rdf:parseType="Resource">
                  <stEvt:action>created</stEvt:action>
                  <stEvt:instanceID>xmp.iid:0180117407206811822AA6C1D2B8E4F7</stEvt:instanceID>
                  <stEvt:when>2019-03-14T09:26:53-05:00</stEvt:when>
                  <stEvt:softwareAgent>Adobe Photoshop CC 2019 (Macintosh)</stEvt:softwareAgent>
               </rdf:li>
               <rdf:li rdf:parseType="Resource">
                  <stEvt:action>saved</stEvt:action>
                  <stEvt:changed>/</stEvt:changed>
               </rdf:li>
            </rdf:Seq>
         </xmpMM:History>
         <xmpMM:DerivedFrom rdf:parseType="Resource">
            <stRef:instanceID>xmp.iid:0280117407206811822AA6C1D2B8E4F7</stRef:instanceID>
            <stRef:documentID>xmp.did:0180117407206811822AA6C1D2B8E4F7</stRef:documentID>
         </xmpMM:DerivedFrom>
         <Iptc4xmpCore:CreatorContactInfo rdf:parseType="Resource">
            <Iptc4xmpCore:CiEmailWork>jane@example.com</Iptc4xmpCore:CiEmailWork>
            <Iptc4xmpCore:CiAdrCity>Portland</Iptc4xmpCore:CiAdrCity>
         </Iptc4xmpCore:CreatorContactInfo>
         <Iptc4xmpCore:Location>Portland Head Light</Iptc4xmpCore:Location>
         <xmpRights:Marked>True</xmpRights:Marked>
         <xmpRights:WebStatement>https://example.com/license</xmpRights:WebStatement>
         <xmpRights:UsageTerms>
            <rdf:Alt>
               <rdf:li xml:lang="x-default">Editorial use only</rdf:li>
            </rdf:Alt>
         </xmpRights:UsageTerms>
         <tiff:Orientation>1</tiff:Orientation>
         <tiff:Make>Canon</tiff:Make>
         <tiff:Model>Canon EOS 5D Mark IV</tiff:Model>
         <exif:ExposureTime>1/250</exif:ExposureTime>
         <exif:FNumber>28/10</exif:FNumber>
         <exif:FocalLength>35/1</exif:FocalLength>
         <exif:ISOSpeedRatings>
            <rdf:Seq>
               <rdf:li>400</rdf:li>
            </rdf:Seq>
         </exif:ISOSpeedRatings>
         <exif:DateTimeOriginal>2019-03-14T06:12:40</exif:DateTimeOriginal>
         <exif:GPSLatitude>43,37.4238N</exif:GPSLatitude>
         <exif:GPSLongitude>70,12.4086W</exif:GPSLongitude>
         <exif:GPSAltitude>12/1</exif:GPSAltitude>
         <exif:GPSVersionID>2.3.0.0</exif:GPSVersionID>
      </rdf:Description>
   </rdf:RDF>
</x:xmpmeta>
${PADDING}<?xpacket end="w"?>`

/**
 * A packet as Lightroom Classic writes it: 1-space indents, simple values
 * as shorthand attributes, `crs:` develop settings, `mwg-rs` face regions
 * and an attribute-form History.
 */
const LIGHTROOM = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0-c000 1.000000, 0000/00/00-00:00:00        ">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:aux="http://ns.adobe.com/exif/1.0/aux/"
    xmlns:exifEX="http://cipa.jp/exif/1.0/"
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"
    xmlns:stEvt="http://ns.adobe.com/xap/1.0/sType/ResourceEvent#"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
    xmlns:exif="http://ns.adobe.com/exif/1.0/"
    xmlns:tiff="http://ns.adobe.com/tiff/1.0/"
    xmlns:mwg-rs="http://www.metadataworkinggroup.com/schemas/regions/"
    xmlns:stDim="http://ns.adobe.com/xap/1.0/sType/Dimensions#"
    xmlns:stArea="http://ns.adobe.com/xmp/sType/Area#"
    xmlns:lr="http://ns.adobe.com/lightroom/1.0/"
   xmp:CreatorTool="Adobe Photoshop Lightroom Classic 12.0 (Macintosh)"
   xmp:ModifyDate="2023-06-01T18:22:04-07:00"
   xmp:CreateDate="2023-05-28T07:41:09.12"
   xmp:MetadataDate="2023-06-01T18:22:04-07:00"
   xmp:Rating="4"
   xmp:Label="Green"
   aux:Lens="EF24-70mm f/2.8L II USM"
   aux:SerialNumber="0123456789"
   exifEX:LensModel="EF24-70mm f/2.8L II USM"
   exifEX:PhotographicSensitivity="1600"
   photoshop:DateCreated="2023-05-28T07:41:09.12"
   photoshop:City="Moab"
   exif:ExposureTime="1/8000"
   exif:FNumber="4/1"
   exif:FocalLength="700/10"
   exif:GPSLatitude="38,34,24.6N"
   exif:GPSLongitude="109,32,56.1W"
   tiff:Make="Canon"
   tiff:Model="Canon EOS R5"
   tiff:Orientation="6"
   crs:Version="15.0"
   crs:Exposure2012="+0.35"
   crs:Contrast2012="+12"
   crs:HasSettings="True"
   xmpMM:DocumentID="xmp.did:6c1f0b2e-8f3a-4d59-9e61-9b7a2c3d4e5f"
   xmpMM:InstanceID="xmp.iid:6c1f0b2e-8f3a-4d59-9e61-9b7a2c3d4e5f">
   <dc:creator>
    <rdf:Seq>
     <rdf:li>Sam Rivera</rdf:li>
    </rdf:Seq>
   </dc:creator>
   <dc:subject>
    <rdf:Bag>
     <rdf:li>desert</rdf:li>
     <rdf:li>arches</rdf:li>
    </rdf:Bag>
   </dc:subject>
   <lr:hierarchicalSubject>
    <rdf:Bag>
     <rdf:li>Places|Utah|Moab</rdf:li>
    </rdf:Bag>
   </lr:hierarchicalSubject>
   <crs:ToneCurvePV2012>
    <rdf:Seq>
     <rdf:li>0, 0</rdf:li>
     <rdf:li>255, 255</rdf:li>
    </rdf:Seq>
   </crs:ToneCurvePV2012>
   <mwg-rs:Regions rdf:parseType="Resource">
    <mwg-rs:AppliedToDimensions stDim:w="8192" stDim:h="5464" stDim:unit="pixel"/>
    <mwg-rs:RegionList>
     <rdf:Bag>
      <rdf:li>
       <rdf:Description mwg-rs:Name="Sam" mwg-rs:Type="Face">
        <mwg-rs:Area stArea:x="0.5" stArea:y="0.4" stArea:w="0.1" stArea:h="0.15" stArea:unit="normalized"/>
       </rdf:Description>
      </rdf:li>
     </rdf:Bag>
    </mwg-rs:RegionList>
   </mwg-rs:Regions>
   <xmpMM:History>
    <rdf:Seq>
     <rdf:li
      stEvt:action="saved"
      stEvt:instanceID="xmp.iid:6c1f0b2e-8f3a-4d59-9e61-9b7a2c3d4e5f"
      stEvt:when="2023-06-01T18:22:04-07:00"
      stEvt:softwareAgent="Adobe Photoshop Lightroom Classic 12.0 (Macintosh)"
      stEvt:changed="/metadata"/>
    </rdf:Seq>
   </xmpMM:History>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
${PADDING}<?xpacket end="w"?>`

/** A PDF's packet as Acrobat writes it, with a custom `pdfx:` property. */
const ACROBAT = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
   <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
      <rdf:Description rdf:about=""
            xmlns:xmp="http://ns.adobe.com/xap/1.0/"
            xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
            xmlns:pdfx="http://ns.adobe.com/pdfx/1.3/"
            xmlns:dc="http://purl.org/dc/elements/1.1/">
         <xmp:CreateDate>2024-01-15T09:00:00+01:00</xmp:CreateDate>
         <xmp:ModifyDate>2024-01-16T10:30:00+01:00</xmp:ModifyDate>
         <xmp:CreatorTool>Microsoft Word</xmp:CreatorTool>
         <pdf:Producer>Adobe PDF Library 23.1</pdf:Producer>
         <pdf:Keywords>annual; report, 2023</pdf:Keywords>
         <pdfx:Client>ACME Corp</pdfx:Client>
         <dc:format>application/pdf</dc:format>
         <dc:title>
            <rdf:Alt>
               <rdf:li xml:lang="x-default">Annual Report</rdf:li>
            </rdf:Alt>
         </dc:title>
      </rdf:Description>
   </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`

/** Apply literal replacements, each of which must match exactly once. */
function replaced(input: string, edits: Array<[string, string]>): string {
  let out = input
  for (const [from, to] of edits) {
    const first = out.indexOf(from)
    if (first === -1) throw new Error(`not found: ${from}`)
    if (out.indexOf(from, first + 1) !== -1) {
      throw new Error(`not unique: ${from}`)
    }
    out = out.slice(0, first) + to + out.slice(first + from.length)
  }
  return out
}

function valueOf(
  candidates: EmbeddedCandidate[],
  key: string,
): string | string[] | undefined {
  return candidates.find((candidate) => candidate.key === key)?.value
}

function written(
  packet: string | null,
  patch: Record<string, string | string[] | null>,
  options: { profile: 'image' | 'pdf'; now: Date } = IMAGE,
): string {
  const out = writeXmp(packet, patch, options)
  if (out === null) throw new Error('writeXmp returned null')
  return out
}

const PS_METADATA_DATE: [string, string] = [
  '<xmp:MetadataDate>2019-03-14T10:02:11-05:00</xmp:MetadataDate>',
  `<xmp:MetadataDate>${STAMP}</xmp:MetadataDate>`,
]
const LR_METADATA_DATE: [string, string] = [
  'xmp:MetadataDate="2023-06-01T18:22:04-07:00"',
  `xmp:MetadataDate="${STAMP}"`,
]

const other = (prefix: keyof typeof XMP_NAMESPACES | string, local: string) =>
  otherEmbeddedKey(
    'xmp',
    (XMP_NAMESPACES as Record<string, string>)[prefix] ?? prefix,
    local,
  )

describe('readXmp: a Photoshop packet', () => {
  const candidates = readXmp(PHOTOSHOP)

  it('folds the well-known properties into canonical keys', () => {
    const canonical = Object.fromEntries(
      candidates
        .filter((candidate) => !candidate.key.includes('|'))
        .map((candidate) => [candidate.key, candidate.value]),
    )
    expect(canonical).toEqual({
      title: 'Harbor at dawn',
      headline: 'Morning on the water',
      description: 'Fishing boats & fog, Portland Head',
      keywords: ['harbor', 'fog', 'boats'],
      creator: ['Jane Doe', 'John Roe'],
      copyright: '\u00A9 2019 Jane Doe',
      credit: 'Doe Photo',
      usageTerms: 'Editorial use only',
      webStatement: 'https://example.com/license',
      city: 'Cape Elizabeth',
      state: 'Maine',
      country: 'United States',
      createdAt: '2019-03-14T06:12:40',
      make: 'Canon',
      model: 'Canon EOS 5D Mark IV',
      exposure: '1/250 s',
      aperture: 'f/2.8',
      iso: '400',
      focalLength: '35 mm',
      modifiedAt: '2019-03-14T10:02:11-05:00',
      software: 'Adobe Photoshop CC 2019 (Macintosh)',
      orientation: 'Horizontal (normal)',
      gps: '43.623730,-70.206810',
    })
    expect(candidates.every((candidate) => candidate.source === 'xmp')).toBe(
      true,
    )
  })

  it('offers other simple properties under namespaced keys with labels', () => {
    const others = candidates.filter((candidate) => candidate.key.includes('|'))
    expect(others).toEqual([
      {
        key: other('dc', 'format'),
        value: 'image/jpeg',
        source: 'xmp',
        label: 'dc:format',
      },
      {
        key: other('photoshop', 'TransmissionReference'),
        value: 'JOB-2019-0314',
        source: 'xmp',
        label: 'photoshop:TransmissionReference',
      },
      {
        key: other('Iptc4xmpCore', 'Location'),
        value: 'Portland Head Light',
        source: 'xmp',
        label: 'Iptc4xmpCore:Location',
      },
      {
        key: other('xmpRights', 'Marked'),
        value: 'True',
        source: 'xmp',
        label: 'xmpRights:Marked',
      },
    ])
  })

  it('keeps the deny list, the structs and the shadowed fallbacks out', () => {
    const labels = candidates.map((candidate) => candidate.label ?? '')
    for (const hidden of [
      'photoshop:ColorMode',
      'photoshop:ICCProfile',
      'photoshop:DocumentAncestors',
      'photoshop:LegacyIPTCDigest',
      'xmpMM:InstanceID',
      'xmpMM:History',
      'xmpMM:DerivedFrom',
      'Iptc4xmpCore:CreatorContactInfo',
      'xmp:MetadataDate',
      'xmp:CreateDate',
      'exif:GPSAltitude',
      'tiff:Orientation',
    ]) {
      expect(labels).not.toContain(hidden)
    }
  })
})

describe('readXmp: a Lightroom packet (shorthand attributes)', () => {
  const candidates = readXmp(LIGHTROOM)

  it('reads properties written as attributes of rdf:Description', () => {
    expect(valueOf(candidates, 'software')).toBe(
      'Adobe Photoshop Lightroom Classic 12.0 (Macintosh)',
    )
    expect(valueOf(candidates, 'rating')).toBe('4')
    expect(valueOf(candidates, 'label')).toBe('Green')
    expect(valueOf(candidates, 'city')).toBe('Moab')
    expect(valueOf(candidates, 'createdAt')).toBe('2023-05-28T07:41:09.12')
    expect(valueOf(candidates, 'modifiedAt')).toBe('2023-06-01T18:22:04-07:00')
    expect(valueOf(candidates, 'make')).toBe('Canon')
    expect(valueOf(candidates, 'model')).toBe('Canon EOS R5')
    expect(valueOf(candidates, 'creator')).toEqual(['Sam Rivera'])
    expect(valueOf(candidates, 'keywords')).toEqual(['desert', 'arches'])
  })

  it('formats the camera values for display', () => {
    expect(valueOf(candidates, 'lens')).toBe('EF24-70mm f/2.8L II USM')
    expect(valueOf(candidates, 'iso')).toBe('1600')
    expect(valueOf(candidates, 'exposure')).toBe('1/8000 s')
    expect(valueOf(candidates, 'aperture')).toBe('f/4')
    expect(valueOf(candidates, 'focalLength')).toBe('70 mm')
    expect(valueOf(candidates, 'orientation')).toBe('Rotate 90 CW')
    expect(valueOf(candidates, 'gps')).toBe('38.573500,-109.548917')
  })

  it('offers an unknown namespace, and hides crs, mwg-rs, aux and xmpMM', () => {
    const others = candidates.filter((candidate) => candidate.key.includes('|'))
    expect(others).toEqual([
      {
        key: otherEmbeddedKey(
          'xmp',
          'http://ns.adobe.com/lightroom/1.0/',
          'hierarchicalSubject',
        ),
        value: ['Places|Utah|Moab'],
        source: 'xmp',
        label: 'lr:hierarchicalSubject',
      },
    ])
  })
})

describe('readXmp: shapes and spellings', () => {
  it('accepts a bare x:xmpmeta and a bare rdf:RDF fragment', () => {
    const rdf =
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
      '<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" dc:format="image/png">' +
      '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Bare</rdf:li></rdf:Alt></dc:title>' +
      '</rdf:Description></rdf:RDF>'
    expect(valueOf(readXmp(rdf), 'title')).toBe('Bare')
    const meta = `<x:xmpmeta xmlns:x="adobe:ns:meta/">${rdf}</x:xmpmeta>`
    expect(readXmp(meta)).toEqual(readXmp(rdf))
  })

  it('finds rdf:RDF by namespace URI, whatever the prefixes', () => {
    const renamed =
      '<m:xmpmeta xmlns:m="adobe:ns:meta/">' +
      '<r:RDF xmlns:r="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
      '<r:Description r:about="" xmlns:d="http://purl.org/dc/elements/1.1/"' +
      ' xmlns:ps="http://ns.adobe.com/photoshop/1.0/" ps:City="Oslo"' +
      ' ps:TransmissionReference="T-1">' +
      '<d:title><r:Alt><r:li xml:lang="x-default">Renamed</r:li></r:Alt></d:title>' +
      '<d:subject><r:Bag><r:li>a</r:li><r:li>b</r:li></r:Bag></d:subject>' +
      '</r:Description></r:RDF></m:xmpmeta>'
    const candidates = readXmp(renamed)
    expect(valueOf(candidates, 'title')).toBe('Renamed')
    expect(valueOf(candidates, 'city')).toBe('Oslo')
    expect(valueOf(candidates, 'keywords')).toEqual(['a', 'b'])
    const reference = candidates.find((candidate) =>
      candidate.key.endsWith('|TransmissionReference'),
    )
    // Same key as the Photoshop packet's `photoshop:` spelling; own label.
    expect(reference?.key).toBe(other('photoshop', 'TransmissionReference'))
    expect(reference?.label).toBe('ps:TransmissionReference')
  })

  it('ignores an element that only LOOKS like rdf:RDF', () => {
    const impostor =
      '<rdf:RDF xmlns:rdf="urn:not-rdf"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" dc:title="x"/></rdf:RDF>'
    expect(readXmp(impostor)).toEqual([])
  })

  it('prefers x-default in a language alternative, else the first item', () => {
    const packet = (items: string) =>
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      `<dc:title><rdf:Alt>${items}</rdf:Alt></dc:title></rdf:Description></rdf:RDF>`
    expect(
      valueOf(
        readXmp(
          packet(
            '<rdf:li xml:lang="de">Hafen</rdf:li><rdf:li xml:lang="x-default">Harbor</rdf:li>',
          ),
        ),
        'title',
      ),
    ).toBe('Harbor')
    expect(
      valueOf(
        readXmp(
          packet(
            '<rdf:li xml:lang="de">Hafen</rdf:li><rdf:li xml:lang="fr">Port</rdf:li>',
          ),
        ),
        'title',
      ),
    ).toBe('Hafen')
  })

  it('reads an SVG metadata fragment: typed node, undeclared prefixes', () => {
    // Inkscape: `rdf:` and `dc:` are declared on the <svg>, not here, and
    // the description is a typed `cc:Work` node.
    const svg =
      '<rdf:RDF><cc:Work rdf:about="">' +
      '<dc:format>image/svg+xml</dc:format>' +
      '<dc:title>Logo, final</dc:title>' +
      '<dc:creator><cc:Agent><dc:title>Studio</dc:title></cc:Agent></dc:creator>' +
      '</cc:Work><cc:License rdf:about="http://creativecommons.org/licenses/by/4.0/">' +
      '<cc:permits rdf:resource="http://creativecommons.org/ns#Reproduction"/>' +
      '</cc:License></rdf:RDF>'
    const candidates = readXmp(svg)
    expect(valueOf(candidates, 'title')).toBe('Logo, final')
    // The creator is a struct (a cc:Agent): skipped, not "[object]".
    expect(valueOf(candidates, 'creator')).toBeUndefined()
    // The license node describes the license, not the file.
    expect(candidates.some((c) => c.label === 'cc:permits')).toBe(false)
  })

  it('reads an rdf:resource URI as a simple value', () => {
    const packet =
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/">' +
      '<xmpRights:WebStatement rdf:resource="https://example.com/terms"/></rdf:Description></rdf:RDF>'
    expect(valueOf(readXmp(packet), 'webStatement')).toBe(
      'https://example.com/terms',
    )
  })

  it('reads across several Descriptions, the first occurrence winning', () => {
    const packet =
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
      '<rdf:Description xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" photoshop:City="First"/>' +
      '<rdf:Description xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" photoshop:City="Second" photoshop:State="Only here"/>' +
      '</rdf:RDF>'
    const candidates = readXmp(packet)
    expect(valueOf(candidates, 'city')).toBe('First')
    expect(valueOf(candidates, 'state')).toBe('Only here')
  })

  it('falls back through the createdAt and lens sources in order', () => {
    const packet = (props: string) =>
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description' +
      ' xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:exif="http://ns.adobe.com/exif/1.0/"' +
      ` xmlns:aux="http://ns.adobe.com/exif/1.0/aux/" ${props}/></rdf:RDF>`
    const both = readXmp(
      packet(
        'xmp:CreateDate="2020-01-01T00:00:00Z" exif:DateTimeOriginal="2019-12-31T23:59:59"',
      ),
    )
    expect(valueOf(both, 'createdAt')).toBe('2019-12-31T23:59:59')
    const lensOnly = readXmp(packet('aux:Lens="50mm f/1.4"'))
    expect(valueOf(lensOnly, 'lens')).toBe('50mm f/1.4')
    // The PDF profile reads xmp:CreateDate only.
    expect(
      valueOf(
        readXmp(
          packet(
            'xmp:CreateDate="2020-01-01T00:00:00Z" exif:DateTimeOriginal="2019-12-31T23:59:59"',
          ),
          { profile: 'pdf' },
        ),
        'createdAt',
      ),
    ).toBe('2020-01-01T00:00:00Z')
  })

  it('reads pdf:Keywords when there is no dc:subject, and prefers dc:subject', () => {
    const acrobat = readXmp(ACROBAT, { profile: 'pdf' })
    expect(valueOf(acrobat, 'keywords')).toEqual(['annual', 'report', '2023'])
    expect(valueOf(acrobat, 'producer')).toBe('Adobe PDF Library 23.1')
    expect(valueOf(acrobat, 'createdAt')).toBe('2024-01-15T09:00:00+01:00')
    // Acrobat's custom properties live in pdfx:, which is kept.
    expect(valueOf(acrobat, other('pdfx', 'Client'))).toBe('ACME Corp')
    const both = ACROBAT.replace(
      '<dc:format>',
      '<dc:subject><rdf:Bag><rdf:li>from dc</rdf:li></rdf:Bag></dc:subject><dc:format>',
    )
    expect(valueOf(readXmp(both, { profile: 'pdf' }), 'keywords')).toEqual([
      'from dc',
    ])
    // pdf:Keywords is claimed by the canonical key: never also an "other".
    expect(
      readXmp(both, { profile: 'pdf' }).some(
        (candidate) => candidate.label === 'pdf:Keywords',
      ),
    ).toBe(false)
  })

  it('skips empty values and unparseable technical values', () => {
    const packet =
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description' +
      ' xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" xmlns:exif="http://ns.adobe.com/exif/1.0/"' +
      ' xmlns:xmp="http://ns.adobe.com/xap/1.0/" photoshop:City="  " exif:FNumber="0/0"' +
      ' exif:GPSLatitude="95,00N" exif:GPSLongitude="10,00E" xmp:Rating="9"' +
      ' xmp:CreateDate="0000:00:00 00:00:00">' +
      '<photoshop:Instructions></photoshop:Instructions></rdf:Description></rdf:RDF>'
    expect(readXmp(packet)).toEqual([])
  })

  it('parses both GPS spellings and rejects a coordinate on the wrong axis', () => {
    const packet = (lat: string, lon: string) =>
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description' +
      ` xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="${lat}" exif:GPSLongitude="${lon}"/></rdf:RDF>`
    expect(valueOf(readXmp(packet('51,30.0N', '0,7.5W')), 'gps')).toBe(
      '51.500000,-0.125000',
    )
    expect(valueOf(readXmp(packet('33,51,54S', '151,12,36E')), 'gps')).toBe(
      '-33.865000,151.210000',
    )
    expect(
      valueOf(readXmp(packet('51,30.0E', '0,7.5W')), 'gps'),
    ).toBeUndefined()
  })
})

describe('normalizeXmpDate', () => {
  it.each([
    ['2021-05-03T10:11:12', '2021-05-03T10:11:12'],
    ['2021-05-03T10:11:12Z', '2021-05-03T10:11:12Z'],
    ['2021-05-03T10:11:12.345678+02:00', '2021-05-03T10:11:12.345+02:00'],
    ['2021-05-03T10:11+0530', '2021-05-03T10:11+05:30'],
    ['2021:05:03 10:11:12', '2021-05-03T10:11:12'],
    ['2021-05-03', '2021-05-03'],
    ['2021-05', '2021-05'],
    ['2021', '2021'],
    [' 2021-05-03T10:11:12 ', '2021-05-03T10:11:12'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeXmpDate(raw)).toBe(expected)
  })

  it.each([
    '',
    'yesterday',
    '2021-13-01',
    '2021-05-03T25:00',
    '0000:00:00 00:00:00',
  ])('rejects %p', (raw) => {
    expect(normalizeXmpDate(raw)).toBeNull()
  })
})

describe('readXmp: hostile input returns [] without throwing', () => {
  const hostile: Record<string, string> = {
    doctype:
      '<!DOCTYPE x:xmpmeta><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>',
    billionLaughs:
      '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]>' +
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>&lol2;</dc:title></rdf:Description></rdf:RDF>',
    externalEntity:
      '<!DOCTYPE r [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>&xxe;</dc:title></rdf:Description></rdf:RDF>',
    deepNesting:
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description>' +
      '<a>'.repeat(100_000),
    hugeAttributeCount: `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"${Array.from(
      { length: 60_000 },
      (_, i) => ` dc:p${i}="x"`,
    ).join('')}/></rdf:RDF>`,
    unterminated: PHOTOSHOP.slice(0, PHOTOSHOP.indexOf('</dc:title>')),
    garbage: '\u0000\u0001<<<>>>&&&;;;<?<!--',
    empty: '',
  }

  it.each(Object.entries(hostile))('%s', (_, input) => {
    let result: EmbeddedCandidate[] | undefined
    expect(() => {
      result = readXmp(input)
    }).not.toThrow()
    expect(result).toEqual([])
  })

  it('returns [] for a non-string', () => {
    expect(readXmp(null as unknown as string)).toEqual([])
  })

  it('never throws on any truncation of a real packet', () => {
    for (let end = 0; end < LIGHTROOM.length; end += 7) {
      expect(() => readXmp(LIGHTROOM.slice(0, end))).not.toThrow()
    }
  })
})

describe('writeXmp: surgical edits of a Photoshop packet', () => {
  it('sets x-default and its same-valued twin, and nothing else', () => {
    const out = written(PHOTOSHOP, { title: 'Harbor at first light' })
    expect(out).toBe(
      replaced(PHOTOSHOP, [
        PS_METADATA_DATE,
        [
          '<rdf:li xml:lang="x-default">Harbor at dawn</rdf:li>\n               <rdf:li xml:lang="en-US">Harbor at dawn</rdf:li>',
          '<rdf:li xml:lang="x-default">Harbor at first light</rdf:li>\n               <rdf:li xml:lang="en-US">Harbor at first light</rdf:li>',
        ],
      ]),
    )
    // The translated item is not a twin and keeps its text.
    expect(out).toContain('Le port &#xE0; l&apos;aube')
    expect(valueOf(readXmp(out), 'title')).toBe('Harbor at first light')
  })

  it('rewrites a Bag in place with the same indentation', () => {
    const out = written(PHOTOSHOP, { keywords: ['harbor', 'lighthouse'] })
    expect(out).toBe(
      replaced(PHOTOSHOP, [
        PS_METADATA_DATE,
        [
          '<rdf:li>harbor</rdf:li>\n               <rdf:li>fog</rdf:li>\n               <rdf:li>boats</rdf:li>',
          '<rdf:li>harbor</rdf:li>\n               <rdf:li>lighthouse</rdf:li>',
        ],
      ]),
    )
    expect(valueOf(readXmp(out), 'keywords')).toEqual(['harbor', 'lighthouse'])
  })

  it('appends a new property after the last one, indented like it', () => {
    const out = written(PHOTOSHOP, { instructions: 'Credit required' })
    expect(out).toBe(
      replaced(PHOTOSHOP, [
        PS_METADATA_DATE,
        [
          '<exif:GPSVersionID>2.3.0.0</exif:GPSVersionID>\n',
          '<exif:GPSVersionID>2.3.0.0</exif:GPSVersionID>\n         <photoshop:Instructions>Credit required</photoshop:Instructions>\n',
        ],
      ]),
    )
  })

  it('declares a missing namespace with its conventional prefix', () => {
    const out = written(PHOTOSHOP, { lens: 'EF 35mm f/1.4L II USM' })
    expect(out).toBe(
      replaced(PHOTOSHOP, [
        [
          'xmlns:exif="http://ns.adobe.com/exif/1.0/">',
          'xmlns:exif="http://ns.adobe.com/exif/1.0/"\n            xmlns:exifEX="http://cipa.jp/exif/1.0/">',
        ],
        PS_METADATA_DATE,
        [
          '<exif:GPSVersionID>2.3.0.0</exif:GPSVersionID>\n',
          '<exif:GPSVersionID>2.3.0.0</exif:GPSVersionID>\n         <exifEX:LensModel>EF 35mm f/1.4L II USM</exifEX:LensModel>\n',
        ],
      ]),
    )
    expect(valueOf(readXmp(out), 'lens')).toBe('EF 35mm f/1.4L II USM')
  })

  it('removes a property together with the indentation before it', () => {
    const out = written(PHOTOSHOP, { description: null, credit: null })
    expect(out).toBe(
      replaced(PHOTOSHOP, [
        PS_METADATA_DATE,
        [
          '\n         <dc:description>\n            <rdf:Alt>\n               <rdf:li xml:lang="x-default">Fishing boats &amp; fog, Portland Head</rdf:li>\n            </rdf:Alt>\n         </dc:description>',
          '',
        ],
        ['\n         <photoshop:Credit>Doe Photo</photoshop:Credit>', ''],
      ]),
    )
    const after = readXmp(out)
    expect(valueOf(after, 'description')).toBeUndefined()
    expect(valueOf(after, 'credit')).toBeUndefined()
    expect(valueOf(after, 'headline')).toBe('Morning on the water')
  })

  it('takes GPS off completely and leaves the rest of exif:', () => {
    const out = written(PHOTOSHOP, { gps: null })
    expect(out).toBe(
      replaced(PHOTOSHOP, [
        PS_METADATA_DATE,
        [
          '\n         <exif:GPSLatitude>43,37.4238N</exif:GPSLatitude>\n         <exif:GPSLongitude>70,12.4086W</exif:GPSLongitude>\n         <exif:GPSAltitude>12/1</exif:GPSAltitude>\n         <exif:GPSVersionID>2.3.0.0</exif:GPSVersionID>',
          '',
        ],
      ]),
    )
    expect(out).not.toMatch(/GPS/)
    expect(valueOf(readXmp(out), 'gps')).toBeUndefined()
    expect(valueOf(readXmp(out), 'exposure')).toBe('1/250 s')
  })

  it('writes the date taken to every copy the file already holds', () => {
    const out = written(PHOTOSHOP, { createdAt: '2019-03-14T06:30:00-05:00' })
    expect(out).toBe(
      replaced(PHOTOSHOP, [
        [
          '<xmp:CreateDate>2019-03-14T09:26:53-05:00</xmp:CreateDate>',
          '<xmp:CreateDate>2019-03-14T06:30:00-05:00</xmp:CreateDate>',
        ],
        PS_METADATA_DATE,
        [
          '<photoshop:DateCreated>2019-03-14T06:12:40</photoshop:DateCreated>',
          '<photoshop:DateCreated>2019-03-14T06:30:00-05:00</photoshop:DateCreated>',
        ],
        [
          '<exif:DateTimeOriginal>2019-03-14T06:12:40</exif:DateTimeOriginal>',
          '<exif:DateTimeOriginal>2019-03-14T06:30:00-05:00</exif:DateTimeOriginal>',
        ],
      ]),
    )
  })

  it('removes every copy of the date taken, so no fallback resurfaces', () => {
    const out = written(PHOTOSHOP, { createdAt: null })
    expect(out).not.toMatch(/DateCreated|DateTimeOriginal|CreateDate/)
    expect(valueOf(readXmp(out), 'createdAt')).toBeUndefined()
  })

  it('escapes what it writes and reads it back exactly', () => {
    const tricky = `Tom & Jerry's "<b>best</b>" ]]> day\ttab`
    const out = written(PHOTOSHOP, { headline: tricky, creator: [tricky, 'B'] })
    expect(parseXml(out)).not.toBeNull()
    expect(valueOf(readXmp(out), 'headline')).toBe(tricky)
    expect(valueOf(readXmp(out), 'creator')).toEqual([tricky, 'B'])
  })

  it('round-trips a whole patch and keeps every untouched field', () => {
    const before = readXmp(PHOTOSHOP)
    const patch = {
      title: 'New title',
      description: 'New description',
      creator: ['A. Author'],
      copyright: '\u00A9 2026 A. Author',
      keywords: ['one', 'two', 'three'],
      headline: 'New headline',
      city: 'Bar Harbor',
      rating: '5',
      label: 'Red',
      usageTerms: 'Any use',
      webStatement: 'https://example.org/l',
    }
    const after = readXmp(written(PHOTOSHOP, patch))
    for (const [key, value] of Object.entries(patch)) {
      expect(valueOf(after, key)).toEqual(value)
    }
    for (const candidate of before) {
      if (candidate.key in patch) continue
      expect(valueOf(after, candidate.key)).toEqual(candidate.value)
    }
  })
})

describe('writeXmp: surgical edits of a Lightroom packet', () => {
  it('edits a shorthand attribute where it lives', () => {
    const out = written(LIGHTROOM, { label: 'Red', city: 'Arches' })
    expect(out).toBe(
      replaced(LIGHTROOM, [
        LR_METADATA_DATE,
        ['xmp:Label="Green"', 'xmp:Label="Red"'],
        ['photoshop:City="Moab"', 'photoshop:City="Arches"'],
      ]),
    )
  })

  it('removes a shorthand attribute with its leading whitespace', () => {
    const out = written(LIGHTROOM, { rating: null, lens: null })
    expect(out).toBe(
      replaced(LIGHTROOM, [
        LR_METADATA_DATE,
        ['\n   xmp:Rating="4"', ''],
        ['\n   aux:Lens="EF24-70mm f/2.8L II USM"', ''],
        ['\n   exifEX:LensModel="EF24-70mm f/2.8L II USM"', ''],
      ]),
    )
    expect(valueOf(readXmp(out), 'lens')).toBeUndefined()
  })

  it('updates the attribute copies of the date taken, planting no new one', () => {
    const out = written(LIGHTROOM, { createdAt: '2023-05-28T07:45:00' })
    expect(out).toBe(
      replaced(LIGHTROOM, [
        [
          'xmp:CreateDate="2023-05-28T07:41:09.12"',
          'xmp:CreateDate="2023-05-28T07:45:00"',
        ],
        LR_METADATA_DATE,
        [
          'photoshop:DateCreated="2023-05-28T07:41:09.12"',
          'photoshop:DateCreated="2023-05-28T07:45:00"',
        ],
      ]),
    )
    expect(out).not.toContain('DateTimeOriginal')
  })

  it('adds an array property at the file’s own 1-space indentation', () => {
    const out = written(LIGHTROOM, { title: 'Delicate Arch' })
    expect(out).toBe(
      replaced(LIGHTROOM, [
        LR_METADATA_DATE,
        [
          '   </xmpMM:History>\n',
          '   </xmpMM:History>\n' +
            '   <dc:title>\n' +
            '    <rdf:Alt>\n' +
            '     <rdf:li xml:lang="x-default">Delicate Arch</rdf:li>\n' +
            '    </rdf:Alt>\n' +
            '   </dc:title>\n',
        ],
      ]),
    )
  })

  it('rewrites a Seq and leaves crs, mwg-rs and History byte-identical', () => {
    const out = written(LIGHTROOM, { creator: ['Sam Rivera', 'Alex Kim'] })
    expect(out).toBe(
      replaced(LIGHTROOM, [
        LR_METADATA_DATE,
        [
          '     <rdf:li>Sam Rivera</rdf:li>\n    </rdf:Seq>\n   </dc:creator>',
          '     <rdf:li>Sam Rivera</rdf:li>\n     <rdf:li>Alex Kim</rdf:li>\n    </rdf:Seq>\n   </dc:creator>',
        ],
      ]),
    )
  })

  it('edits an existing other property, keeping its array form', () => {
    const key = otherEmbeddedKey(
      'xmp',
      'http://ns.adobe.com/lightroom/1.0/',
      'hierarchicalSubject',
    )
    const out = written(LIGHTROOM, { [key]: ['Places|Utah|Arches'] })
    expect(out).toBe(
      replaced(LIGHTROOM, [
        LR_METADATA_DATE,
        [
          '<rdf:li>Places|Utah|Moab</rdf:li>',
          '<rdf:li>Places|Utah|Arches</rdf:li>',
        ],
      ]),
    )
    expect(valueOf(readXmp(out), key)).toEqual(['Places|Utah|Arches'])
  })
})

describe('writeXmp: other keys', () => {
  const reference = other('photoshop', 'TransmissionReference')

  it('sets and removes a property that exists', () => {
    const set = written(PHOTOSHOP, { [reference]: 'JOB-2026-0924' })
    expect(valueOf(readXmp(set), reference)).toBe('JOB-2026-0924')
    const removed = written(PHOTOSHOP, { [reference]: null })
    expect(removed).not.toContain('TransmissionReference')
  })

  it('keeps pdfx custom properties editable', () => {
    const key = other('pdfx', 'Client')
    const out = written(ACROBAT, { [key]: 'Globex' }, PDF)
    expect(valueOf(readXmp(out, { profile: 'pdf' }), key)).toBe('Globex')
  })

  it('refuses a property the file does not hold', () => {
    expect(() =>
      writeXmp(PHOTOSHOP, { [other('photoshop', 'Category')]: 'x' }, IMAGE),
    ).toThrow(EmbeddedWriteError)
    expect(() =>
      writeXmp(PHOTOSHOP, { [other('photoshop', 'Category')]: null }, IMAGE),
    ).toThrow(EmbeddedWriteError)
    expect(() =>
      writeXmp(null, { [other('photoshop', 'Category')]: 'x' }, IMAGE),
    ).toThrow(EmbeddedWriteError)
  })

  it('refuses deny-listed, canonical and structured properties', () => {
    for (const key of [
      other('xmpMM', 'DocumentID'),
      other('photoshop', 'ColorMode'),
      other('xmp', 'MetadataDate'),
      other('dc', 'title'),
      other('exif', 'GPSLatitude'),
      other('Iptc4xmpCore', 'CreatorContactInfo'),
      'xmp|only-one-part',
    ]) {
      expect(() => writeXmp(PHOTOSHOP, { [key]: 'x' }, IMAGE)).toThrow(
        EmbeddedWriteError,
      )
    }
  })
})

describe('writeXmp: prefixes', () => {
  it('writes a new property under the prefix the file already bound', () => {
    const packet =
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
      ' <rdf:Description rdf:about="" xmlns:ps="http://ns.adobe.com/photoshop/1.0/">\n' +
      '  <ps:City>Oslo</ps:City>\n' +
      ' </rdf:Description>\n' +
      '</rdf:RDF>'
    const out = written(packet, { country: 'Norway', city: 'Bergen' })
    expect(out).toBe(
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
        ' <rdf:Description rdf:about="" xmlns:ps="http://ns.adobe.com/photoshop/1.0/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">\n' +
        '  <ps:City>Bergen</ps:City>\n' +
        '  <ps:Country>Norway</ps:Country>\n' +
        `  <xmp:MetadataDate>${STAMP}</xmp:MetadataDate>\n` +
        ' </rdf:Description>\n' +
        '</rdf:RDF>',
    )
  })

  it('picks a fresh prefix when the conventional one means something else', () => {
    const packet =
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:photoshop="urn:not-photoshop">' +
      '<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/"/></rdf:RDF>'
    const out = written(packet, { city: 'Lima' })
    expect(out).toContain(
      'xmlns:photoshop1="http://ns.adobe.com/photoshop/1.0/"',
    )
    expect(out).toContain('<photoshop1:City>Lima</photoshop1:City>')
    expect(valueOf(readXmp(out), 'city')).toBe('Lima')
  })

  it('follows exiftool’s single quotes and a compact packet’s lack of indentation', () => {
    const packet =
      "<x:xmpmeta xmlns:x='adobe:ns:meta/'><rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'>" +
      "<rdf:Description rdf:about='' xmlns:dc='http://purl.org/dc/elements/1.1/'><dc:format>image/png</dc:format></rdf:Description>" +
      '</rdf:RDF></x:xmpmeta>'
    const out = written(packet, { title: 'Compact' })
    expect(out).toBe(
      "<x:xmpmeta xmlns:x='adobe:ns:meta/'><rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'>" +
        "<rdf:Description rdf:about='' xmlns:dc='http://purl.org/dc/elements/1.1/' xmlns:xmp='http://ns.adobe.com/xap/1.0/'>" +
        '<dc:format>image/png</dc:format>' +
        "<dc:title><rdf:Alt><rdf:li xml:lang='x-default'>Compact</rdf:li></rdf:Alt></dc:title>" +
        `<xmp:MetadataDate>${STAMP}</xmp:MetadataDate>` +
        '</rdf:Description></rdf:RDF></x:xmpmeta>',
    )
  })

  it('reuses the separator of a packet written on one line', () => {
    // The shape of Photoshop's "Save for Web" and Apple's HEIC packets:
    // every node separated by one space, no line breaks at all.
    const packet =
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"> <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
      ' <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      ' <dc:rights> <rdf:Alt> <rdf:li xml:lang="x-default">Cody Cobb</rdf:li> </rdf:Alt> </dc:rights>' +
      ' </rdf:Description> </rdf:RDF> </x:xmpmeta>'
    const out = written(packet, { title: 'One line' })
    expect(out).toContain(
      '</dc:rights> <dc:title> <rdf:Alt> <rdf:li xml:lang="x-default">One line</rdf:li> </rdf:Alt> </dc:title>' +
        ` <xmp:MetadataDate>${STAMP}</xmp:MetadataDate> </rdf:Description>`,
    )
  })

  it('keeps CRLF line breaks when it adds lines', () => {
    const packet =
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\r\n' +
      ' <rdf:Description rdf:about="" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/">\r\n' +
      '  <photoshop:City>Oslo</photoshop:City>\r\n' +
      ' </rdf:Description>\r\n' +
      '</rdf:RDF>'
    const out = written(packet, { keywords: ['fjord'] })
    expect(out).toContain(
      '  <photoshop:City>Oslo</photoshop:City>\r\n  <dc:subject>\r\n   <rdf:Bag>\r\n    <rdf:li>fjord</rdf:li>\r\n   </rdf:Bag>\r\n  </dc:subject>\r\n',
    )
    expect(out).not.toContain('&#xD;')
  })
})

describe('writeXmp: shapes', () => {
  it('moves an array written as an attribute into an element', () => {
    // Non-conforming but seen: a lang-alt title as a plain attribute.
    const packet =
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
      ' <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"\n' +
      '   dc:title="Plain">\n' +
      ' </rdf:Description>\n' +
      '</rdf:RDF>'
    expect(valueOf(readXmp(packet), 'title')).toBe('Plain')
    const out = written(packet, { title: 'Proper' })
    expect(out).not.toContain('dc:title="')
    expect(out).toContain(
      '  <dc:title>\n   <rdf:Alt>\n    <rdf:li xml:lang="x-default">Proper</rdf:li>\n   </rdf:Alt>\n  </dc:title>',
    )
    expect(valueOf(readXmp(out), 'title')).toBe('Proper')
  })

  it('rebuilds a property that held the wrong kind of value', () => {
    const packet =
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      '<dc:subject>just one string</dc:subject><dc:title><rdf:Bag><rdf:li>a</rdf:li></rdf:Bag></dc:title></rdf:Description></rdf:RDF>'
    const out = written(packet, { keywords: ['x', 'y'], title: 'T' })
    expect(out).toContain(
      '<dc:subject><rdf:Bag><rdf:li>x</rdf:li><rdf:li>y</rdf:li></rdf:Bag></dc:subject>',
    )
    expect(out).toContain(
      '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">T</rdf:li></rdf:Alt></dc:title>',
    )
  })

  it('rebuilds an array whose items are structs rather than writing into them', () => {
    const packet =
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      '<dc:title><rdf:Alt><rdf:li rdf:parseType="Resource"><dc:x>odd</dc:x></rdf:li></rdf:Alt></dc:title></rdf:Description></rdf:RDF>'
    const out = written(packet, { title: 'Clean' })
    expect(out).toContain(
      '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Clean</rdf:li></rdf:Alt></dc:title>',
    )
    expect(out).not.toContain('parseType')
  })

  it('sets the first item of a language alternative that has no x-default', () => {
    const packet =
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      '<dc:title><rdf:Alt><rdf:li xml:lang="de">Hafen</rdf:li><rdf:li xml:lang="fr">Port</rdf:li></rdf:Alt></dc:title></rdf:Description></rdf:RDF>'
    const out = written(packet, { title: 'Harbor' })
    expect(out).toContain(
      '<rdf:li xml:lang="de">Harbor</rdf:li><rdf:li xml:lang="fr">Port</rdf:li>',
    )
    expect(valueOf(readXmp(out), 'title')).toBe('Harbor')
  })

  it('updates a URI written as rdf:resource in place', () => {
    const packet =
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/">' +
      '<xmpRights:WebStatement rdf:resource="https://old.example/"/></rdf:Description></rdf:RDF>'
    const out = written(packet, {
      webStatement: 'https://new.example/?a=1&b=2',
    })
    expect(out).toContain(
      '<xmpRights:WebStatement rdf:resource="https://new.example/?a=1&amp;b=2"/>',
    )
    expect(valueOf(readXmp(out), 'webStatement')).toBe(
      'https://new.example/?a=1&b=2',
    )
  })

  it('edits a property in the Description that holds it; adds to the first', () => {
    const packet =
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
      '<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Label="Blue"/>' +
      '<rdf:Description rdf:about="" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" photoshop:City="Rome"/>' +
      '</rdf:RDF>'
    const out = written(packet, { city: 'Milan', headline: 'New' })
    expect(out).toBe(
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
        // The declaration joins the others, ahead of the properties.
        '<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" xmp:Label="Blue">' +
        `<photoshop:Headline>New</photoshop:Headline><xmp:MetadataDate>${STAMP}</xmp:MetadataDate></rdf:Description>` +
        '<rdf:Description rdf:about="" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" photoshop:City="Milan"/>' +
        '</rdf:RDF>',
    )
  })

  it('creates a Description in an rdf:RDF that has none', () => {
    const packet =
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">\n <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n </rdf:RDF>\n</x:xmpmeta>'
    const out = written(packet, { city: 'Quito' })
    expect(out).toBe(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">\n <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
        '  <rdf:Description rdf:about="" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">\n' +
        '   <photoshop:City>Quito</photoshop:City>\n' +
        `   <xmp:MetadataDate>${STAMP}</xmp:MetadataDate>\n` +
        '  </rdf:Description>\n' +
        ' </rdf:RDF>\n</x:xmpmeta>',
    )
  })
})

describe('writeXmp: a fresh packet', () => {
  it('creates a standard, padded packet when the file has none', () => {
    const out = written(null, { title: 'First', keywords: ['a', 'b'] })
    expect(
      out.startsWith(
        '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/">',
      ),
    ).toBe(true)
    expect(out.endsWith(`</x:xmpmeta>\n${PADDING}<?xpacket end="w"?>`)).toBe(
      true,
    )
    expect(PADDING.length).toBeGreaterThanOrEqual(2000)
    const read = readXmp(out)
    expect(valueOf(read, 'title')).toBe('First')
    expect(valueOf(read, 'keywords')).toEqual(['a', 'b'])
    expect(out).toContain(`<xmp:MetadataDate>${STAMP}</xmp:MetadataDate>`)
    expect(out).toContain(
      '   <dc:title>\n    <rdf:Alt>\n     <rdf:li xml:lang="x-default">First</rdf:li>\n    </rdf:Alt>\n   </dc:title>\n',
    )
  })

  it('returns null when the patch only removes, or holds nothing for XMP', () => {
    expect(writeXmp(null, { title: null, gps: null }, IMAGE)).toBeNull()
    expect(writeXmp(null, { title: '  ', keywords: [] }, IMAGE)).toBeNull()
    expect(
      writeXmp(null, { 'png|Comment': 'x', subject: 's' }, IMAGE),
    ).toBeNull()
    expect(writeXmp(null, {}, IMAGE)).toBeNull()
  })
})

describe('writeXmp: the PDF profile', () => {
  it('writes keywords to pdf:Keywords, dates to xmp:, and stamps ModifyDate', () => {
    const out = written(
      ACROBAT,
      { keywords: ['annual', 'audit'], createdAt: '2024-01-15T08:00:00+01:00' },
      PDF,
    )
    expect(out).toBe(
      replaced(ACROBAT, [
        [
          '<xmp:CreateDate>2024-01-15T09:00:00+01:00</xmp:CreateDate>',
          '<xmp:CreateDate>2024-01-15T08:00:00+01:00</xmp:CreateDate>',
        ],
        [
          '<xmp:ModifyDate>2024-01-16T10:30:00+01:00</xmp:ModifyDate>',
          `<xmp:ModifyDate>${STAMP}</xmp:ModifyDate>`,
        ],
        [
          '<pdf:Keywords>annual; report, 2023</pdf:Keywords>',
          '<pdf:Keywords>annual, audit</pdf:Keywords>',
        ],
        [
          '            </rdf:Alt>\n         </dc:title>\n',
          `            </rdf:Alt>\n         </dc:title>\n         <xmp:MetadataDate>${STAMP}</xmp:MetadataDate>\n`,
        ],
      ]),
    )
    // No dc:subject was planted: the PDF did not have one.
    expect(out).not.toContain('dc:subject')
    const read = readXmp(out, { profile: 'pdf' })
    expect(valueOf(read, 'keywords')).toEqual(['annual', 'audit'])
    expect(valueOf(read, 'createdAt')).toBe('2024-01-15T08:00:00+01:00')
  })

  it('updates a dc:subject the PDF already has, and stamps even an empty patch', () => {
    const withSubject = ACROBAT.replace(
      '<dc:format>',
      '<dc:subject><rdf:Bag><rdf:li>old</rdf:li></rdf:Bag></dc:subject><dc:format>',
    )
    const out = written(withSubject, { keywords: ['new'] }, PDF)
    expect(out).toContain('<pdf:Keywords>new</pdf:Keywords>')
    expect(out).toContain('<rdf:Bag><rdf:li>new</rdf:li></rdf:Bag>')
    const stamped = written(ACROBAT, {}, PDF)
    expect(stamped).toContain(`<xmp:ModifyDate>${STAMP}</xmp:ModifyDate>`)
    expect(stamped).toContain(`<xmp:MetadataDate>${STAMP}</xmp:MetadataDate>`)
  })

  it('updates pdf:Keywords an image already has, in the image profile', () => {
    const image = ACROBAT.replace(
      '<dc:format>',
      '<dc:subject><rdf:Bag><rdf:li>old</rdf:li></rdf:Bag></dc:subject><dc:format>',
    )
    const out = written(image, { keywords: ['x', 'y'] })
    expect(out).toContain('<pdf:Keywords>x, y</pdf:Keywords>')
    expect(out).toContain(
      '<xmp:ModifyDate>2024-01-16T10:30:00+01:00</xmp:ModifyDate>',
    )
  })
})

describe('writeXmp: refusals', () => {
  it('refuses a packet it cannot parse, or one without rdf:RDF', () => {
    for (const bad of [
      '<!DOCTYPE x><x/>',
      PHOTOSHOP.slice(0, 500),
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"/>',
      'not xml & at all',
    ]) {
      expect(() => writeXmp(bad, { title: 'x' }, IMAGE)).toThrow(
        EmbeddedWriteError,
      )
    }
  })

  it('refuses values XML cannot carry, and malformed dates and ratings', () => {
    for (const patch of [
      { title: 'bell\u0007' },
      { keywords: ['ok', 'nul\u0000'] },
      { createdAt: 'last Tuesday' },
      { rating: '7' },
      { title: 42 as unknown as string },
    ]) {
      expect(() => writeXmp(PHOTOSHOP, patch, IMAGE)).toThrow(
        EmbeddedWriteError,
      )
    }
  })

  it('refuses to set GPS, or to edit a measured camera value', () => {
    expect(() => writeXmp(PHOTOSHOP, { gps: '1,2' }, IMAGE)).toThrow(
      EmbeddedWriteError,
    )
    for (const key of [
      'exposure',
      'aperture',
      'iso',
      'focalLength',
      'orientation',
    ]) {
      expect(() => writeXmp(PHOTOSHOP, { [key]: '1' }, IMAGE)).toThrow(
        EmbeddedWriteError,
      )
    }
  })

  it('refuses an invalid clock', () => {
    expect(() =>
      writeXmp(
        PHOTOSHOP,
        { title: 'x' },
        { profile: 'image', now: new Date(NaN) },
      ),
    ).toThrow(EmbeddedWriteError)
  })

  it('ignores keys another writer owns, and still stamps the packet', () => {
    const out = written(PHOTOSHOP, { comment: 'PNG only', 'png|Software': 'x' })
    expect(out).toBe(replaced(PHOTOSHOP, [PS_METADATA_DATE]))
  })
})
