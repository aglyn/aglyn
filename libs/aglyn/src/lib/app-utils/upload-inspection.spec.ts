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

import {
  EICAR_TEST_SIGNATURE,
  inspectUploadBytes,
  UPLOAD_INSPECTION_HEAD_BYTES,
  uploadInspectionNeedsTail,
} from './upload-inspection'

/**
 * The EICAR test file, as a file.
 *
 * This is the industry's standard "does your scanner do anything" probe — a
 * 68-byte printable string every antivirus product agrees to flag, defined
 * precisely so that nobody has to handle a live sample to test a pipeline.
 * It is what this suite uses, and no real malware sample is checked in.
 */
const eicarFile = (): Buffer => Buffer.from(EICAR_TEST_SIGNATURE, 'ascii')

const bytes = (...values: number[]): Buffer => Buffer.from(values)

/** A structurally valid one-pixel PNG header followed by filler. */
const pngHead = (): Buffer =>
  Buffer.concat([
    bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    Buffer.alloc(64, 0x00),
  ])

/** `%PDF-1.7` and some body. */
const pdfFile = (): Buffer =>
  Buffer.concat([Buffer.from('%PDF-1.7\n', 'ascii'), Buffer.alloc(64, 0x20)])

/** A ZIP local-file-header magic, which is what every OOXML document is. */
const zipFile = (extra = ''): Buffer =>
  Buffer.concat([
    bytes(0x50, 0x4b, 0x03, 0x04),
    Buffer.alloc(32, 0x00),
    Buffer.from(extra, 'ascii'),
  ])

/** A Windows PE / DOS executable. */
const windowsExecutable = (): Buffer =>
  Buffer.concat([Buffer.from('MZ', 'ascii'), Buffer.alloc(128, 0x00)])

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

