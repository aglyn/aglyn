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
 * Reading and surgically editing an XMP packet (AGL-3331).
 *
 * XMP is RDF/XML (ISO 16684-1, "XMP Part 1"; Adobe's XMP Specification
 * Part 1 is the same text). The container writers — JPEG APP1, PNG iTXt,
 * WebP `XMP `, TIFF tag 700, a PDF `/Metadata` stream — hand this module
 * the packet as a string and take a string back; none of them parses it.
 *
 * ## Reading
 *
 * {@link readXmp} finds every `rdf:RDF` by namespace URI (prefixes are the
 * file's choice), reads each `rdf:Description` — properties written as
 * child elements AND as shorthand attributes — and folds the well-known
 * ones into canonical keys. Every other simple property, or array of
 * simple values, surfaces under an `xmp|<uri>|<local>` other key unless its
 * namespace is on the deny list of technical noise. Structured values
 * (structs, arrays of structs) are skipped: nothing here could edit them,
 * and a drawer row reading "[object]" helps nobody.
 *
 * ## Writing
 *
 * {@link writeXmp} edits the parsed DOM in place and serializes it with the
 * faithful serializer in `xml.ts`, so everything it did not touch — a
 * Lightroom develop history, face regions, the packet's padding — comes
 * out byte for byte. A property is changed where it lives (attribute or
 * element, whichever Description holds it); a new one is appended to the
 * first `rdf:Description` as an element, indented like its neighbors.
 */

import {
  embeddedFieldLabel,
  otherEmbeddedKey,
  parseOtherEmbeddedKey,
} from '../media-embedded-fields'
import {
  type EmbeddedCandidate,
  type EmbeddedPatch,
  EmbeddedWriteError,
} from './types'
import {
  attributeNamespace,
  createElement,
  createText,
  createWhitespace,
  elementChildren,
  hasNonXmlCharacters,
  insertChildren,
  isNamespaceDeclaration,
  isWhitespaceText,
  parseXml,
  prefixForNamespace,
  removeAttribute,
  replaceChildren,
  resolvePrefix,
  serializeXml,
  setAttribute,
  setTextContent,
  splitQName,
  textContent,
  walkElements,
  XML_NAMESPACE,
  type XmlAttribute,
  type XmlDocument,
  type XmlElement,
  type XmlNode,
} from './xml'

/** Namespace URIs, by the prefix their specifications use. */
export const XMP_NAMESPACES = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  x: 'adobe:ns:meta/',
  dc: 'http://purl.org/dc/elements/1.1/',
  xmp: 'http://ns.adobe.com/xap/1.0/',
  xmpRights: 'http://ns.adobe.com/xap/1.0/rights/',
  xmpMM: 'http://ns.adobe.com/xap/1.0/mm/',
  xmpidq: 'http://ns.adobe.com/xmp/Identifier/qual/1.0/',
  xmpNote: 'http://ns.adobe.com/xmp/note/',
  xmpG: 'http://ns.adobe.com/xap/1.0/g/',
  xmpGImg: 'http://ns.adobe.com/xap/1.0/g/img/',
  xmpTPg: 'http://ns.adobe.com/xap/1.0/t/pg/',
  stEvt: 'http://ns.adobe.com/xap/1.0/sType/ResourceEvent#',
  stRef: 'http://ns.adobe.com/xap/1.0/sType/ResourceRef#',
  stDim: 'http://ns.adobe.com/xap/1.0/sType/Dimensions#',
  stFnt: 'http://ns.adobe.com/xap/1.0/sType/Font#',
  stArea: 'http://ns.adobe.com/xmp/sType/Area#',
  photoshop: 'http://ns.adobe.com/photoshop/1.0/',
  illustrator: 'http://ns.adobe.com/illustrator/1.0/',
  crs: 'http://ns.adobe.com/camera-raw-settings/1.0/',
  crss: 'http://ns.adobe.com/camera-raw-saved-settings/1.0/',
  tiff: 'http://ns.adobe.com/tiff/1.0/',
  exif: 'http://ns.adobe.com/exif/1.0/',
  exifEX: 'http://cipa.jp/exif/1.0/',
  aux: 'http://ns.adobe.com/exif/1.0/aux/',
  pdf: 'http://ns.adobe.com/pdf/1.3/',
  pdfx: 'http://ns.adobe.com/pdfx/1.3/',
  Iptc4xmpCore: 'http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/',
  'mwg-rs': 'http://www.metadataworkinggroup.com/schemas/regions/',
  cc: 'http://creativecommons.org/ns#',
} as const

const NS = XMP_NAMESPACES
const RDF = NS.rdf

/**
 * The prefix a NEW declaration uses for a namespace this module writes.
 * An existing binding of the URI, under any prefix, always wins.
 */
const CONVENTIONAL_PREFIX: Readonly<Record<string, string>> = {
  [NS.dc]: 'dc',
  [NS.photoshop]: 'photoshop',
  [NS.xmp]: 'xmp',
  [NS.xmpRights]: 'xmpRights',
  [NS.tiff]: 'tiff',
  [NS.exif]: 'exif',
  [NS.exifEX]: 'exifEX',
  [NS.aux]: 'aux',
  [NS.pdf]: 'pdf',
  [NS.Iptc4xmpCore]: 'Iptc4xmpCore',
}

/**
 * Read-side only: the URI an UNDECLARED prefix is taken to mean. An SVG's
 * `<metadata>` fragment is often cut out from under the `<svg>` element
 * that declared `rdf:` and `dc:`; without this, that fragment reads as
 * nothing at all. A declared prefix always resolves through its
 * declaration.
 */
const FALLBACK_NAMESPACE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(NS),
)

/** Namespaces too noisy or technical to show as "other" fields. */
const DENIED_NAMESPACES: ReadonlySet<string> = new Set([
  NS.xmpMM,
  NS.stEvt,
  NS.stRef,
  NS.crs,
  NS.crss,
  NS.xmpNote,
  NS.xmpG,
  NS.xmpGImg,
  NS.xmpTPg,
  NS.stDim,
  NS.stFnt,
  NS.illustrator,
  NS['mwg-rs'],
  NS.stArea,
  NS.exif,
  NS.exifEX,
  NS.tiff,
  NS.aux,
  NS.xmpidq,
  NS.x,
])

/**
 * Single properties that are noise in a namespace that is otherwise kept.
 * `xmp:MetadataDate` is here because {@link writeXmp} stamps it on every
 * write, so an edit of it could never stick; the two digests are hashes
 * Photoshop uses to detect out-of-band edits; `pdf:PDFVersion` restates the
 * header version the PDF reader already reports as `pdfVersion`.
 */
const DENIED_PROPERTIES: ReadonlySet<string> = new Set([
  propertyId(NS.photoshop, 'DocumentAncestors'),
  propertyId(NS.photoshop, 'ColorMode'),
  propertyId(NS.photoshop, 'ICCProfile'),
  propertyId(NS.photoshop, 'History'),
  propertyId(NS.photoshop, 'LegacyIPTCDigest'),
  propertyId(NS.photoshop, 'EmbeddedXMPDigest'),
  propertyId(NS.xmp, 'MetadataDate'),
  propertyId(NS.pdf, 'PDFVersion'),
])

