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
 * Read a video's dimensions and duration, and capture a poster frame, in the
 * browser at upload time (AGL-2742).
 *
 * ## Why the browser and not the server
 *
 * The server has no decoder. There is no ffmpeg in this repo and no
 * transcoder behind it, and standing one up is a recurring bill measured
 * against a $40/month budget plus a new deployable service that a Vercel
 * promotion does not ship. Even the metadata alone is expensive server-side:
 * an MP4 is free to place its `moov` atom at the END of the file, so reading
 * a duration can mean pulling 200 MB back out of Storage — the exact
 * download `generateStoredMediaVariants` is written to avoid, to answer a
 * question worth twelve bytes.
 *
 * The uploader's browser, meanwhile, has the file in hand and a hardware
 * decoder already loaded. A `<video>` reports `duration`, `videoWidth` and
 * `videoHeight` from `loadedmetadata`, and a `<canvas>` can lift a real frame
 * out of it. Cost: zero, at any volume, forever.
 *
 * ## Why the canvas is never tainted
 *
 * The source is `URL.createObjectURL(file)` — a same-origin blob, not a
 * network fetch — so `drawImage` followed by `toBlob` is not a cross-origin
 * read and no CORS attribute is involved. This technique does NOT generalize
 * to a video already in the DAM; that one is fetched over HTTP and would
 * taint the canvas.
 *
 * ## Everything here degrades
 *
 * The probe answers with whatever it managed and never throws. A codec the
 * browser cannot decode (ProRes, an exotic AV1 profile), a `duration` of
 * `Infinity` on a stream-flavoured WebM, a mobile Safari that refuses to
 * paint a frame it has not played, a decode that simply hangs — each yields
 * a partial result and a short reason, and the upload proceeds exactly as it
 * does today. Metadata and poster are reported INDEPENDENTLY, because the
 * commonest failure is a duration of `Infinity` on a file whose first frame
 * captures perfectly, and a poster is the half that makes a page fast.
 */

/** How long to wait for `loadedmetadata` before giving up on the file. */
const METADATA_TIMEOUT_MS = 10_000

/** How long to wait for the seek that precedes the frame grab. */
const SEEK_TIMEOUT_MS = 10_000

/**
 * Widest poster captured. Matches `MEDIA_POSTER_MAX_WIDTH` on the server,
 * which re-encodes and would only throw the extra pixels away — capturing
 * them costs base64 in a request body that has a 4.5 MB platform wall.
 */
const POSTER_MAX_WIDTH = 1920

/**
 * WebP quality for the capture. The server re-encodes at 72 regardless, so
 * this only has to be high enough that the round trip does not compound.
 */
const POSTER_QUALITY = 0.82

/**
 * Where in the film to grab the frame.
 *
 * Not frame zero. A cut from black is the single commonest way a film opens,
 * and a poster of pure black is worse than none — it reads as a broken image
 * rather than as a still. One second in is past almost every fade-in; the
 * 10% floor keeps a very short clip from seeking past its own end.
 */
function posterTimeSeconds(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0.1
  return Math.min(1, durationSeconds * 0.1)
}

export interface VideoProbeMetadata {
  durationMs: number
  width: number
  height: number
}

export interface VideoProbeResult {
  /** Absent when the browser could not report all three coherently. */
  video?: VideoProbeMetadata
  /** Base64 body of the captured still, no data-URL prefix. */
  posterBase64?: string
  /** Declared type of those bytes, for the server's own bookkeeping. */
  posterContentType?: string
  /**
   * Short, publishable note on what did not happen. Present only when
   * something was attempted and failed — the same two-failure-class contract
   * `media-variants.ts` keeps, so "this browser could not decode it" never
   * looks like "this file has no video in it".
   */
  reason?: string
}

/** Resolves with the event name that fired first, or `'timeout'`. */
function race(
  element: HTMLVideoElement,
  events: readonly string[],
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (outcome: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      for (const name of [...events, 'error']) {
        element.removeEventListener(name, handlers[name])
      }
      resolve(outcome)
    }
    const handlers: Record<string, () => void> = {}
    for (const name of [...events, 'error']) {
      handlers[name] = () => finish(name)
      element.addEventListener(name, handlers[name])
    }
    const timer = setTimeout(() => finish('timeout'), timeoutMs)
  })
}

