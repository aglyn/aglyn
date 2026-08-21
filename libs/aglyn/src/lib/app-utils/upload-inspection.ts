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
 * STRUCTURAL upload inspection (AGL-1475).
 *
 * ## What this is, and what it is emphatically not
 *
 * This is **not** an antivirus scanner and no code in this module should ever
 * be described as one. It does not have malware signatures, it does not
 * emulate, unpack or detonate anything, and a novel trojan with a correct PDF
 * header passes it without a murmur. It is *structural validation*: it reads
 * the first few kilobytes of an upload and answers three questions the
 * platform previously could not ask at all.
 *
 * 1. **Are these bytes an executable?** A Windows PE, an ELF binary, a Mach-O
 *    binary or an installer package is refused whatever it claims to be. This
 *    is the single highest-value check here: the Sept-1 risk is a customer's
 *    domain re-serving a trojan to a visitor's browser, and the overwhelming
 *    majority of that population is a plain executable with a lying name.
 * 2. **Do the bytes match the declared type?** Media ingress trusted the
 *    caller's content type completely — AGL-2463 wrote that gap down. The
 *    allowlist bounded what a file *claimed* to be and nothing bounded what it
 *    *was*, so `Content-Type: application/pdf` over a `.exe` was stored,
 *    hashed, given a CDN path and served. It now has to be a PDF.
 * 3. **Does an Office document carry a macro project?** AGL-1465 kept
 *    `.docm`/`.xlsm`/`.pptm` out **by content type**, which is a gate on a
 *    string the uploader chooses. Renaming a macro-enabled document to
 *    `.docx` walked straight past it. The archive is now checked for a
 *    `vbaProject.bin` entry, which is the thing that made those extensions
 *    worth excluding in the first place.
 *
 * Plus one signature, EICAR — see {@link EICAR_TEST_SIGNATURE}.
 *
 * ## What it therefore does not catch
 *
 * A malicious PDF that is a real PDF. A macro-free document that exploits a
 * reader. Anything inside a plain `application/zip`, which is a brand kit and
 * may legitimately contain a build tool. An obfuscated dropper in a JSON
 * file. Real malware detection needs signatures and an engine, which needs a
 * ClamAV service, which does not fit the budget this platform runs on — the
 * cost work is in the issue. Nothing here should be allowed to read as though
 * that decision went the other way.
 *
 * ## Why it is pure, and takes a window rather than a file
 *
 * Three of the four media chokepoints hold the whole file in memory and can
 * pass it straight in. The fourth — signed direct-to-storage upload — never
 * sees the bytes, because that is the entire reason it exists: a 200 MB video
 * goes browser → bucket and downloading it back into the function to look at
 * it would cost more than the feature. So that caller does two RANGED reads
 * instead, a few KB from each end, and passes them as {@link
 * InspectUploadInput.bytes} and {@link InspectUploadInput.tail}. Every
 * signature this module knows lives in one of those two windows, so the
 * signed route gets the same verdict for the price of a rounding error.
 */

/**
 * The EICAR standard antivirus test string.
 *
 * A 68-byte printable string, defined by the European Institute for Computer
 * Antivirus Research, that every antivirus product agrees to flag and that is
 * completely inert. It exists so that a pipeline can be tested end to end
 * without anyone handling a live sample.
 *
 * It is matched here for exactly two reasons, and neither is malware
 * detection. First, it makes this module's own tests honest without checking
 * a real sample into the repository. Second, it is the probe a security
 * reviewer or a customer will actually try, and answering it with silence
 * would be a worse lie than answering it with a refusal — a refusal that says
 * "structural check" is true, where a silent accept invites the reader to
 * conclude nothing is checked at all.
 *
 * **This is a signature list of one. It is not an engine.** Do not add a
 * second entry here and start calling the result malware scanning; if real
 * signatures are wanted, they belong in a scanner service, not in a string
 * constant.
 */
export const EICAR_TEST_SIGNATURE =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'

/**
 * How many leading bytes an inspection needs.
 *
 * Every magic number checked here sits in the first 16 bytes; the window is
 * far larger so that the EICAR match and the small-file macro scan have room,
 * and because the signed route's ranged GET costs the same for 4 KB as for
 * 64 bytes.
 */
export const UPLOAD_INSPECTION_HEAD_BYTES = 4096