function propertyId(uri: string, local: string): string {
  return `${uri}\u0000${local}`
}

export type XmpProfile = 'image' | 'pdf'

export interface XmpReadOptions {
  /**
   * `pdf` reads `createdAt` from `xmp:CreateDate` only, as a PDF's XMP
   * mirrors the document info's `/CreationDate` there. Default `image`.
   */
  profile?: XmpProfile
}

export interface XmpWriteOptions {
  profile: XmpProfile
  /** The instant stamped into `xmp:MetadataDate` (and PDF ModifyDate). */
  now: Date
}

// ---------------------------------------------------------------------------
// The RDF model, as far as XMP uses it (XMP Part 1, §7 "XMP data model"
// and §7.9 "Serialization in RDF").
// ---------------------------------------------------------------------------

/** One property occurrence, where it lives. */
interface XmpProperty {
  description: XmlElement
  uri: string
  local: string
  /** The prefix as written, for labels and for re-adding in place. */
  prefix: string
  attribute?: XmlAttribute
  element?: XmlElement
}

type XmpArrayKind = 'alt' | 'bag' | 'seq'
type XmpShape = 'simple' | XmpArrayKind

interface XmpItem {
  value: string
  lang: string | null
}

type XmpValue =
  | { kind: 'simple'; value: string }
  | { kind: 'array'; container: XmpArrayKind; items: XmpItem[] }
  | { kind: 'struct' }

/** A namespace URI for `prefix` at `element`, falling back as above. */
function resolveNs(element: XmlElement, prefix: string): string | null {
  const bound = resolvePrefix(element, prefix)
  if (bound !== null) return bound
  return prefix &&
    Object.prototype.hasOwnProperty.call(FALLBACK_NAMESPACE, prefix)
    ? (FALLBACK_NAMESPACE[prefix] ?? null)
    : null
}

function elementNs(element: XmlElement): string | null {
  return resolveNs(element, splitQName(element.name).prefix)
}

function attrNs(element: XmlElement, attr: XmlAttribute): string | null {
  if (isNamespaceDeclaration(attr)) return attributeNamespace(element, attr)
  const { prefix } = splitQName(attr.name)
  return prefix ? resolveNs(element, prefix) : null
}

function isRdf(element: XmlElement, local: string): boolean {
  return splitQName(element.name).local === local && elementNs(element) === RDF
}

/** An `rdf:`-namespaced attribute by local name, whatever its prefix. */
function rdfAttribute(
  element: XmlElement,
  local: string,
): XmlAttribute | undefined {
  return element.attributes.find(
    (attr) =>
      splitQName(attr.name).local === local && attrNs(element, attr) === RDF,
  )
}

function langOf(element: XmlElement): string | null {
  const attr = element.attributes.find(
    (candidate) =>
      splitQName(candidate.name).local === 'lang' &&
      attrNs(element, candidate) === XML_NAMESPACE,
  )
  return attr ? attr.value : null
}

/**
 * Attributes on a property element that make it a struct in RDF's
 * shorthand (XMP Part 1 §7.9.2.5, "property attributes of an empty
 * property element"): anything other than a namespace declaration, an
 * `xml:` attribute or an `rdf:` one.
 */
function hasFieldAttributes(element: XmlElement): boolean {
  return element.attributes.some((attr) => {
    if (isNamespaceDeclaration(attr)) return false
    const uri = attrNs(element, attr)
    return uri !== XML_NAMESPACE && uri !== RDF
  })
}

/** Every `rdf:RDF`, outermost only, in document order. */
function findRdfRoots(doc: XmlDocument): XmlElement[] {
  const roots: XmlElement[] = []
  walkElements(doc, (element) => {
    if (isRdf(element, 'RDF')) {
      roots.push(element)
      return false
    }
    return true
  })
  return roots
}

/**
 * The node elements that describe THIS resource: every `rdf:Description`,
 * plus a typed node (`<cc:Work rdf:about="">`, what Inkscape writes into
 * an SVG) whose subject is the empty URI. A typed node about some other
 * resource — a `cc:License` — describes that resource, not the file.
 */
function descriptionsOf(rdf: XmlElement): XmlElement[] {
  return elementChildren(rdf).filter((node) => {
    if (isRdf(node, 'Description')) return true
    if (elementNs(node) === RDF) return false
    return rdfAttribute(node, 'about')?.value === ''
  })
}

/** A Description's properties, attributes first, in source order. */
function propertiesOf(description: XmlElement): XmpProperty[] {
  const out: XmpProperty[] = []
  for (const attr of description.attributes) {
    if (isNamespaceDeclaration(attr)) continue
    const { prefix, local } = splitQName(attr.name)
    if (!prefix) continue
    const uri = resolveNs(description, prefix)
    if (!uri || uri === RDF || uri === XML_NAMESPACE) continue
    out.push({ description, uri, local, prefix, attribute: attr })
  }
  for (const element of elementChildren(description)) {
    const uri = elementNs(element)
    if (!uri || uri === RDF || uri === XML_NAMESPACE) continue
    const { prefix, local } = splitQName(element.name)
    out.push({ description, uri, local, prefix, element })
  }
  return out
}

/** The one `rdf:Alt`/`Bag`/`Seq` an array property holds, if that is all. */
function arrayContainer(
  element: XmlElement,
): { node: XmlElement; kind: XmpArrayKind } | null {
  const children = elementChildren(element)
  const only = children[0]
  if (children.length !== 1 || !only) return null
  if (isRdf(only, 'Alt')) return { node: only, kind: 'alt' }
  if (isRdf(only, 'Bag')) return { node: only, kind: 'bag' }
  if (isRdf(only, 'Seq')) return { node: only, kind: 'seq' }
  return null
}

function arrayItems(container: XmlElement): XmlElement[] {
  return elementChildren(container).filter((node) => isRdf(node, 'li'))
}

/**
 * Classify a property's value (XMP Part 1 §7.9.2): a simple value (text,
 * or a URI in `rdf:resource`), an array of simple values, or anything
 * structured — `rdf:parseType="Resource"`, a nested Description, field
 * attributes, an array whose items are structs.
 */
function readValue(property: XmpProperty): XmpValue {
  if (property.attribute) {
    return { kind: 'simple', value: property.attribute.value }
  }
  const element = property.element
  if (!element || rdfAttribute(element, 'parseType')) return { kind: 'struct' }
  const children = elementChildren(element)
  if (!children.length) {
    if (hasFieldAttributes(element)) return { kind: 'struct' }
    const resource = rdfAttribute(element, 'resource')
    return {
      kind: 'simple',
      value: resource ? resource.value : textContent(element),
    }
  }
  const container = arrayContainer(element)
  if (!container) return { kind: 'struct' }
  const items: XmpItem[] = []
  for (const li of arrayItems(container.node)) {
    if (
      rdfAttribute(li, 'parseType') ||
      elementChildren(li).length ||
      hasFieldAttributes(li)
    ) {
      return { kind: 'struct' }
    }
    const resource = rdfAttribute(li, 'resource')
    items.push({
      value: resource ? resource.value : textContent(li),
      lang: langOf(li),
    })
  }
  return { kind: 'array', container: container.kind, items }
}

/**
 * The one value of a language alternative a reader shows: `x-default`,
 * else the first item (XMP Part 1 §8.2.2.4, "Language alternatives").
 */
