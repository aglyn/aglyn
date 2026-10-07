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
'use client'

import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DecodedBarcode } from './barcode-decode'

/**
 * Camera barcode scanning (AGL-3619), for a register on a tablet or phone
 * and for the product editor's barcode field.
 *
 * The browser's own `BarcodeDetector` reads the frames where it exists
 * (Chrome on Android and macOS); elsewhere — Safari on the iPad, Chrome on
 * Windows — the small reader in `barcode-decode.ts` does, loaded only when
 * the scanner first opens there. Either way the result is the TEXT a USB or
 * Bluetooth scanner would have typed, handed to the same lookup.
 */
export interface BarcodeScannerProps {
  open: boolean
  onClose: () => void
  onDetected: (code: string, format: string) => void
  title?: string
}

/** Formats a counter scans; the native detector is asked for these and no others. */
const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code']

/** Frames read per second: enough to feel instant, little enough to leave a tablet cool. */
const FRAME_INTERVAL_MS = 120

/** The fallback reader confirms a code by reading it twice within this window. */
const CONFIRM_WITHIN_MS = 1500

type Reader = (video: HTMLVideoElement) => Promise<DecodedBarcode | null>

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string; format: string }>>
}

async function nativeReader(): Promise<Reader | null> {
  const Detector = (globalThis as any).BarcodeDetector
  if (typeof Detector !== 'function') return null
  try {
    const supported: string[] = (await Detector.getSupportedFormats?.()) ?? []
    const formats = NATIVE_FORMATS.filter((format) => supported.includes(format))
    if (!formats.length) return null
    const detector: BarcodeDetectorLike = new Detector({ formats })
    return async (video) => {
      const [found] = await detector.detect(video)
      return found?.rawValue ? { format: found.format as DecodedBarcode['format'], text: found.rawValue } : null
    }
  } catch {
    return null
  }
}

async function fallbackReader(): Promise<Reader> {
  const { decodeImageData } = await import('./barcode-decode')
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })
  return async (video) => {
    if (!context || !video.videoWidth) return null
    // A 1D reader needs width, not height: a wide, short strip through the
    // guide is enough, and a smaller canvas is a faster read.
    const width = Math.min(1280, video.videoWidth)
    const height = Math.round((video.videoHeight * width) / video.videoWidth)
    const strip = Math.round(height * 0.4)
    canvas.width = width
    canvas.height = strip
    context.drawImage(
      video,
      0,
      (video.videoHeight - (strip * video.videoWidth) / width) / 2,
      video.videoWidth,
      (strip * video.videoWidth) / width,
      0,
      0,
      width,
      strip,
    )
    return decodeImageData(context.getImageData(0, 0, width, strip), { rows: 11, band: 0.9 })
  }
}

/** Why the camera could not start, in words a cashier can act on. */
export function cameraErrorMessage(error: unknown): string {
  const name = (error as { name?: string })?.name ?? ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera access is blocked. Allow the camera for this site in the browser settings, then try again.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No camera was found on this device. Use a USB or Bluetooth scanner, or type the code.'
  }
  if (name === 'NotReadableError') {
    return 'The camera is in use by another app. Close it and try again.'
  }
  return 'The camera could not be started. Type the code instead.'
}

export function BarcodeScanner(props: BarcodeScannerProps) {
  const { open, onClose, onDetected, title } = props
  const theme = useTheme()
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'))
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const detectedRef = useRef(onDetected)
  detectedRef.current = onDetected

  const stopRef = useRef<() => void>(() => undefined)
  const close = useCallback(() => {
    stopRef.current()
    onClose()
  }, [onClose])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let lastRead: { text: string; atMs: number } | null = null
    const stop = () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      stream?.getTracks().forEach((track) => track.stop())
      stream = null
    }
    stopRef.current = stop
    setError('')
    setStarting(true)
    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This browser cannot use the camera here. Type the code, or use a USB or Bluetooth scanner.')
        setStarting(false)
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        })
      } catch (cause) {
        if (!cancelled) {
          setError(cameraErrorMessage(cause))
          setStarting(false)
        }
        return
      }
      if (cancelled) return stop()
      const video = videoRef.current
      if (!video) return stop()
      video.srcObject = stream
      video.setAttribute('playsinline', 'true')
      await video.play().catch(() => undefined)
      const native = await nativeReader()
      const read = native ?? (await fallbackReader())
      const needsConfirm = !native
      if (cancelled) return
      setStarting(false)
      const tick = async () => {
        if (cancelled) return
        const found: DecodedBarcode | null = await read(video).catch(() => null)
        if (cancelled) return
        if (found) {
          const now = Date.now()
          const confirmed =
            !needsConfirm ||
            (lastRead && lastRead.text === found.text && now - lastRead.atMs < CONFIRM_WITHIN_MS)
          lastRead = { text: found.text, atMs: now }
          if (confirmed) {
            navigator.vibrate?.(40)
            stop()
            detectedRef.current(found.text, found.format)
            return
          }
        }
        timer = setTimeout(tick, FRAME_INTERVAL_MS)
      }
      void tick()
    })()
    return stop
  }, [open])

  return (
    <Dialog open={open} onClose={close} fullScreen={fullScreen} fullWidth maxWidth="sm">
      <DialogTitle>{title ?? 'Scan a barcode'}</DialogTitle>
      <DialogContent>
        {error ? (
          <Alert severity="warning">{error}</Alert>
        ) : (
          <Box
            sx={{
              position: 'relative',
              width: '100%',
              aspectRatio: '4 / 3',
              bgcolor: 'common.black',
              borderRadius: 1,
              overflow: 'hidden',
            }}
          >
            <Box
              component="video"
              ref={videoRef}
              muted
              playsInline
              aria-label="Camera preview"
              sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
            <Box
              aria-hidden
              sx={{
                position: 'absolute',
                left: '8%',
                right: '8%',
                top: '35%',
                bottom: '35%',
                border: 2,
                borderColor: 'primary.main',
                borderRadius: 1,
              }}
            />
          </Box>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {starting
            ? 'Starting the camera…'
            : 'Hold the barcode flat inside the frame, lines running up and down.'}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{'Cancel'}</Button>
      </DialogActions>
    </Dialog>
  )
}
BarcodeScanner.displayName = 'BarcodeScanner'

export default BarcodeScanner