/**
 * How many trailing bytes an inspection wants for an Office document.
 *
 * A ZIP's central directory — the authoritative list of what is inside it —
 * lives at the end of the file. 64 KB covers the directory of any document
 * archive this platform accepts (the largest ceiling is a 50 MB `.pptx`, and
 * its directory is a few KB even with hundreds of embedded images). A
 * document whose directory is somehow larger than this window degrades to
 * "macro not found", which is the pre-existing behaviour, not a regression.
 */
export const UPLOAD_INSPECTION_TAIL_BYTES = 65536

export type UploadInspectionCode =
  | 'signature_match'
  | 'executable_bytes'
  | 'type_mismatch'
  | 'macro_payload'
  | 'empty_file'

export interface UploadInspectionRefusal {
  /** Stable machine code — for the API error body, logs and tests. */
  code: UploadInspectionCode
  /** What the bytes turned out to be, in words rather than hex. */
  detected: string
  /**
   * The sentence the uploader sees. Names the file and what was found, so
   * that a merchant who did nothing wrong can tell which of fifty dropped
   * files was the problem and why.
   */
  message: string
}

export interface InspectUploadInput {
  /**
   * The whole file, or its leading {@link UPLOAD_INSPECTION_HEAD_BYTES}.
   * Callers holding the whole file pass it and omit `tail`.
   */
  bytes: Uint8Array
  /**
   * The file's trailing bytes, supplied ONLY by a caller that passed a head
   * window rather than the whole file. When absent, `bytes` is searched for
   * the trailing structures too — which is correct precisely because a caller
   * that omits it is one that handed over the entire file.
   */
  tail?: Uint8Array | null
  /** The type the upload claims to be, already normalized by the caller. */
  contentType: string
  /** For the message only. Never used to decide anything. */
  fileName?: string | null
}

interface Signature {
  /** Bytes to match. */
  magic: readonly number[]
  /** Where they start. */
  offset?: number
  /** Human name for the refusal message. */
  label: string
}

const at = (bytes: Uint8Array, signature: Signature): boolean => {
  const offset = signature.offset ?? 0
  if (bytes.length < offset + signature.magic.length) return false
  for (let i = 0; i < signature.magic.length; i++) {
    if (bytes[offset + i] !== signature.magic[i]) return false
  }
  return true
}

const ascii = (text: string): number[] =>
  Array.from(text, (character) => character.charCodeAt(0))

/**
 * Executable and installer containers, refused whatever the upload claims to
 * be. This list is deliberately about CONTAINERS, not content: each entry is
 * a format whose entire purpose is to be run, and none of them has any
 * business in a media library under any content type.
 *
 * `#!` is NOT here on purpose. A shebang is two characters that a legitimate
 * `text/plain` upload can genuinely open with, it is not executable in a
 * browser, and the type-mismatch check below already refuses it under every
 * binary type. Refusing it outright would buy nothing and cost real uploads.
 */
const EXECUTABLE_SIGNATURES: readonly Signature[] = [
  { magic: ascii('MZ'), label: 'a Windows executable' },
  { magic: [0x7f, 0x45, 0x4c, 0x46], label: 'a Linux executable (ELF)' },
  { magic: [0xfe, 0xed, 0xfa, 0xce], label: 'a macOS executable (Mach-O)' },
  { magic: [0xfe, 0xed, 0xfa, 0xcf], label: 'a macOS executable (Mach-O)' },
  { magic: [0xce, 0xfa, 0xed, 0xfe], label: 'a macOS executable (Mach-O)' },
  { magic: [0xcf, 0xfa, 0xed, 0xfe], label: 'a macOS executable (Mach-O)' },
  // 0xCAFEBABE is both a Java class file and a multi-architecture Mach-O
  // binary. Both are code; the label names the likelier one for a DAM.
  { magic: [0xca, 0xfe, 0xba, 0xbe], label: 'a compiled program' },
  { magic: ascii('!<arch>'), label: 'an installer package' },
  { magic: [0xed, 0xab, 0xee, 0xdb], label: 'an installer package (RPM)' },
  // Windows shortcut — a .lnk is a launcher, and a classic phishing payload.
  { magic: [0x4c, 0x00, 0x00, 0x00, 0x01, 0x14, 0x02, 0x00], label: 'a Windows shortcut' },
]