function pickAlternative(items: XmpItem[]): string {
  const preferred = items.find(
    (item) => item.lang?.toLowerCase() === 'x-default',
  )
  return (preferred ?? items[0])?.value ?? ''
}

function asText(value: XmpValue): string | null {
  switch (value.kind) {
    case 'simple':
      return value.value.trim() || null
    case 'array': {
      const text =
        value.container === 'alt'
          ? pickAlternative(value.items).trim()
          : value.items
              .map((item) => item.value.trim())
              .filter(Boolean)
              .join(', ')
      return text || null
    }
    default:
      return null
  }
}

function asList(value: XmpValue): string[] | null {
  let items: string[]
  if (value.kind === 'simple') items = [value.value]
  else if (value.kind === 'array') {
    items =
      value.container === 'alt'
        ? [pickAlternative(value.items)]
        : value.items.map((item) => item.value)
  } else return null
  const out = items.map((item) => item.trim()).filter(Boolean)
  return out.length ? out : null
}

// ---------------------------------------------------------------------------
// Value formats (see the doc comment on MEDIA_EMBEDDED_CATALOG).
// ---------------------------------------------------------------------------

/**
 * An XMP date (XMP Part 1 §8.2.1.1: ISO 8601 as profiled by the W3C
 * datetime note) in the catalog's format. Fractional seconds are cut to
 * milliseconds, a `+0200` zone gains its colon, and the EXIF spelling
 * `2021:05:03 10:11:12` some writers put in XMP is accepted. A zone is
 * kept only when the file wrote one. Reduced precision (`2021`,
 * `2021-05`) is returned as written — a month cannot be invented.
 */
