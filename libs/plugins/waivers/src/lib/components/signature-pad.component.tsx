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

import { Box, Button, Stack, Typography } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { WaiverStrokes } from '../model/waiver-signature'

/*==========================================
 * THE SIGNATURE PAD (AGL-4042): a finger, a stylus or a mouse draws on a
 * white card in black ink, whatever the page's own colors, because a
 * signature is a mark on paper. It reports the strokes, 0–1000 across and
 * down, which the server keeps and the PDF redraws, and the picture as a PNG.
 *=========================================*/

export interface SignaturePadProps {
  /** Called after every stroke and on Clear (`null`). */
  onChange: (value: { strokes: WaiverStrokes; png: string } | null) => void
  disabled?: boolean
  /** The pad's accessible name. */
  label?: string
}

const ASPECT = 3

export function SignaturePad({ onChange, disabled = false, label = 'Signature' }: SignaturePadProps) {
  const theme = useTheme()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const strokes = useRef<WaiverStrokes>([])
  const drawing = useRef(false)
  const [empty, setEmpty] = useState(true)
  const ink = theme.palette.common.black
  const paper = theme.palette.common.white

  const paint = useCallback(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const width = canvas.width
    const height = canvas.height
    context.clearRect(0, 0, width, height)
    context.fillStyle = paper
    context.fillRect(0, 0, width, height)
    context.strokeStyle = ink
    context.lineWidth = Math.max(2, width / 320)
    context.lineCap = 'round'
    context.lineJoin = 'round'
    for (const stroke of strokes.current) {
      context.beginPath()
      stroke.forEach(([x, y], index) => {
        const px = (x / 1000) * width
        const py = (y / 1000) * height
        if (index === 0) context.moveTo(px, py)
        else context.lineTo(px, py)
      })
      if (stroke.length === 1) context.lineTo((stroke[0][0] / 1000) * width + 0.5, (stroke[0][1] / 1000) * height)
      context.stroke()
    }
  }, [ink, paper])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      const width = Math.round(canvas.clientWidth * ratio)
      canvas.width = width
      canvas.height = Math.round(width / ASPECT)
      paint()
    }
    resize()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null
    observer?.observe(canvas)
    return () => observer?.disconnect()
  }, [paint])

  const point = (event: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.round(((event.clientX - rect.left) / Math.max(1, rect.width)) * 1000)
    const y = Math.round(((event.clientY - rect.top) / Math.max(1, rect.height)) * 1000)
    return [Math.min(1000, Math.max(0, x)), Math.min(1000, Math.max(0, y))]
  }

  const report = () => {
    const canvas = canvasRef.current
    if (!strokes.current.length || !canvas) {
      onChange(null)
      return
    }
    onChange({ strokes: strokes.current.map((stroke) => stroke.slice()), png: canvas.toDataURL('image/png') })
  }

  return (
    <Stack spacing={1}>
      <Box
        component="canvas"
        ref={canvasRef}
        role="img"
        aria-label={empty ? `${label}: empty. Draw your signature here.` : `${label}: signed`}
        onPointerDown={(event: React.PointerEvent<HTMLCanvasElement>) => {
          if (disabled) return
          event.currentTarget.setPointerCapture?.(event.pointerId)
          drawing.current = true
          strokes.current.push([point(event)])
          setEmpty(false)
          paint()
        }}
        onPointerMove={(event: React.PointerEvent<HTMLCanvasElement>) => {
          if (!drawing.current) return
          const stroke = strokes.current[strokes.current.length - 1]
          const next = point(event)
          const last = stroke[stroke.length - 1]
          if (Math.abs(next[0] - last[0]) + Math.abs(next[1] - last[1]) < 3) return
          if (strokes.current.reduce((total, one) => total + one.length, 0) >= 3900) return
          stroke.push(next)
          paint()
        }}
        onPointerUp={() => {
          if (!drawing.current) return
          drawing.current = false
          report()
        }}
        onPointerCancel={() => {
          drawing.current = false
          report()
        }}
        sx={{
          display: 'block',
          width: '100%',
          aspectRatio: `${ASPECT}`,
          touchAction: 'none',
          cursor: disabled ? 'default' : 'crosshair',
          bgcolor: 'common.white',
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          opacity: disabled ? 0.6 : 1,
        }}
      />
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary">
          {'Sign with your finger, a stylus or a mouse.'}
        </Typography>
        <Button
          size="small"
          disabled={disabled || empty}
          onClick={() => {
            strokes.current = []
            setEmpty(true)
            paint()
            onChange(null)
          }}
        >
          {'Clear'}
        </Button>
      </Stack>
    </Stack>
  )
}

export default SignaturePad