/** ZIP, in its three legal opening forms. Every OOXML document is one. */
const ZIP_SIGNATURES: readonly Signature[] = [
  { magic: [0x50, 0x4b, 0x03, 0x04], label: 'ZIP' },
  { magic: [0x50, 0x4b, 0x05, 0x06], label: 'ZIP' },
  { magic: [0x50, 0x4b, 0x07, 0x08], label: 'ZIP' },
]

/** Microsoft's pre-2007 container: legacy `.doc`, `.xls`, `.ppt` and `.msi`. */
const OLE_SIGNATURE: Signature = {
  magic: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  label: 'a legacy Office document',
}

/** ISO base media (`....ftyp`) — mp4, QuickTime, and the modern image codecs. */
const ISO_BMFF: Signature = { magic: ascii('ftyp'), offset: 4, label: 'ISO media' }

/**
 * Accepted content type → the signatures its bytes may legally start with.
 *
 * A type ABSENT from this table is not checked for a match, and that is a
 * deliberate, load-bearing property rather than a gap to be filled with
 * guesses. `text/plain`, `text/csv`, `text/markdown`, `application/json` and
 * `image/svg+xml` are text: they have no magic number, any leading bytes are
 * legal, and inventing a heuristic for them would refuse real files. They are
 * still covered by the executable check above, which is the check that
 * matters for them — an `.exe` renamed `notes.txt` is refused; a CSV that is
 * merely unusual is not.
 */
const TYPE_SIGNATURES: Readonly<Record<string, readonly Signature[]>> = {
  'application/pdf': [{ magic: ascii('%PDF-'), label: 'PDF' }],
  'application/zip': ZIP_SIGNATURES,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ZIP_SIGNATURES,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ZIP_SIGNATURES,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ZIP_SIGNATURES,
  // Word writes RTF under a `.doc` name often enough that refusing it would
  // be a real false positive, so both containers are legal for this type.
  'application/msword': [OLE_SIGNATURE, { magic: ascii('{\\rtf'), label: 'RTF' }],
  'application/vnd.ms-excel': [OLE_SIGNATURE],
  'application/vnd.ms-powerpoint': [OLE_SIGNATURE],
  'application/rtf': [{ magic: ascii('{\\rtf'), label: 'RTF' }],

  'image/png': [{ magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], label: 'PNG' }],
  'image/jpeg': [{ magic: [0xff, 0xd8, 0xff], label: 'JPEG' }],
  'image/gif': [
    { magic: ascii('GIF87a'), label: 'GIF' },
    { magic: ascii('GIF89a'), label: 'GIF' },
  ],
  'image/webp': [{ magic: ascii('RIFF'), label: 'WebP' }],
  'image/bmp': [{ magic: ascii('BM'), label: 'BMP' }],
  'image/tiff': [
    { magic: [0x49, 0x49, 0x2a, 0x00], label: 'TIFF' },
    { magic: [0x4d, 0x4d, 0x00, 0x2a], label: 'TIFF' },
  ],
  'image/x-icon': [{ magic: [0x00, 0x00, 0x01, 0x00], label: 'icon' }],
  'image/vnd.microsoft.icon': [{ magic: [0x00, 0x00, 0x01, 0x00], label: 'icon' }],
  'image/avif': [ISO_BMFF],
  'image/heic': [ISO_BMFF],
  'image/heif': [ISO_BMFF],

  'video/mp4': [ISO_BMFF],
  'video/quicktime': [ISO_BMFF],
  'video/webm': [{ magic: [0x1a, 0x45, 0xdf, 0xa3], label: 'Matroska/WebM' }],
}

/** The OOXML document types whose archive is scanned for a macro project. */
const OOXML_DOCUMENT_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
])

/** The pre-2007 Office types whose OLE directory is scanned for the same. */
const LEGACY_OFFICE_TYPES = new Set([
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
])

/**
 * Does a caller holding only a head window need to fetch the tail as well?
 *
 * Only the macro scan reads the end of a file, and only for document
 * archives, so this is what lets the signed-upload route skip a second ranged
 * GET for the 200 MB videos that route exists to carry — which is every
 * object on it bar a handful of documents.
 */
export function uploadInspectionNeedsTail(contentType: string): boolean {
  return (
    OOXML_DOCUMENT_TYPES.has(contentType) || LEGACY_OFFICE_TYPES.has(contentType)
  )
}