export function normalizeXmpDate(raw: string): string | null {
  const text = raw.trim()
  if (/^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/.test(text)) return text
  const match =
    /^(\d{4})[-:](\d{2})[-:](\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(
      text,
    )
  if (!match) return null
  const [, year, month, day, hour, minute, second, fraction, zone] = match
  if (!year || !month || !day) return null
  const m = Number(month)
  const d = Number(day)
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  let out = `${year}-${month}-${day}`
  if (hour === undefined || minute === undefined) return out
  if (Number(hour) > 23 || Number(minute) > 59) return null
  out += `T${hour}:${minute}`
  if (second !== undefined) {
    if (Number(second) > 60) return null
    out += `:${second}`
    if (fraction) out += `.${fraction.slice(0, 3)}`
  }
  if (zone) {
    if (zone.toUpperCase() === 'Z') out += 'Z'
    else {
      const digits = zone.replace(':', '')
      const hours = Number(digits.slice(1, 3))
      const minutes = Number(digits.slice(3, 5))
      if (hours > 23 || minutes > 59) return null
      out += `${digits.slice(0, 3)}:${digits.slice(3, 5)}`
    }
  }
  return out
}

/** `"0"`–`"5"`, or `"-1"` for rejected (XMP Part 2, `xmp:Rating`). */
function normalizeRating(raw: string): string | null {
  const text = raw.trim()
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null
  const rating = Math.round(Number(text))
  return rating >= -1 && rating <= 5 ? String(rating) : null
}

/** An EXIF rational as XMP writes it (`"28/10"`) or a plain decimal. */
function parseRational(raw: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?\s*$/.exec(raw)
  if (!match || match[1] === undefined) return null
  const numerator = Number(match[1])
  const denominator = match[2] === undefined ? 1 : Number(match[2])
  if (!denominator) return null
  const value = numerator / denominator
  return Number.isFinite(value) ? value : null
}

function trimNumber(value: number, places: number): string {
  return String(Number(value.toFixed(places)))
}

/**
 * `1/250 s`. Below a quarter second as a reciprocal, above it as decimal
 * seconds — the convention photographers read, and exiftool's.
 */
function formatExposure(raw: string): string | null {
  const seconds = parseRational(raw)
  if (seconds === null || seconds <= 0) return null
  if (seconds < 0.25001) return `1/${Math.round(1 / seconds)} s`
  return `${trimNumber(seconds, 1)} s`
}

function formatAperture(raw: string): string | null {
  const value = parseRational(raw)
  return value && value > 0 ? `f/${trimNumber(value, 1)}` : null
}

function formatFocalLength(raw: string): string | null {
  const value = parseRational(raw)
  return value && value > 0 ? `${trimNumber(value, 1)} mm` : null
}

/** TIFF 6.0 tag 274 / EXIF 2.32 §4.6.4 A "Orientation", as exiftool words it. */
const ORIENTATIONS: Readonly<Record<string, string>> = {
  '1': 'Horizontal (normal)',
  '2': 'Mirror horizontal',
  '3': 'Rotate 180',
  '4': 'Mirror vertical',
  '5': 'Mirror horizontal and rotate 270 CW',
  '6': 'Rotate 90 CW',
  '7': 'Mirror horizontal and rotate 90 CW',
  '8': 'Rotate 270 CW',
}

/**
 * One GPS coordinate in the XMP form (XMP Part 2 / EXIF-in-XMP,
 * "GPSCoordinate"): `DDD,MM.mmmmk` or `DDD,MM,SSk` with k one of NSEW.
 * A bare signed decimal is tolerated. Null when out of range or on the
 * wrong axis (an `E` latitude).
 */
function parseGpsCoordinate(raw: string, axis: 'lat' | 'lon'): number | null {
  const text = raw.trim()
  let value: number
  const match =
    /^(\d{1,3}(?:\.\d+)?)(?:,(\d{1,2}(?:\.\d+)?)(?:,(\d{1,2}(?:\.\d+)?))?)?\s*([NSEWnsew])$/.exec(
      text,
    )
  if (match && match[1] !== undefined && match[4] !== undefined) {
    const degrees = Number(match[1])
    const minutes = match[2] === undefined ? 0 : Number(match[2])
    const seconds = match[3] === undefined ? 0 : Number(match[3])
    if (minutes >= 60 || seconds >= 60) return null
    const ref = match[4].toUpperCase()
    if (axis === 'lat' ? !'NS'.includes(ref) : !'EW'.includes(ref)) return null
    value = degrees + minutes / 60 + seconds / 3600
    if (ref === 'S' || ref === 'W') value = -value
  } else if (/^-?\d{1,3}(?:\.\d+)?$/.test(text)) {
    value = Number(text)
  } else return null
  const limit = axis === 'lat' ? 90 : 180
  if (!Number.isFinite(value) || Math.abs(value) > limit) return null
  return value
}

function formatDegrees(value: number): string {
  // Never print "-0.000000".
  return (Math.abs(value) < 5e-7 ? 0 : value).toFixed(6)
}

// ---------------------------------------------------------------------------
// The canonical mapping.
// ---------------------------------------------------------------------------

type ValueReader = (value: XmpValue) => string | string[] | null

const readText: ValueReader = asText
const readList: ValueReader = asList
const readDate: ValueReader = (value) => {
  const text = asText(value)
  return text ? normalizeXmpDate(text) : null
}
const readRating: ValueReader = (value) => {
  const text = asText(value)
  return text ? normalizeRating(text) : null
}
/** `pdf:Keywords` is one string (PDF 2.0 §14.3.3, Keywords). */
const readKeywordString: ValueReader = (value) => {
  const text = asText(value)
  if (!text) return null
  const items = [
    ...new Set(
      text
        .split(/[,;]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ]
  return items.length ? items : null
}
const formatted =
  (format: (raw: string) => string | null): ValueReader =>
  (value) => {
    const text = asText(value)
    return text ? format(text) : null
  }
/** A single number that may arrive as a one-item `rdf:Seq`. */
const readIso: ValueReader = (value) => {
  const first =
    value.kind === 'simple'
      ? value.value
      : value.kind === 'array'
        ? value.items[0]?.value
        : undefined
  const text = first?.trim()
  return text && /^\d+$/.test(text) ? String(Number(text)) : null
}

interface ReadSource {
  uri: string
  local: string
  read: ValueReader
}

interface CanonicalRead {
  key: string
  sources: ReadSource[]
}

const src = (uri: string, local: string, read: ValueReader): ReadSource => ({
  uri,
  local,
  read,
})

/** Canonical key → where XMP keeps it, strongest source first. */
function canonicalReads(profile: XmpProfile): CanonicalRead[] {
  return [
    { key: 'title', sources: [src(NS.dc, 'title', readText)] },
    { key: 'headline', sources: [src(NS.photoshop, 'Headline', readText)] },
    { key: 'description', sources: [src(NS.dc, 'description', readText)] },
    {
      key: 'keywords',
      sources: [
        src(NS.dc, 'subject', readList),
        src(NS.pdf, 'Keywords', readKeywordString),
      ],
    },
    {
      key: 'instructions',
      sources: [src(NS.photoshop, 'Instructions', readText)],
    },
    { key: 'label', sources: [src(NS.xmp, 'Label', readText)] },
    { key: 'rating', sources: [src(NS.xmp, 'Rating', readRating)] },
    { key: 'creator', sources: [src(NS.dc, 'creator', readList)] },
    { key: 'copyright', sources: [src(NS.dc, 'rights', readText)] },
    { key: 'credit', sources: [src(NS.photoshop, 'Credit', readText)] },
    { key: 'source', sources: [src(NS.photoshop, 'Source', readText)] },
    {
      key: 'usageTerms',
      sources: [src(NS.xmpRights, 'UsageTerms', readText)],
    },
    {
      key: 'webStatement',
      sources: [src(NS.xmpRights, 'WebStatement', readText)],
    },
    { key: 'city', sources: [src(NS.photoshop, 'City', readText)] },
    { key: 'state', sources: [src(NS.photoshop, 'State', readText)] },
    { key: 'country', sources: [src(NS.photoshop, 'Country', readText)] },
    {
      key: 'createdAt',
      sources:
        profile === 'pdf'
          ? [src(NS.xmp, 'CreateDate', readDate)]
          : [
              src(NS.photoshop, 'DateCreated', readDate),
              src(NS.exif, 'DateTimeOriginal', readDate),
              src(NS.xmp, 'CreateDate', readDate),
            ],
    },
    { key: 'make', sources: [src(NS.tiff, 'Make', readText)] },
    { key: 'model', sources: [src(NS.tiff, 'Model', readText)] },
    {
      key: 'lens',
      sources: [
        src(NS.exifEX, 'LensModel', readText),
        src(NS.aux, 'Lens', readText),
      ],
    },
    {
      key: 'exposure',
      sources: [src(NS.exif, 'ExposureTime', formatted(formatExposure))],
    },
    {
      key: 'aperture',
      sources: [src(NS.exif, 'FNumber', formatted(formatAperture))],
    },
    {
      key: 'iso',
      sources: [
        src(NS.exifEX, 'PhotographicSensitivity', readIso),
        src(NS.exif, 'ISOSpeedRatings', readIso),
      ],
    },
    {
      key: 'focalLength',
      sources: [src(NS.exif, 'FocalLength', formatted(formatFocalLength))],
    },
    { key: 'modifiedAt', sources: [src(NS.xmp, 'ModifyDate', readDate)] },
    { key: 'software', sources: [src(NS.xmp, 'CreatorTool', readText)] },
    { key: 'producer', sources: [src(NS.pdf, 'Producer', readText)] },
    {
      key: 'orientation',
      sources: [
        src(
          NS.tiff,
          'Orientation',
          formatted((raw) => ORIENTATIONS[raw.trim()] ?? null),
        ),
      ],
    },
  ]
}

/**
 * Every property the canonical mapping owns, in either profile. None of
 * them is ever offered as an "other" field — a shadowed fallback (an
 * `xmp:CreateDate` beside a `photoshop:DateCreated`) is the same idea as
 * the field that won, not a second field.
 */
const CLAIMED_PROPERTIES: ReadonlySet<string> = new Set(
  [...canonicalReads('image'), ...canonicalReads('pdf')].flatMap((entry) =>
    entry.sources.map((source) => propertyId(source.uri, source.local)),
  ),
)

/** Whether `(uri, local)` may be read or written as an "other" field. */
function isOtherProperty(uri: string, local: string): boolean {
  if (DENIED_NAMESPACES.has(uri)) return false
  const id = propertyId(uri, local)
  if (DENIED_PROPERTIES.has(id) || CLAIMED_PROPERTIES.has(id)) return false
  // The other key is `|`-delimited; a URI containing one could not
  // round-trip through parseOtherEmbeddedKey.
  return !uri.includes('|') && !local.includes('|')
}

// ---------------------------------------------------------------------------
// readXmp
// ---------------------------------------------------------------------------

interface ParsedPacket {
  doc: XmlDocument
  roots: XmlElement[]
  descriptions: XmlElement[]
}

function openPacket(packet: string): ParsedPacket | null {
  const doc = parseXml(packet)
  if (!doc) return null
  const roots = findRdfRoots(doc)
  return { doc, roots, descriptions: roots.flatMap(descriptionsOf) }
}

function findProperties(
  descriptions: XmlElement[],
  uri: string,
  local: string,
): XmpProperty[] {
  return descriptions.flatMap((description) =>
    propertiesOf(description).filter(
      (property) => property.uri === uri && property.local === local,
    ),
  )
}

/**
 * Read an XMP packet into candidates. Accepts a whole packet (`<?xpacket`
 * wrapper and `x:xmpmeta`), a bare `x:xmpmeta`, or a bare `rdf:RDF`
 * fragment. Never throws; unreadable input yields `[]`.
 */
export function readXmp(
  packet: string,
  options: XmpReadOptions = {},
): EmbeddedCandidate[] {
  try {
    return read(packet, options.profile ?? 'image')
  } catch {
    // Defensive: the parser and walkers do not throw, and a reader of
    // hostile bytes must degrade to "nothing found" if one ever does.
    return []
  }
}

function read(packet: string, profile: XmpProfile): EmbeddedCandidate[] {
  if (typeof packet !== 'string') return []
  const parsed = openPacket(packet)
  if (!parsed) return []
  const properties = parsed.descriptions.flatMap(propertiesOf)
  const byId = new Map<string, XmpProperty[]>()
  for (const property of properties) {
    const id = propertyId(property.uri, property.local)
    const list = byId.get(id)
    if (list) list.push(property)
    else byId.set(id, [property])
  }

  const out: EmbeddedCandidate[] = []
  for (const { key, sources } of canonicalReads(profile)) {
    const value = firstValue(byId, sources)
    if (value !== null) out.push({ key, value, source: 'xmp' })
  }

  const gps = readGps(byId)
  if (gps) out.push({ key: 'gps', value: gps, source: 'xmp' })

  const seen = new Set<string>()
  for (const property of properties) {
    if (!isOtherProperty(property.uri, property.local)) continue
    const key = otherEmbeddedKey('xmp', property.uri, property.local)
    if (seen.has(key)) continue
    const value = readValue(property)
    let shown: string | string[] | null = null
    if (value.kind === 'simple') shown = value.value.trim() || null
    else if (value.kind === 'array') {
      shown =
        value.container === 'alt' ? asText(value) : (asList(value) ?? null)
    }
    if (shown === null) continue
    seen.add(key)
    out.push({
      key,
      value: shown,
      source: 'xmp',
      label: `${property.prefix || CONVENTIONAL_PREFIX[property.uri] || 'xmp'}:${property.local}`,
    })
  }
  return out
}

function firstValue(
  byId: Map<string, XmpProperty[]>,
  sources: ReadSource[],
): string | string[] | null {
  for (const source of sources) {
    for (const property of byId.get(propertyId(source.uri, source.local)) ??
      []) {
      const value = source.read(readValue(property))
      if (value !== null) return value
    }
  }
  return null
}

function readGps(byId: Map<string, XmpProperty[]>): string | null {
  const coordinate = (local: string, axis: 'lat' | 'lon'): number | null => {
    for (const property of byId.get(propertyId(NS.exif, local)) ?? []) {
      const text = asText(readValue(property))
      const value = text ? parseGpsCoordinate(text, axis) : null
      if (value !== null) return value
    }
    return null
  }
  const lat = coordinate('GPSLatitude', 'lat')
  const lon = coordinate('GPSLongitude', 'lon')
  return lat === null || lon === null
    ? null
    : `${formatDegrees(lat)},${formatDegrees(lon)}`
}

// ---------------------------------------------------------------------------
// writeXmp
// ---------------------------------------------------------------------------

interface WriteTarget {
  uri: string
  local: string
  shape: XmpShape
  /**
   * Whether the property is added when the packet does not hold it.
   * False for the MWG "update every copy that exists" fan-out: an edit of
   * the date taken rewrites an `exif:DateTimeOriginal` that is there, and
   * does not invent one that is not.
   */
  create: boolean
}

const target = (
  uri: string,
  local: string,
  shape: XmpShape,
  create = true,
): WriteTarget => ({ uri, local, shape, create })

/** Canonical key → the properties an edit of it writes, per profile. */
function canonicalWrites(profile: XmpProfile): Record<string, WriteTarget[]> {
  const pdf = profile === 'pdf'
  return {
    title: [target(NS.dc, 'title', 'alt')],
    description: [target(NS.dc, 'description', 'alt')],
    creator: [target(NS.dc, 'creator', 'seq')],
    copyright: [target(NS.dc, 'rights', 'alt')],
    keywords: pdf
      ? [
          target(NS.pdf, 'Keywords', 'simple'),
          target(NS.dc, 'subject', 'bag', false),
        ]
      : [
          target(NS.dc, 'subject', 'bag'),
          target(NS.pdf, 'Keywords', 'simple', false),
        ],
    headline: [target(NS.photoshop, 'Headline', 'simple')],
    credit: [target(NS.photoshop, 'Credit', 'simple')],
    source: [target(NS.photoshop, 'Source', 'simple')],
    instructions: [target(NS.photoshop, 'Instructions', 'simple')],
    city: [target(NS.photoshop, 'City', 'simple')],
    state: [target(NS.photoshop, 'State', 'simple')],
    country: [target(NS.photoshop, 'Country', 'simple')],
    createdAt: pdf
      ? [target(NS.xmp, 'CreateDate', 'simple')]
      : [
          target(NS.photoshop, 'DateCreated', 'simple'),
          target(NS.exif, 'DateTimeOriginal', 'simple', false),
          target(NS.xmp, 'CreateDate', 'simple', false),
        ],
    modifiedAt: [target(NS.xmp, 'ModifyDate', 'simple')],
    software: [target(NS.xmp, 'CreatorTool', 'simple')],
    producer: [target(NS.pdf, 'Producer', 'simple')],
    label: [target(NS.xmp, 'Label', 'simple')],
    rating: [target(NS.xmp, 'Rating', 'simple')],
    usageTerms: [target(NS.xmpRights, 'UsageTerms', 'alt')],
    webStatement: [target(NS.xmpRights, 'WebStatement', 'simple')],
    make: [target(NS.tiff, 'Make', 'simple')],
    model: [target(NS.tiff, 'Model', 'simple')],
    lens: [
      target(NS.exifEX, 'LensModel', 'simple'),
      target(NS.aux, 'Lens', 'simple', false),
    ],
  }
}

/**
 * Canonical keys XMP holds but nobody edits: they describe how the bytes
 * were captured. Asking to write one is a caller bug, and says so.
 */
const READ_ONLY_KEYS: ReadonlySet<string> = new Set([
  'exposure',
  'aperture',
  'iso',
  'focalLength',
  'orientation',
])

/** An XMP date (XMP Part 1 §8.2.1.1), the only thing a date field takes. */
const XMP_DATE =
  /^\d{4}(?:-\d{2}(?:-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?)?)?$/

/** The packet {@link writeXmp} starts from when a file has none. */
const PACKET_HEADER =
  '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n' +
  '<x:xmpmeta xmlns:x="adobe:ns:meta/">\n' +
  ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
  '  <rdf:Description rdf:about="">\n' +
  '  </rdf:Description>\n' +
  ' </rdf:RDF>\n' +
  '</x:xmpmeta>\n'
/**
 * Padding lets a later editor grow the packet in place without moving the
 * bytes after it (XMP Part 3 §1.1.1 recommends about 2 KB). Twenty lines
 * of 100 spaces is what Adobe's toolkit writes.
 */
const PACKET_PADDING = (' '.repeat(100) + '\n').repeat(20)
const PACKET_TRAILER = '<?xpacket end="w"?>'

type WriteOp =
  | {
      type: 'canonical'
      label: string
      targets: WriteTarget[]
      value: string | string[] | null
    }
  | { type: 'gps' }
  | {
      type: 'other'
      label: string
      uri: string
      local: string
      value: string | string[] | null
    }

/**
 * Apply `patch` to `packet` and return the new packet.
 *
 * - `null` removes a key; a string or string[] sets it. An empty string or
 *   list is a removal.
 * - Canonical keys fan out as {@link canonicalWrites} lists them. Keys XMP
 *   has no place for (`subject`, a `png|…` key) are ignored — the patch is
 *   shared with the file's other writers — and the camera's measurements
 *   (`exposure`, …) throw.
 * - `gps: null` removes every `exif:GPS*` property. Setting it throws.
 * - An `xmp|<uri>|<local>` key edits or removes a property that already
 *   exists; one that does not, or that the reader would never offer,
 *   throws.
 * - `xmp:MetadataDate` is set to `now` on every write; in the `pdf`
 *   profile `xmp:ModifyDate` is too, unless the patch sets `modifiedAt`.
 * - With `packet === null`, a fresh packet is created if the patch sets
 *   anything XMP holds; otherwise the result is `null`.
 *
 * Throws {@link EmbeddedWriteError} when the packet cannot be parsed, has
 * no `rdf:RDF`, or the edit is not one XMP can take. Never returns a
 * packet it could not re-read.
 */
export function writeXmp(
  packet: string | null,
  patch: EmbeddedPatch,
  options: XmpWriteOptions,
): string | null {
  const { profile, now } = options
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new EmbeddedWriteError('The time of the edit is not a valid date.')
  }
  const ops = planWrite(patch, profile)
  const sets = ops.some((op) => op.type !== 'gps' && op.value !== null)

  if (packet === null) {
    const other = ops.find((op) => op.type === 'other')
    if (other?.type === 'other') {
      throw new EmbeddedWriteError(
        `${other.label} is not in this file's XMP metadata.`,
      )
    }
    if (!sets) return null
  }

  const source =
    packet === null ? PACKET_HEADER + PACKET_PADDING + PACKET_TRAILER : packet
  const parsed = openPacket(source)
  if (!parsed) {
    throw new EmbeddedWriteError(
      "This file's XMP metadata could not be read, so it cannot be edited safely.",
    )
  }
  const firstRoot = parsed.roots[0]
  if (!firstRoot) {
    throw new EmbeddedWriteError(
      "This file's XMP metadata has no RDF block to edit.",
    )
  }
  const editor = new PacketEditor(parsed.descriptions, firstRoot)

  for (const op of ops) {
    if (op.type === 'gps') {
      for (const property of editor.all()) {
        if (property.uri === NS.exif && property.local.startsWith('GPS')) {
          editor.remove(property)
        }
      }
    } else if (op.type === 'canonical') {
      if (op.value === null) {
        for (const each of op.targets) {
          for (const property of editor.find(each.uri, each.local)) {
            editor.remove(property)
          }
        }
      } else {
        for (const each of op.targets) editor.set(each, op.value)
      }
    } else {
      applyOther(editor, op)
    }
  }

  const stamp = formatXmpNow(now)
  editor.set(target(NS.xmp, 'MetadataDate', 'simple'), stamp)
  if (profile === 'pdf') {
    const modified = patch['modifiedAt']
    editor.set(
      target(NS.xmp, 'ModifyDate', 'simple'),
      typeof modified === 'string' && modified ? modified : stamp,
    )
  }

  const out = serializeXml(parsed.doc)
  // The promise is "never produce a corrupt file": prove the result parses.
  if (!parseXml(out)) {
    throw new EmbeddedWriteError(
      'The edited XMP metadata did not re-read cleanly, so it was not written.',
    )
  }
  return out
}

/** `2026-09-24T18:04:05Z` — whole seconds, UTC, zone always present. */
function formatXmpNow(now: Date): string {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function planWrite(patch: EmbeddedPatch, profile: XmpProfile): WriteOp[] {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new EmbeddedWriteError('Nothing to change.')
  }
  const writes = canonicalWrites(profile)
  const format = profile === 'pdf' ? 'pdf' : 'jpeg'
  const ops: WriteOp[] = []
  for (const [key, raw] of Object.entries(patch)) {
    const other = key.startsWith('xmp|') ? parseOtherEmbeddedKey(key) : null
    if (other) {
      const [uri, local, ...rest] = other.parts
      if (!uri || !local || rest.length || !isOtherProperty(uri, local)) {
        throw new EmbeddedWriteError(
          `${local ?? key} cannot be edited as an XMP field.`,
        )
      }
      const conventional = CONVENTIONAL_PREFIX[uri]
      const label = conventional ? `${conventional}:${local}` : local
      ops.push({
        type: 'other',
        label,
        uri,
        local,
        value: patchValue(label, raw),
      })
      continue
    }
    const label = embeddedFieldLabel(key, format)
    if (key === 'gps') {
      if (patchValue(label, raw) !== null) {
        throw new EmbeddedWriteError(`${label} can only be removed.`)
      }
      ops.push({ type: 'gps' })
      continue
    }
    if (READ_ONLY_KEYS.has(key)) {
      throw new EmbeddedWriteError(`${label} cannot be edited.`)
    }
    const targets = Object.prototype.hasOwnProperty.call(writes, key)
      ? writes[key]
      : undefined
    // Not an XMP key: another writer of this file owns it.
    if (!targets) continue
    const value = patchValue(label, raw)
    if (value !== null) validateCanonical(key, label, value)
    ops.push({ type: 'canonical', label, targets, value })
  }
  return ops
}

/** Normalize one patch value; '' and [] mean removal. */
function patchValue(label: string, raw: unknown): string | string[] | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string') {
    if (hasNonXmlCharacters(raw)) {
      throw new EmbeddedWriteError(
        `${label} contains characters that cannot be stored in XMP.`,
      )
    }
    return raw.trim() ? raw : null
  }
  if (Array.isArray(raw)) {
    const items: string[] = []
    for (const item of raw) {
      if (typeof item !== 'string') {
        throw new EmbeddedWriteError(`${label} must be text.`)
      }
      if (hasNonXmlCharacters(item)) {
        throw new EmbeddedWriteError(
          `${label} contains characters that cannot be stored in XMP.`,
        )
      }
      if (item.trim()) items.push(item)
    }
    return items.length ? items : null
  }
  throw new EmbeddedWriteError(`${label} must be text.`)
}

