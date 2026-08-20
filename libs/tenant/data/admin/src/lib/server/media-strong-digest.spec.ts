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
 * The bounded strong digest (AGL-1629).
 *
 * Three properties, in descending order of how badly getting them wrong
 * would bite:
 *
 *  1. **It STREAMS.** The whole reason a full-object digest was refused in
 *     AGL-1614 is that `file.download()` buffers, and buffering a 50 MB
 *     object inside a serverless function is a memory event, not a hashing
 *     one. A test that only asserted the hex would pass just as happily
 *     against a `download()` implementation, so this file asserts the peak
 *     resident chunk instead.
 *  2. **The ceiling refuses BEFORE the read.** "Bounded" has to mean no
 *     bytes leave the bucket, not "read them and then discard" — otherwise
 *     the bound costs the exact egress it exists to avoid.
 *  3. **It fails SOFT.** An unreadable object is an outage, and a finalize
 *     that 500s because the digest could not be taken would make the
 *     strong hash a new way for uploads to break. Same posture as the
 *     ranged inspection above it and the deny-list read below it.
 */

import { createHash } from 'crypto'
import { Readable } from 'stream'

import {
  MEDIA_STRONG_DIGEST_MAX_BYTES,
  storedObjectSha256,
  strongDigestWithinCeiling,
} from './media-strong-digest'

const sha256 = (buffer: Buffer) =>
  createHash('sha256').update(new Uint8Array(buffer)).digest('hex')

/**
 * A Storage file double that reports what it was actually asked to do.
 *
 * `chunkSize` is deliberately small and the payload deliberately larger, so
 * a consumer that collects the stream into one buffer is distinguishable
 * from one that hashes incrementally — see property (1).
 */
function storageFile(options: {
  bytes: Buffer
  chunkSize?: number
  throwOn?: 'open' | 'mid-stream'
}) {
  const chunkSize = options.chunkSize ?? 8
  const reads: number[] = []
  return {
    reads,
    opened: 0,
    createReadStream(this: { opened: number }) {
      this.opened += 1
      if (options.throwOn === 'open') throw new Error('storage unreachable')
      const chunks: Buffer[] = []
      for (let at = 0; at < options.bytes.length; at += chunkSize) {
        chunks.push(options.bytes.subarray(at, at + chunkSize))
      }
      let emitted = 0
      return new Readable({
        read() {
          if (options.throwOn === 'mid-stream' && emitted === 2) {
            this.destroy(new Error('connection reset'))
            return
          }
          const next = chunks[emitted]
          emitted += 1
          if (!next) {
            this.push(null)
            return
          }
          reads.push(next.length)
          this.push(next)
        },
      })
    },
  }
}

describe('strongDigestWithinCeiling', () => {
  it('covers every non-video signed upload at its own published ceiling', () => {
    // The ceiling is not a round number picked for comfort: it is exactly
    // the largest NON-VIDEO cap on the signed route (ZIP and .pptx are both
    // 50 MB). If this ever drops below one of them, a type that used to get
    // a strong digest silently stops, so the number is asserted rather than
    // trusted.
    expect(MEDIA_STRONG_DIGEST_MAX_BYTES).toBe(50 * 1024 * 1024)
    expect(strongDigestWithinCeiling(15 * 1024 * 1024)).toBe(true) // image
    expect(strongDigestWithinCeiling(25 * 1024 * 1024)).toBe(true) // PDF
    expect(strongDigestWithinCeiling(50 * 1024 * 1024)).toBe(true) // zip/pptx
  })

  it('refuses the one class it cannot afford — large video', () => {
    expect(strongDigestWithinCeiling(200 * 1024 * 1024)).toBe(false)
    expect(strongDigestWithinCeiling(50 * 1024 * 1024 + 1)).toBe(false)
  })

  it('treats an unknown size as over the ceiling, never under it', () => {
    // A composite object reports no size. Guessing "small" there would mean
    // starting an unbounded read on the one shape we cannot bound.
    expect(strongDigestWithinCeiling(0)).toBe(false)
    expect(strongDigestWithinCeiling(Number.NaN)).toBe(false)
    expect(strongDigestWithinCeiling(undefined as never)).toBe(false)
  })
})

describe('storedObjectSha256', () => {
  it('digests the whole object, matching what the in-process routes write', async () => {
    // The point of the exercise: the same bytes through /api/media/upload
    // and through signed finalize must present the SAME quarantine key.
    const bytes = Buffer.from('%PDF-1.7 an ordinary document', 'utf8')
    const file = storageFile({ bytes })
    const result = await storedObjectSha256({
      file,
      sizeBytes: bytes.length,
    })
    expect(result.sha256).toBe(sha256(bytes))
    expect(result.skipped).toBeUndefined()
    expect(result.bytesRead).toBe(bytes.length)
  })

  it('never holds the whole object in memory', async () => {
    // Property (1). 64 KB of payload delivered in 8-byte chunks: an
    // implementation that buffers shows a peak equal to the payload, one
    // that hashes incrementally shows a peak of one chunk.
    const bytes = Buffer.alloc(64 * 1024, 7)
    const file = storageFile({ bytes, chunkSize: 8 })
    const result = await storedObjectSha256({ file, sizeBytes: bytes.length })
    expect(result.sha256).toBe(sha256(bytes))
    expect(Math.max(...file.reads)).toBe(8)
    expect(result.peakChunkBytes).toBe(8)
  })

  it('reads NOTHING when the object is over the ceiling', async () => {
    // Property (2). `skipped` is what the caller writes down; `opened` is
    // what proves the bound was applied before the egress rather than after.
    const bytes = Buffer.alloc(64, 1)
    const file = storageFile({ bytes })
    const result = await storedObjectSha256({
      file,
      sizeBytes: bytes.length,
      maxBytes: 32,
    })
    expect(result.sha256).toBeUndefined()
    expect(result.skipped).toBe('over-ceiling')
    expect(result.bytesRead).toBe(0)
    expect(file.opened).toBe(0)
  })

  it('fails soft when the object cannot be opened', async () => {
    const file = storageFile({ bytes: Buffer.from('x'), throwOn: 'open' })
    const result = await storedObjectSha256({ file, sizeBytes: 1 })
    expect(result.sha256).toBeUndefined()
    expect(result.skipped).toBe('unreadable')
  })

  it('fails soft when the stream dies part way through', async () => {
    // A partial digest would be WORSE than none: it is a well-formed
    // 64-hex value that matches nothing, so it would be written to the
    // document, become the preferred quarantine key, and shadow the legacy
    // hash that would otherwise have matched.
    const bytes = Buffer.alloc(1024, 3)
    const file = storageFile({ bytes, chunkSize: 8, throwOn: 'mid-stream' })
    const result = await storedObjectSha256({ file, sizeBytes: bytes.length })
    expect(result.sha256).toBeUndefined()
    expect(result.skipped).toBe('unreadable')
  })

  it('refuses a digest whose byte count disagrees with the object size', async () => {
    // The same trap from the other direction: a stream that ends early
    // WITHOUT erroring (a truncated range, a proxy cutting the body) hands
    // back a clean-looking digest of the wrong file.
    const bytes = Buffer.alloc(64, 5)
    const file = storageFile({ bytes })
    const result = await storedObjectSha256({
      file,
      sizeBytes: bytes.length + 16,
    })
    expect(result.sha256).toBeUndefined()
    expect(result.skipped).toBe('unreadable')
  })
})
