import {
  IMAGE_EDIT_ASPECTS,
  imageEditContentType,
  imageEditCopyName,
  imageEditCropFromDrag,
  imageEditOutput,
  imageEditPreviewScale,
  imageEditWorkedSize,
} from './image-edit'

describe('image edit arithmetic', () => {
  it('swaps the sides on a quarter turn only', () => {
    expect(imageEditWorkedSize(400, 300, 0)).toEqual({ w: 400, h: 300 })
    expect(imageEditWorkedSize(400, 300, 90)).toEqual({ w: 300, h: 400 })
    expect(imageEditWorkedSize(400, 300, 180)).toEqual({ w: 400, h: 300 })
    expect(imageEditWorkedSize(400, 300, 270)).toEqual({ w: 300, h: 400 })
  })

  it('shrinks the preview to fit and never enlarges it', () => {
    expect(imageEditPreviewScale(960, 480)).toBe(0.5)
    expect(imageEditPreviewScale(100, 80)).toBe(1)
    expect(imageEditPreviewScale(0, 0)).toBe(1)
  })

  it('draws a free crop from the drag and keeps it inside the preview', () => {
    expect(
      imageEditCropFromDrag({ x: 10, y: 20 }, { x: 110, y: 90 }, null, 480, 300),
    ).toEqual({ x: 10, y: 20, w: 100, h: 70 })
    // Dragged up and to the left, the box still starts at its top left.
    expect(
      imageEditCropFromDrag({ x: 110, y: 90 }, { x: 10, y: 20 }, null, 480, 300),
    ).toEqual({ x: 10, y: 20, w: 100, h: 70 })
    // Past the right and bottom edges it is clamped to what is left.
    expect(
      imageEditCropFromDrag({ x: 400, y: 250 }, { x: 600, y: 400 }, null, 480, 300),
    ).toEqual({ x: 400, y: 250, w: 80, h: 50 })
  })

  it('locks the ratio from the width', () => {
    expect(
      imageEditCropFromDrag({ x: 0, y: 0 }, { x: 160, y: 10 }, 16 / 9, 480, 300),
    ).toEqual({ x: 0, y: 0, w: 160, h: 90 })
    expect(
      imageEditCropFromDrag({ x: 0, y: 0 }, { x: 100, y: 10 }, 1, 480, 60),
    ).toEqual({ x: 0, y: 0, w: 100, h: 60 })
  })

  it('maps the crop back to the image and downscales to a max width', () => {
    const worked = { w: 960, h: 480 }
    expect(imageEditOutput(worked, null, 0.5, 0)).toEqual({
      crop: { x: 0, y: 0, w: 960, h: 480 },
      width: 960,
      height: 480,
    })
    expect(
      imageEditOutput(worked, { x: 10, y: 20, w: 100, h: 50 }, 0.5, 0),
    ).toEqual({
      crop: { x: 20, y: 40, w: 200, h: 100 },
      width: 200,
      height: 100,
    })
    expect(
      imageEditOutput(worked, { x: 10, y: 20, w: 100, h: 50 }, 0.5, 100),
    ).toEqual({
      crop: { x: 20, y: 40, w: 200, h: 100 },
      width: 100,
      height: 50,
    })
    // A width at or above the crop's, or no number, keeps the size.
    expect(imageEditOutput(worked, null, 0.5, 960).width).toBe(960)
    expect(imageEditOutput(worked, null, 0.5, 5000).width).toBe(960)
    expect(imageEditOutput(worked, null, 0.5, Number.NaN).width).toBe(960)
    // Odd sizes round, and a result is never smaller than a pixel.
    expect(
      imageEditOutput({ w: 1000, h: 667 }, null, 1, 333),
    ).toEqual({ crop: { x: 0, y: 0, w: 1000, h: 667 }, width: 333, height: 222 })
    expect(imageEditOutput({ w: 0, h: 0 }, null, 1, 0)).toEqual({
      crop: { x: 0, y: 0, w: 0, h: 0 },
      width: 1,
      height: 1,
    })
    // A click that never dragged is no crop.
    expect(imageEditOutput(worked, { x: 5, y: 5, w: 0, h: 0 }, 0.5, 0)).toEqual(
      imageEditOutput(worked, null, 0.5, 0),
    )
  })

  it('names the copy and keeps a PNG a PNG', () => {
    expect(imageEditCopyName('photo.png')).toBe('photo (edited).png')
    expect(imageEditCopyName('a.b.jpeg')).toBe('a.b (edited).jpeg')
    expect(imageEditCopyName('photo')).toBe('photo (edited)')
    expect(imageEditContentType('Logo.PNG')).toBe('image/png')
    expect(imageEditContentType('photo.webp')).toBe('image/jpeg')
    expect(IMAGE_EDIT_ASPECTS.map((a) => a.label)).toEqual([
      'Free',
      '1:1',
      '4:3',
      '3:2',
      '16:9',
    ])
  })
})