function validateCanonical(
  key: string,
  label: string,
  value: string | string[],
): void {
  const text = Array.isArray(value) ? value.join(', ') : value
  if ((key === 'createdAt' || key === 'modifiedAt') && !XMP_DATE.test(text)) {
    throw new EmbeddedWriteError(`${label} must be a date.`)
  }
  if (key === 'rating' && !/^(?:-1|[0-5])$/.test(text)) {
    throw new EmbeddedWriteError(`${label} must be between 0 and 5.`)
  }
}

function applyOther(
  editor: PacketEditor,
  op: Extract<WriteOp, { type: 'other' }>,
): void {
  const found = editor.find(op.uri, op.local)
  if (!found.length) {
    throw new EmbeddedWriteError(
      `${op.label} is not in this file's XMP metadata.`,
    )
  }
  if (op.value === null) {
    for (const property of found) editor.remove(property)
    return
  }
  for (const property of found) {
    const current = readValue(property)
    if (current.kind === 'struct') {
      throw new EmbeddedWriteError(
        `${op.label} is structured and cannot be edited here.`,
      )
    }
    editor.write(
      property,
      current.kind === 'array' ? current.container : 'simple',
      op.value,
    )
  }
}

/**
 * The whitespace a node is written after, or null for a packet with none.
 *
 * An indented packet has a line break and an indent, and a child sits one
 * unit deeper. A packet on ONE line — Photoshop's "Save for Web" output,
 * Apple's HEIC thumbnails — separates every node with the same run of
 * spaces whatever its depth; that is `lineBreak: ''` with the run in
 * `indent`, and it is reused unchanged at every depth.
 */