const indexOfBytes = (haystack: Uint8Array, needle: Uint8Array): number => {
  if (!needle.length || haystack.length < needle.length) return -1
  const last = haystack.length - needle.length
  outer: for (let i = 0; i <= last; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return -1
}

const contains = (haystack: Uint8Array, needle: Uint8Array): boolean =>
  indexOfBytes(haystack, needle) >= 0

const EICAR_BYTES = new Uint8Array(ascii(EICAR_TEST_SIGNATURE))

/** `vbaProject.bin` as an OOXML archive entry name. */
const VBA_ENTRY = new Uint8Array(ascii('vbaProject.bin'))

/**
 * `_VBA_PROJECT` as it appears in an OLE directory, which stores stream names
 * as UTF-16LE. Matching the encoded form rather than the ASCII one is what
 * keeps this from firing on a document that merely contains the words.
 */
const OLE_VBA_STREAM = new Uint8Array(
  ascii('_VBA_PROJECT').flatMap((code) => [code, 0x00]),
)

const describeFile = (fileName?: string | null): string => {
  const name = String(fileName ?? '').trim()
  return name ? `"${name}"` : 'This file'
}

/**
 * Inspect an upload's bytes against the type it claims to be.
 *
 * Returns `null` when nothing structural is wrong — which, to be explicit, is
 * NOT a statement that the file is safe. See the module header.
 */
export function inspectUploadBytes(
  input: InspectUploadInput,
): UploadInspectionRefusal | null {
  const { bytes, contentType, fileName } = input
  const head = bytes ?? new Uint8Array(0)
  // A caller that passed the whole file gets the whole file searched for the
  // trailing structures too; only a ranged caller supplies a separate tail.
  const tail = input.tail ?? head
  const subject = describeFile(fileName)

  if (!head.length) {
    return {
      code: 'empty_file',
      detected: 'an empty file',
      message: `${subject} is empty, so there is nothing to store.`,
    }
  }

  // 1. The signature list of one. Checked first so that a probe gets the
  //    answer it is actually asking for, whatever else is also wrong.
  if (contains(head, EICAR_BYTES) || contains(tail, EICAR_BYTES)) {
    return {
      code: 'signature_match',
      detected: 'the EICAR antivirus test file',
      message:
        `${subject} matches the EICAR test signature and was refused by the ` +
        `upload structure check.`,
    }
  }

  // 2. Executable containers, refused under every declared type.
  for (const signature of EXECUTABLE_SIGNATURES) {
    if (at(head, signature)) {
      return {
        code: 'executable_bytes',
        detected: signature.label,
        message:
          `${subject} contains ${signature.label}, which cannot be uploaded ` +
          `whatever it is named or labelled.`,
      }
    }
  }

  // 3. The declared type against what the bytes actually are.
  const expected = TYPE_SIGNATURES[contentType]
  if (expected && !expected.some((signature) => at(head, signature))) {
    return {
      code: 'type_mismatch',
      detected: `something other than ${expected[0].label}`,
      message:
        `${subject} is labelled ${contentType} but its contents are not ` +
        `${expected[0].label}. Re-save it in the format it claims to be, or ` +
        `upload it under its real type.`,
    }
  }

  // 4. A macro project inside a document whose type is not supposed to have
  //    one. This is the check the content-type allowlist could never make.
  if (OOXML_DOCUMENT_TYPES.has(contentType)) {
    if (contains(head, VBA_ENTRY) || contains(tail, VBA_ENTRY)) {
      return {
        code: 'macro_payload',
        detected: 'an embedded macro project',
        message:
          `${subject} contains an embedded macro project. Macro-enabled ` +
          `documents are not accepted — save it without macros and upload ` +
          `it again.`,
      }
    }
  } else if (LEGACY_OFFICE_TYPES.has(contentType)) {
    if (contains(head, OLE_VBA_STREAM) || contains(tail, OLE_VBA_STREAM)) {
      return {
        code: 'macro_payload',
        detected: 'an embedded macro project',
        message:
          `${subject} contains an embedded macro project. Macro-enabled ` +
          `documents are not accepted — save it without macros and upload ` +
          `it again.`,
      }
    }
  }

  return null
}

export default inspectUploadBytes
