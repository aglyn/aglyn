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
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

export interface ImageEditorResult {
  /** Base64 (no data-url prefix) of the edited image. */
  data: string
  contentType: string
  saveAsCopy: boolean
}

export interface ImageEditorDialogProps {
  open: boolean
  /** Source image URL (the asset's current url). */
  src: string
  fileName: string
  onClose: () => void
  onSave: (result: ImageEditorResult) => void
}

const ASPECT_PRESETS: Array<{ label: string; ratio: number | null }> = [
  { label: 'Free', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '3:2', ratio: 3 / 2 },
  { label: '16:9', ratio: 16 / 9 },
]

const PREVIEW_MAX = 480

/**
 * Client-side image editor (AGL-184): rotate 90°, flip, aspect-locked crop
 * (draggable selection), and downscale — all on a canvas, no new deps. The
 * result feeds the replace-file path (overwrite the asset) or save-as-copy
 * (a new upload). Crop is drawn in preview coordinates and mapped back to
 * the rotated working canvas at export so it stays pixel-accurate.
 */
export function ImageEditorDialog(props: ImageEditorDialogProps) {
  const { open, src, fileName, onClose, onSave } = props
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [rotation, setRotation] = useState(0)
  const [flipH, setFlipH] = useState(false)
  const [flipV, setFlipV] = useState(false)
  const [aspect, setAspect] = useState<number | null>(null)
  const [maxWidth, setMaxWidth] = useState('')
  // Crop rect in preview-canvas pixels; null = whole image.
  const [crop, setCrop] = useState<{
    x: number
    y: number
    w: number
    h: number
  } | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)

  // Load the source (crossOrigin so the canvas stays untainted/exportable).
  useEffect(() => {
    if (!open || !src) return
    setRotation(0)
    setFlipH(false)
    setFlipV(false)
    setAspect(null)
    setMaxWidth('')
    setCrop(null)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => setImage(img)
    img.onerror = () => setImage(null)
    img.src = src
  }, [open, src])

  // The working image dimensions after rotation (before crop).
  const worked = useMemo(() => {
    if (!image) return { w: 0, h: 0 }
    const swapped = rotation === 90 || rotation === 270
    return {
      w: swapped ? image.naturalHeight : image.naturalWidth,
      h: swapped ? image.naturalWidth : image.naturalHeight,
    }
  }, [image, rotation])

  // Preview scale so the longest side fits PREVIEW_MAX.
  const scale = useMemo(() => {
    if (!worked.w || !worked.h) return 1
    return Math.min(1, PREVIEW_MAX / Math.max(worked.w, worked.h))
  }, [worked])
  const previewW = Math.round(worked.w * scale)
  const previewH = Math.round(worked.h * scale)

  /** Draws the rotated/flipped image + crop overlay into the preview. */
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !image) return
    canvas.width = previewW
    canvas.height = previewH
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, previewW, previewH)
    ctx.save()
    ctx.translate(previewW / 2, previewH / 2)
    ctx.rotate((rotation * Math.PI) / 180)
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
    const drawW = (rotation === 90 || rotation === 270 ? previewH : previewW)
    const drawH = (rotation === 90 || rotation === 270 ? previewW : previewH)
    ctx.drawImage(image, -drawW / 2, -drawH / 2, drawW, drawH)
    ctx.restore()
    if (crop) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)'
      // Dim everything outside the crop.
      ctx.fillRect(0, 0, previewW, crop.y)
      ctx.fillRect(0, crop.y + crop.h, previewW, previewH - crop.y - crop.h)
      ctx.fillRect(0, crop.y, crop.x, crop.h)
      ctx.fillRect(crop.x + crop.w, crop.y, previewW - crop.x - crop.w, crop.h)
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1
      ctx.strokeRect(crop.x + 0.5, crop.y + 0.5, crop.w, crop.h)
    }
  }, [image, previewW, previewH, rotation, flipH, flipV, crop])

  useEffect(() => {
    draw()
  }, [draw])

  const pointerPos = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(previewW, event.clientX - rect.left)),
      y: Math.max(0, Math.min(previewH, event.clientY - rect.top)),
    }
  }
  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    dragStart.current = pointerPos(event)
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!dragStart.current) return
    const start = dragStart.current
    const now = pointerPos(event)
    const w = Math.abs(now.x - start.x)
    // Aspect lock is width-led; free crop uses the dragged height.
    const h = aspect ? w / aspect : Math.abs(now.y - start.y)
    const x = Math.min(start.x, now.x)
    const y = Math.min(start.y, now.y)
    setCrop({
      x,
      y,
      w: Math.min(w, previewW - x),
      h: Math.min(h, previewH - y),
    })
  }
  const handlePointerUp = () => {
    dragStart.current = null
  }

  const applyAspect = (ratio: number | null) => {
    setAspect(ratio)
    setCrop(null)
  }

  const exportImage = useCallback(
    (saveAsCopy: boolean) => {
      if (!image) return
      // 1) Render the rotated/flipped image at natural resolution.
      const workCanvas = document.createElement('canvas')
      workCanvas.width = worked.w
      workCanvas.height = worked.h
      const wctx = workCanvas.getContext('2d')
      if (!wctx) return
      wctx.save()
      wctx.translate(worked.w / 2, worked.h / 2)
      wctx.rotate((rotation * Math.PI) / 180)
      wctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
      const dW = rotation === 90 || rotation === 270 ? worked.h : worked.w
      const dH = rotation === 90 || rotation === 270 ? worked.w : worked.h
      wctx.drawImage(image, -dW / 2, -dH / 2, dW, dH)
      wctx.restore()

      // 2) Map the preview crop back to natural coords.
      const invScale = scale ? 1 / scale : 1
      const cropNat = crop
        ? {
            x: Math.round(crop.x * invScale),
            y: Math.round(crop.y * invScale),
            w: Math.round(crop.w * invScale),
            h: Math.round(crop.h * invScale),
          }
        : { x: 0, y: 0, w: worked.w, h: worked.h }

      // 3) Optional downscale to max width.
      const maxW = Number(maxWidth)
      const targetW =
        Number.isFinite(maxW) && maxW > 0 && maxW < cropNat.w ? maxW : cropNat.w
      const targetH = Math.round((cropNat.h * targetW) / cropNat.w)

      const out = document.createElement('canvas')
      out.width = Math.max(1, targetW)
      out.height = Math.max(1, targetH)
      const octx = out.getContext('2d')
      if (!octx) return
      octx.drawImage(
        workCanvas,
        cropNat.x,
        cropNat.y,
        cropNat.w,
        cropNat.h,
        0,
        0,
        out.width,
        out.height,
      )

      // Preserve PNG for lossless sources; JPEG otherwise.
      const isPng = /\.png$/i.test(fileName)
      const contentType = isPng ? 'image/png' : 'image/jpeg'
      const dataUrl = out.toDataURL(contentType, 0.9)
      onSave({
        data: dataUrl.slice(dataUrl.indexOf(',') + 1),
        contentType,
        saveAsCopy,
      })
    },
    [
      image,
      worked,
      rotation,
      flipH,
      flipV,
      scale,
      crop,
      maxWidth,
      fileName,
      onSave,
    ],
  )

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{`Edit image — ${fileName}`}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ alignItems: 'center', pt: 1 }}>
          <Box
            sx={{
              bgcolor: 'action.hover',
              borderRadius: 1,
              p: 1,
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <canvas
              ref={canvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              style={{ touchAction: 'none', cursor: 'crosshair', maxWidth: '100%' }}
            />
          </Box>
          {!image ? (
            <Typography variant="body2" color="text.secondary">
              {'Loading image…'}
            </Typography>
          ) : null}
          <Stack
            direction="row"
            spacing={1}
            sx={{ flexWrap: 'wrap', justifyContent: 'center', rowGap: 1 }}
          >
            <Button
              size="small"
              onClick={() => setRotation((r) => (r + 270) % 360)}
            >
              {'⟲ Rotate left'}
            </Button>
            <Button
              size="small"
              onClick={() => setRotation((r) => (r + 90) % 360)}
            >
              {'⟳ Rotate right'}
            </Button>
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={flipH}
                  onChange={(e) => setFlipH(e.target.checked)}
                />
              }
              label="Flip H"
            />
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={flipV}
                  onChange={(e) => setFlipV(e.target.checked)}
                />
              }
              label="Flip V"
            />
          </Stack>
          <Stack
            direction="row"
            spacing={1}
            sx={{ flexWrap: 'wrap', justifyContent: 'center', rowGap: 1 }}
          >
            <TextField
              select
              size="small"
              label="Crop ratio"
              value={aspect ?? 'free'}
              onChange={(e) =>
                applyAspect(
                  e.target.value === 'free' ? null : Number(e.target.value),
                )
              }
              sx={{ minWidth: 120 }}
            >
              {ASPECT_PRESETS.map((preset) => (
                <MenuItem
                  key={preset.label}
                  value={preset.ratio ?? 'free'}
                >
                  {preset.label}
                </MenuItem>
              ))}
            </TextField>
            <Button size="small" onClick={() => setCrop(null)}>
              {'Clear crop'}
            </Button>
            <TextField
              size="small"
              type="number"
              label="Max width (px)"
              value={maxWidth}
              onChange={(e) => setMaxWidth(e.target.value)}
              helperText="Blank = keep size"
              sx={{ width: 140 }}
            />
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {'Drag on the image to set a crop; pick a ratio first to lock ' +
              'proportions.'}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Cancel'}</Button>
        <Button disabled={!image} onClick={() => exportImage(true)}>
          {'Save as copy'}
        </Button>
        <Button
          variant="contained"
          color="secondary"
          disabled={!image}
          onClick={() => exportImage(false)}
        >
          {'Replace original'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
ImageEditorDialog.displayName = 'ImageEditorDialog'

export default ImageEditorDialog