interface Layout {
  lineBreak: string
  indent: string
}

/** The layout of `node` from the whitespace text just before it. */
function layoutOf(node: XmlElement): Layout | null {
  const parent = node.parent
  if (!parent) return null
  const index = parent.children.indexOf(node)
  const before = parent.children[index - 1]
  if (!isWhitespaceText(before) || !before.raw) return null
  const raw = before.raw
  const newline = raw.lastIndexOf('\n')
  if (newline === -1) return { lineBreak: '', indent: raw }
  return {
    lineBreak: raw[newline - 1] === '\r' ? '\r\n' : '\n',
    indent: raw.slice(newline + 1),
  }
}

function deeper(layout: Layout | null, unit: string): Layout | null {
  if (!layout || !layout.lineBreak) return layout
  return { ...layout, indent: layout.indent + unit }
}

function whitespace(layout: Layout | null): XmlNode[] {
  return layout ? [createWhitespace(layout.lineBreak + layout.indent)] : []
}

function qualify(prefix: string, local: string): string {
  return prefix ? `${prefix}:${local}` : local
}

/**
 * The DOM surgery behind {@link writeXmp}. Holds the Descriptions and the
 * packet's indentation habits, and re-scans on every lookup so an edit is
 * always made against the tree as it is now.
 */