describe('inspectUploadBytes', () => {
  describe('the EICAR signature', () => {
    it('refuses the EICAR test file whatever it claims to be', () => {
      for (const contentType of [
        'application/pdf',
        'text/plain',
        'image/png',
        'application/zip',
        DOCX,
      ]) {
        const refusal = inspectUploadBytes({
          bytes: eicarFile(),
          contentType,
          fileName: 'harmless.txt',
        })
        expect(refusal).not.toBeNull()
        expect(refusal?.code).toBe('signature_match')
        expect(refusal?.detected).toMatch(/EICAR/i)
      }
    })

    it('refuses EICAR embedded past the start of the file', () => {
      const refusal = inspectUploadBytes({
        bytes: Buffer.concat([
          Buffer.from('%PDF-1.7\n', 'ascii'),
          Buffer.alloc(512, 0x20),
          eicarFile(),
        ]),
        contentType: 'application/pdf',
        fileName: 'report.pdf',
      })
      expect(refusal?.code).toBe('signature_match')
    })

    it('does not fire on ordinary bytes that merely mention antivirus', () => {
      const refusal = inspectUploadBytes({
        bytes: Buffer.from(
          'Our policy requires antivirus software on every laptop.',
          'utf8',
        ),
        contentType: 'text/plain',
        fileName: 'policy.txt',
      })
      expect(refusal).toBeNull()
    })
  })

  describe('executable containers', () => {
    it.each([
      ['Windows PE', windowsExecutable(), /Windows executable/i],
      [
        'ELF',
        Buffer.concat([bytes(0x7f, 0x45, 0x4c, 0x46), Buffer.alloc(64)]),
        /Linux executable/i,
      ],
      [
        'Mach-O',
        Buffer.concat([bytes(0xcf, 0xfa, 0xed, 0xfe), Buffer.alloc(64)]),
        /macOS executable/i,
      ],
      [
        'Debian/ar archive',
        Buffer.concat([Buffer.from('!<arch>\n', 'ascii'), Buffer.alloc(64)]),
        /installer package/i,
      ],
      [
        'RPM package',
        Buffer.concat([bytes(0xed, 0xab, 0xee, 0xdb), Buffer.alloc(64)]),
        /installer package/i,
      ],
    ])('refuses a %s whatever it claims to be', (_label, buffer, detected) => {
      const refusal = inspectUploadBytes({
        bytes: buffer,
        contentType: 'application/pdf',
        fileName: 'invoice.pdf',
      })
      expect(refusal?.code).toBe('executable_bytes')
      expect(refusal?.detected).toMatch(detected)
    })

    it('refuses an executable that claims to be plain text, where no magic-byte check for the DECLARED type exists', () => {
      const refusal = inspectUploadBytes({
        bytes: windowsExecutable(),
        contentType: 'text/plain',
        fileName: 'notes.txt',
      })
      expect(refusal?.code).toBe('executable_bytes')
    })
  })

  describe('declared type versus actual bytes', () => {
    it('refuses a Windows executable renamed to .pdf before it can be stored', () => {
      const refusal = inspectUploadBytes({
        bytes: windowsExecutable(),
        contentType: 'application/pdf',
        fileName: 'statement.pdf',
      })
      expect(refusal).not.toBeNull()
    })

    it('refuses an HTML page claiming to be a PNG', () => {
      const refusal = inspectUploadBytes({
        bytes: Buffer.from('<!DOCTYPE html><html><script>', 'utf8'),
        contentType: 'image/png',
        fileName: 'logo.png',
      })
      expect(refusal?.code).toBe('type_mismatch')
    })

    it.each([
      ['image/png', pngHead()],
      ['image/jpeg', Buffer.concat([bytes(0xff, 0xd8, 0xff), Buffer.alloc(64)])],
      ['image/gif', Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(64)])],
      ['application/pdf', pdfFile()],
      ['application/zip', zipFile()],
      [DOCX, zipFile()],
      [XLSX, zipFile()],
      [
        'video/webm',
        Buffer.concat([bytes(0x1a, 0x45, 0xdf, 0xa3), Buffer.alloc(64)]),
      ],
      [
        'video/mp4',
        Buffer.concat([
          bytes(0x00, 0x00, 0x00, 0x18),
          Buffer.from('ftypmp42', 'ascii'),
          Buffer.alloc(64),
        ]),
      ],
    ])('accepts a genuine %s', (contentType, buffer) => {
      expect(
        inspectUploadBytes({ bytes: buffer, contentType, fileName: 'file' }),
      ).toBeNull()
    })

    it('accepts text types, which have no magic to check', () => {
      for (const contentType of [
        'text/plain',
        'text/markdown',
        'text/csv',
        'application/json',
        'image/svg+xml',
      ]) {
        expect(
          inspectUploadBytes({
            bytes: Buffer.from('name,total\nwidget,3\n', 'utf8'),
            contentType,
            fileName: 'data.csv',
          }),
        ).toBeNull()
      }
    })

    it('accepts an image subtype it has no signature for rather than guessing', () => {
      expect(
        inspectUploadBytes({
          bytes: Buffer.alloc(64, 0x41),
          contentType: 'image/jxl',
          fileName: 'photo.jxl',
        }),
      ).toBeNull()
    })

    it('refuses an empty file rather than passing it as unrecognisable', () => {
      expect(
        inspectUploadBytes({
          bytes: Buffer.alloc(0),
          contentType: 'image/png',
          fileName: 'empty.png',
        }),
      ).not.toBeNull()
    })
  })

  describe('macro payloads inside Office documents', () => {
    /**
     * The hole this closes. AGL-1465 kept `.docm` out by CONTENT TYPE, and
     * the content type is whatever the uploader says it is — renaming a
     * macro-enabled document to `.docx` walked straight past that gate.
     */
    it('refuses a .docm renamed to .docx, which the content-type allowlist alone cannot catch', () => {
      const refusal = inspectUploadBytes({
        bytes: zipFile('word/vbaProject.bin'),
        contentType: DOCX,
        fileName: 'contract.docx',
      })
      expect(refusal?.code).toBe('macro_payload')
    })

    it('finds the macro entry in the ZIP central directory at the END of a large file', () => {
      const refusal = inspectUploadBytes({
        bytes: zipFile(),
        tail: Buffer.concat([
          Buffer.alloc(256, 0x00),
          Buffer.from('xl/vbaProject.bin', 'ascii'),
          Buffer.alloc(64, 0x00),
        ]),
        contentType: XLSX,
        fileName: 'budget.xlsx',
      })
      expect(refusal?.code).toBe('macro_payload')
    })

    it('refuses a legacy Office document carrying a VBA project stream', () => {
      const refusal = inspectUploadBytes({
        bytes: Buffer.concat([
          bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1),
          Buffer.alloc(128, 0x00),
          Buffer.from('_VBA_PROJECT', 'utf16le'),
        ]),
        contentType: 'application/msword',
        fileName: 'letter.doc',
      })
      expect(refusal?.code).toBe('macro_payload')
    })

    it('accepts an ordinary .docx', () => {
      expect(
        inspectUploadBytes({
          bytes: zipFile('word/document.xml'),
          contentType: DOCX,
          fileName: 'contract.docx',
        }),
      ).toBeNull()
    })

    it('does NOT scan inside a plain ZIP, which may legitimately hold anything', () => {
      expect(
        inspectUploadBytes({
          bytes: zipFile('macros/vbaProject.bin'),
          contentType: 'application/zip',
          fileName: 'brand-kit.zip',
        }),
      ).toBeNull()
    })
  })

  describe('the refusal itself', () => {
    it('says what was found without naming a brand', () => {
      const refusal = inspectUploadBytes({
        bytes: windowsExecutable(),
        contentType: 'application/pdf',
        fileName: 'invoice.pdf',
      })
      expect(refusal?.message).toEqual(expect.any(String))
      expect(refusal?.message.length).toBeGreaterThan(20)
      expect(refusal?.message).not.toMatch(/aglyn/i)
      // The merchant has to be able to act on it, so the message names the
      // file and what the bytes actually turned out to be.
      expect(refusal?.message).toContain('invoice.pdf')
    })

    it('never claims to be an antivirus scan', () => {
      const refusal = inspectUploadBytes({
        bytes: eicarFile(),
        contentType: 'text/plain',
        fileName: 'eicar.txt',
      })
      expect(refusal?.message).not.toMatch(/virus scan|antivirus scan|malware scan/i)
    })
  })

  describe('the head window contract', () => {
    it('publishes a head window large enough for every signature it checks', () => {
      expect(UPLOAD_INSPECTION_HEAD_BYTES).toBeGreaterThanOrEqual(1024)
    })

    it('asks for a tail read only for the document types whose macros hide there', () => {
      expect(uploadInspectionNeedsTail(DOCX)).toBe(true)
      expect(uploadInspectionNeedsTail(XLSX)).toBe(true)
      expect(uploadInspectionNeedsTail('application/msword')).toBe(true)
      // The types the signed route actually carries — a second ranged GET
      // against a 200 MB video would buy nothing.
      expect(uploadInspectionNeedsTail('video/mp4')).toBe(false)
      expect(uploadInspectionNeedsTail('image/png')).toBe(false)
      expect(uploadInspectionNeedsTail('application/zip')).toBe(false)
    })
  })
})
