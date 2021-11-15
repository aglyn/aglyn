import {
  boundCoordinates,
  getScaleMultiplier,
  getTransformedBoundingBox,
  TransformMatrix,
  ZOOM_SPEED_MULTIPLIER,
} from './util'


describe('getScaleMultiplier', () => {
  test('delta == 0 should return 1', () => {
    expect(getScaleMultiplier(0)).toBe(1)
  })

  test('delta > 0 should return multiplier < 1', () => {
    expect(getScaleMultiplier(1)).toBeLessThan(1)
  })

  test('delta < 0 should return multiplier > 1', () => {
    expect(getScaleMultiplier(-1)).toBeGreaterThan(1)
  })

  test('should default to zoomSpeed == 1 if not set', () => {
    expect(getScaleMultiplier(1)).toBe(1 - ZOOM_SPEED_MULTIPLIER)
    expect(getScaleMultiplier(-1)).toBe(1 + ZOOM_SPEED_MULTIPLIER)
  })
})

describe('TransformMatrix', () => {
  test('should create valid translation matrix', () => {
    expect(TransformMatrix({
      angle: 0,
      scale: 1,
      offsetX: 1,
      offsetY: 1,
    }, {x: 1, y: 1})).toEqual({a: 1, b: 0, c: -0, d: 1, x: 1, y: 1})
  })

  test('should create valid scale matrix', () => {
    expect(TransformMatrix({
      angle: 0,
      scale: 2,
      offsetX: 0,
      offsetY: 0,
    }, {x: 1, y: 1})).toEqual({a: 2, b: 0, c: -0, d: 2, x: 0, y: 0})
  })

  test('should create valid rotation matrix', () => {
    const matrix = TransformMatrix({
      angle: 90,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    }, {x: 1, y: 1})
    expect(matrix.a).toBeCloseTo(0)
    expect(matrix.b).toBe(1)
    expect(matrix.c).toBe(-1)
    expect(matrix.d).toBeCloseTo(0)
    expect(matrix.x).toBe(2)
    expect(matrix.y).toBe(0)

    const matrix1 = TransformMatrix({
      angle: 45,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    }, {x: 1, y: 1})
    expect(matrix1.a).toBeCloseTo(0.7071, 4)
    expect(matrix1.b).toBeCloseTo(0.7071, 4)
    expect(matrix1.c).toBeCloseTo(-0.7071, 4)
    expect(matrix1.d).toBeCloseTo(0.7071, 4)
    expect(matrix1.x).toBeCloseTo(1)
    expect(matrix1.y).toBeCloseTo(-0.4142, 4)

    const matrix2 = TransformMatrix({
      angle: 180,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    }, {x: 1, y: 1})
    expect(matrix2.a).toBe(-1)
    expect(matrix2.b).toBeCloseTo(0)
    expect(matrix2.c).toBeCloseTo(0)
    expect(matrix2.d).toBe(-1)
    expect(matrix2.x).toBe(2)
    expect(matrix2.y).toBe(2)
  })
})

describe('getTransformedBoundingBox', () => {
  test('should return valid transformed bounding box', () => {
    const boundingBox = getTransformedBoundingBox({
      angle: 45,
      scale: 2,
      offsetX: 1,
      offsetY: 1,
    }, {top: 1, left: 1, width: 1, height: 1})
    expect(boundingBox.top).toBeCloseTo(3.4142, 4)
    expect(boundingBox.left).toBeCloseTo(0.5858, 4)
    expect(boundingBox.width).toBeCloseTo(2.8284, 4)
    expect(boundingBox.height).toBeCloseTo(2.8284, 4)
  })
})

describe('boundCoordinates', () => {
  test('should return valid bound coordinates if not exceeding boundaries', () => {
    const coordinates = boundCoordinates(1, 1,
      {vertical: 0.8, horizontal: 0.8},
      {top: 1, left: 1, width: 1, height: 1},
      2, 2, 1, 1,
    )
    expect(coordinates.boundX).toBe(1)
    expect(coordinates.boundY).toBe(1)
    expect(coordinates.offsetX).toBe(1)
    expect(coordinates.offsetY).toBe(1)
  })

  test('should return valid bound coordinates if exceeding boundaries on x and y axis', () => {
    const coordinates = boundCoordinates(2, 2,
      {vertical: 0.8, horizontal: 0.8},
      {top: 2, left: 2, width: 1, height: 1},
      2, 2, 2, 2,
    )
    expect(coordinates.boundX).toBe(1.8)
    expect(coordinates.boundY).toBe(1.8)
    expect(coordinates.offsetX).toBe(1.8)
    expect(coordinates.offsetY).toBe(1.8)
  })
})