class PacketEditor {
  private readonly descriptions: XmlElement[]
  /** The first `rdf:Description`, where new properties go. */
  private readonly home: XmlElement
  /** One level of indentation, as this packet writes it. */
  private readonly unit: string
  /** The quote character this packet's attributes use. */
  private readonly quote: '"' | "'"

  constructor(descriptions: XmlElement[], root: XmlElement) {
    const home =
      descriptions.find((node) => isRdf(node, 'Description')) ??
      this.createDescription(root)
    this.descriptions = descriptions.includes(home)
      ? descriptions
      : [...descriptions, home]
    this.home = home
    this.unit = inferIndentUnit(home)
    this.quote =
      home.attributes.find((attr) => !isNamespaceDeclaration(attr))?.quote ??
      home.attributes[0]?.quote ??
      '"'
  }

  all(): XmpProperty[] {
    return this.descriptions.flatMap(propertiesOf)
  }

  find(uri: string, local: string): XmpProperty[] {
    return findProperties(this.descriptions, uri, local)
  }

  /** Set a property everywhere it lives, or add it if `create` allows. */
  set(where: WriteTarget, value: string | string[]): void {
    const found = this.find(where.uri, where.local)
    if (!found.length) {
      if (where.create) this.add(where, value)
      return
    }
    for (const property of found) this.write(property, where.shape, value)
  }

  /** Remove one occurrence, and the indentation that led up to it. */
  remove(property: XmpProperty): void {
    if (property.attribute) {
      removeAttribute(property.description, property.attribute.name)
      return
    }
    const element = property.element
    const parent = element?.parent
    if (!element || !parent) return
    const index = parent.children.indexOf(element)
    if (index === -1) return
    const before = parent.children[index - 1]
    if (isWhitespaceText(before)) parent.children.splice(index - 1, 2)
    else parent.children.splice(index, 1)
    element.parent = null
  }

  /** Write `value` into an existing occurrence, keeping its form. */
  write(
    property: XmpProperty,
    shape: XmpShape,
    value: string | string[],
  ): void {
    const items = Array.isArray(value) ? value : [value]
    const text = Array.isArray(value) ? value.join(', ') : value

    if (property.attribute) {
      if (shape === 'simple') {
        setAttribute(property.description, property.attribute.name, text)
        return
      }
      // An attribute cannot hold an array: move it to an element in the
      // same Description, under the prefix it was written with.
      removeAttribute(property.description, property.attribute.name)
      this.appendProperty(
        property.description,
        qualify(property.prefix, property.local),
        shape,
        items,
      )
      return
    }

    const element = property.element
    if (!element) return
    if (shape === 'simple') {
      const resource = rdfAttribute(element, 'resource')
      if (resource && !elementChildren(element).length) {
        setAttribute(element, resource.name, text)
        return
      }
      if (
        !elementChildren(element).length &&
        !hasFieldAttributes(element) &&
        !rdfAttribute(element, 'parseType')
      ) {
        setTextContent(element, text)
        return
      }
      this.clearValueAttributes(element)
      setTextContent(element, text)
      return
    }

    // Only an array of plain items is edited in place; one whose items are
    // structs (or that is no array at all) is rebuilt below.
    const current = readValue(property)
    const container = current.kind === 'array' ? arrayContainer(element) : null
    if (container) {
      if (shape === 'alt' && container.kind === 'alt') {
        this.setDefaultAlternative(container.node, text)
        return
      }
      // A Bag where a Seq belongs (or the reverse) keeps its container:
      // the order question is the file's, the values are the edit's.
      if (shape !== 'alt' && container.kind !== 'alt') {
        this.setItems(container.node, items, null)
        return
      }
    }
    // The property holds the wrong kind of value; rebuild its content.
    this.clearValueAttributes(element)
    const layout = layoutOf(element)
    const inner = deeper(layout, this.unit)
    const built = this.buildContainer(
      element,
      shape,
      shape === 'alt' ? [text] : items,
      inner,
    )
    replaceChildren(element, [
      ...whitespace(inner),
      built,
      ...whitespace(layout),
    ])
    element.selfClosing = false
  }

  /** Add a property that does not exist yet to the first Description. */
  private add(where: WriteTarget, value: string | string[]): void {
    const prefix = this.ensurePrefix(this.home, where.uri)
    const items = Array.isArray(value) ? value : [value]
    this.appendProperty(
      this.home,
      qualify(prefix, where.local),
      where.shape,
      where.shape === 'alt' ? [items.join(', ')] : items,
    )
  }

  private appendProperty(
    description: XmlElement,
    name: string,
    shape: XmpShape,
    items: string[],
  ): void {
    const { layout, insert } = this.planAppend(description)
    let element: XmlElement
    if (shape === 'simple') {
      element = createElement(name, [], [createText(items.join(', '))])
    } else {
      element = createElement(name)
      const inner = deeper(layout, this.unit)
      const container = this.buildContainer(description, shape, items, inner)
      insertChildren(element, 0, [
        ...whitespace(inner),
        container,
        ...whitespace(layout),
      ])
    }
    insert(element)
  }

  /**
   * Where the next child element of `parent` goes and how it is indented:
   * after the last element child, at that child's indent; or, in an empty
   * parent, one level deeper than the parent, before its closing tag.
   */
  private planAppend(parent: XmlElement): {
    layout: Layout | null
    insert: (node: XmlElement) => void
  } {
    const kids = elementChildren(parent)
    const last = kids[kids.length - 1]
    if (last) {
      const layout =
        [...kids]
          .reverse()
          .map(layoutOf)
          .find((found): found is Layout => found !== null) ?? null
      return {
        layout,
        insert: (node) =>
          insertChildren(parent, parent.children.indexOf(last) + 1, [
            ...whitespace(layout),
            node,
          ]),
      }
    }
    const own = layoutOf(parent)
    const layout = deeper(own, this.unit)
    return {
      layout,
      insert: (node) => {
        const tail = parent.children[parent.children.length - 1]
        if (layout && isWhitespaceText(tail) && tail.raw) {
          insertChildren(parent, parent.children.length - 1, [
            ...whitespace(layout),
            node,
          ])
        } else {
          insertChildren(parent, parent.children.length, [
            ...whitespace(layout),
            node,
            ...whitespace(own),
          ])
        }
        parent.selfClosing = false
      },
    }
  }