/** Blob → base64 body, matching what the upload routes expect. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const result = String(reader.result ?? '')
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(blob)
  })
}

/** `canvas.toBlob` as a promise. Resolves null rather than rejecting. */
function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/webp', POSTER_QUALITY)
    } catch {
      resolve(null)
    }
  })
}

/**
 * Probe one video file. Never throws; never rejects.
 *
 * The element is created detached and revoked in a `finally`, so an
 * abandoned probe leaks neither an object URL nor a decoder: a media element
 * holding a blob URL keeps the whole file alive in memory, and the DAM
 * accepts 200 MB of it.
 */
export async function probeVideoFile(file: File): Promise<VideoProbeResult> {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    return { reason: 'no browser video decoder available' }
  }
  const objectUrl = URL.createObjectURL(file)
  const element = document.createElement('video')
  try {
    // `muted` and `playsInline` are not about playback — they are what stop
    // a mobile browser from treating an offscreen element as a user-gesture
    // violation and refusing to decode at all.
    element.muted = true
    element.playsInline = true
    element.preload = 'auto'
    element.src = objectUrl

    const loaded = await race(element, ['loadedmetadata'], METADATA_TIMEOUT_MS)
    if (loaded !== 'loadedmetadata') {
      return {
        reason:
          loaded === 'timeout'
            ? 'video metadata did not load in time'
            : 'browser could not decode this video',
      }
    }

    const width = Number(element.videoWidth)
    const height = Number(element.videoHeight)
    const durationSeconds = Number(element.duration)
    // `Infinity` here is the documented shape for a stream and for some WebM
    // files, not a fault — the file plays perfectly and simply has no
    // declared length until it has been seeked to the end. Reporting no
    // metadata is honest; reporting a duration of `Infinity` would put one
    // on a document and into a `VideoObject`.
    const video: VideoProbeMetadata | undefined =
      Number.isFinite(durationSeconds) && durationSeconds > 0 && width > 0 && height > 0
        ? {
            durationMs: Math.round(durationSeconds * 1000),
            width,
            height,
          }
        : undefined
    const partial = video ? {} : { reason: 'video reported no usable duration' }

    if (!(width > 0) || !(height > 0)) {
      return { ...partial, reason: 'video reported no frame size' }
    }

    element.currentTime = posterTimeSeconds(durationSeconds)
    const seeked = await race(element, ['seeked'], SEEK_TIMEOUT_MS)
    if (seeked !== 'seeked') {
      return { ...partial, video, reason: 'could not seek to a poster frame' }
    }

    const scale = Math.min(1, POSTER_MAX_WIDTH / width)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')
    if (!context) return { ...partial, video, reason: 'no 2d canvas context' }
    try {
      context.drawImage(element, 0, 0, canvas.width, canvas.height)
    } catch {
      // A SecurityError here would mean the canvas was tainted, which a blob
      // URL should make impossible — so this is a decoder that painted
      // nothing, most often mobile Safari on a file it has not played.
      return { ...partial, video, reason: 'browser would not paint a frame' }
    }

    const blob = await canvasToBlob(canvas)
    if (!blob || !blob.size) {
      return { ...partial, video, reason: 'poster frame encoded to nothing' }
    }
    return {
      ...partial,
      video,
      posterBase64: await blobToBase64(blob),
      // Whatever the browser actually produced. Safari before 14 hands back
      // PNG from a `image/webp` request without saying so, and the server
      // re-encodes through `sharp` regardless — so this is a record of what
      // was sent, never a claim the server acts on.
      posterContentType: blob.type || 'image/webp',
    }
  } catch (error) {
    return {
      reason: `video probe failed — ${String((error as Error)?.message ?? error).slice(0, 120)}`,
    }
  } finally {
    // Order matters: dropping the source first releases the decoder's hold on
    // the blob, so the revoke below actually frees it.
    element.removeAttribute('src')
    element.load()
    URL.revokeObjectURL(objectUrl)
  }
}