  /** The prefix `rdf:` elements take at `scope`. */
  private rdfPrefix(scope: XmlElement): string {
    const bound = prefixForNamespace(scope, RDF)
    if (bound !== null) return bound
    if (resolvePrefix(scope, '') === RDF) return ''
    return 'rdf'
  }

  private buildContainer(
    scope: XmlElement,
    shape: XmpArrayKind,
    items: string[],
    layout: Layout | null,
  ): XmlElement {
    const prefix = this.rdfPrefix(scope)
    const name = qualify(
      prefix,
      shape === 'alt' ? 'Alt' : shape === 'bag' ? 'Bag' : 'Seq',
    )
    const container = createElement(name)
    const itemLayout = deeper(layout, this.unit)
    const lang = shape === 'alt' ? 'x-default' : null
    insertChildren(container, 0, [
      ...items.flatMap((item) => [
        ...whitespace(itemLayout),
        this.buildItem(prefix, item, lang),
      ]),
      ...whitespace(layout),
    ])
    return container
  }

  private buildItem(
    rdfPrefix: string,
    value: string,
    lang: string | null,
  ): XmlElement {
    return createElement(
      qualify(rdfPrefix, 'li'),
      lang ? [['xml:lang', lang]] : [],
      value ? [createText(value)] : [],
      this.quote,
    )
  }

  /**
   * Set the `x-default` item of a language alternative. Following the
   * XMP Toolkit's `SetLocalizedText`, an item in a specific language that
   * held the same text as the old default is its twin and changes with
   * it; an item that had been translated is left alone. With no
   * `x-default` the first item — the one a reader shows — is set.
   */
  private setDefaultAlternative(container: XmlElement, value: string): void {
    const items = arrayItems(container)
    const fallback = items.find(
      (item) => langOf(item)?.toLowerCase() === 'x-default',
    )
    if (fallback) {
      const previous = textContent(fallback)
      for (const item of items) {
        if (
          item !== fallback &&
          !elementChildren(item).length &&
          textContent(item) === previous
        ) {
          setTextContent(item, value)
        }
      }
      setTextContent(fallback, value)
      return
    }
    const first = items[0]
    if (first) {
      setTextContent(first, value)
      return
    }
    this.setItems(container, [value], 'x-default')
  }

  /**
   * Replace an array's items, reusing the whitespace the old items were
   * laid out with so the rewritten block looks like the rest of the file.
   */
  private setItems(
    container: XmlElement,
    values: string[],
    lang: string | null,
  ): void {
    const kids = container.children
    const firstItem = kids.findIndex((node) => node.type === 'element')
    let itemSpace: string | null = null
    let closeSpace: string | null = null
    if (firstItem !== -1) {
      const before = kids[firstItem - 1]
      if (isWhitespaceText(before)) itemSpace = before.raw
      const tail = kids[kids.length - 1]
      if (isWhitespaceText(tail) && kids.length - 1 > firstItem) {
        closeSpace = tail.raw
      }
    } else {
      const layout = layoutOf(container)
      const inner = deeper(layout, this.unit)
      if (inner) itemSpace = inner.lineBreak + inner.indent
      if (layout) closeSpace = layout.lineBreak + layout.indent
    }
    const prefix = splitQName(container.name).prefix
    const nodes: XmlNode[] = []
    for (const value of values) {
      if (itemSpace !== null) nodes.push(createWhitespace(itemSpace))
      nodes.push(this.buildItem(prefix, value, lang))
    }
    if (closeSpace !== null) nodes.push(createWhitespace(closeSpace))
    replaceChildren(container, nodes)
    container.selfClosing = false
  }

  /**
   * Drop what made a property element structured — `rdf:parseType`,
   * `rdf:resource`, field attributes, `xml:lang` — keeping namespace
   * declarations, which descendants elsewhere may rely on.
   */
  private clearValueAttributes(element: XmlElement): void {
    element.attributes = element.attributes.filter(isNamespaceDeclaration)
  }

  /**
   * A prefix bound to `uri` at `scope`, declaring one on `scope` when none
   * is: the conventional prefix, or `<conventional>1`, `2`, … if a file
   * has already used that prefix for something else.
   */
  private ensurePrefix(scope: XmlElement, uri: string): string {
    const existing = prefixForNamespace(scope, uri)
    if (existing !== null) return existing
    const base = CONVENTIONAL_PREFIX[uri] ?? 'ns'
    let prefix = base
    for (let n = 1; resolvePrefix(scope, prefix) !== null; n++) {
      prefix = `${base}${n}`
    }
    const declarations = scope.attributes.filter(isNamespaceDeclaration)
    const anchor =
      declarations[declarations.length - 1] ??
      scope.attributes[scope.attributes.length - 1]
    setAttribute(scope, `xmlns:${prefix}`, uri, {
      leading: anchor?.leading ?? ' ',
      quote: anchor?.quote ?? this.quote,
      index: anchor ? scope.attributes.indexOf(anchor) + 1 : 0,
    })
    return prefix
  }

  /** An `rdf:Description` for an `rdf:RDF` that holds none. */
  private createDescription(root: XmlElement): XmlElement {
    const prefix = prefixForNamespace(root, RDF)
    const quote = root.attributes[0]?.quote ?? '"'
    const description = prefix
      ? createElement(
          `${prefix}:Description`,
          [[`${prefix}:about`, '']],
          [],
          quote,
        )
      : createElement(
          'rdf:Description',
          [
            ['xmlns:rdf', RDF],
            ['rdf:about', ''],
          ],
          [],
          quote,
        )
    const own = layoutOf(root)
    const layout = deeper(own, ' ')
    const tail = root.children[root.children.length - 1]
    if (layout && isWhitespaceText(tail) && tail.raw) {
      insertChildren(root, root.children.length - 1, [
        ...whitespace(layout),
        description,
      ])
    } else {
      insertChildren(root, root.children.length, [
        ...whitespace(layout),
        description,
        ...whitespace(own),
      ])
    }
    root.selfClosing = false
    // An empty Description reads the same either way; open it so its
    // first property lands between the tags with its own line.
    description.children = layout ? whitespace(layout) : []
    return description
  }
}

/**
 * One level of indentation as this packet writes it: Adobe's XMP Core
 * indents by one space, Photoshop's serializer by three, exiftool by one.
 * Measured from the Description's first property, else from the
 * Description against its `rdf:RDF`; one space when neither says.
 */
function inferIndentUnit(description: XmlElement): string {
  const own = layoutOf(description)
  const firstChild = elementChildren(description)[0]
  const child = firstChild ? layoutOf(firstChild) : null
  if (
    own &&
    child &&
    child.indent.length > own.indent.length &&
    child.indent.startsWith(own.indent)
  ) {
    return child.indent.slice(own.indent.length)
  }
  const parent =
    description.parent?.type === 'element' ? layoutOf(description.parent) : null
  if (
    own &&
    parent &&
    own.indent.length > parent.indent.length &&
    own.indent.startsWith(parent.indent)
  ) {
    return own.indent.slice(parent.indent.length)
  }
  return ' '
}
