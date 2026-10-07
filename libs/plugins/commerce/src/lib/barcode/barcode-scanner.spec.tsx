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

import { render, screen, waitFor } from '@testing-library/react'

const decodeImageData = jest.fn()
jest.mock('./barcode-decode', () => ({
  decodeImageData: (...args: unknown[]) => decodeImageData(...args),
}))

import { BarcodeScanner, cameraErrorMessage } from './barcode-scanner.component'

const stopTrack = jest.fn()
const stream = { getTracks: () => [{ stop: stopTrack }] }

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: jest.fn(() => Promise.resolve()),
  })
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    configurable: true,
    set: jest.fn(),
  })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 })
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
    drawImage: jest.fn(),
    getImageData: jest.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
  })) as any
})

beforeEach(() => {
  stopTrack.mockReset()
  decodeImageData.mockReset()
  ;(navigator as any).mediaDevices = { getUserMedia: jest.fn(async () => stream) }
  delete (globalThis as any).BarcodeDetector
})

describe('BarcodeScanner (AGL-3619)', () => {
  it('uses the browser’s BarcodeDetector where it exists and stops the camera on a read', async () => {
    const detect = jest.fn(async () => [{ rawValue: '036000291452', format: 'upc_a' }])
    ;(globalThis as any).BarcodeDetector = Object.assign(
      jest.fn(() => ({ detect })),
      { getSupportedFormats: async () => ['upc_a', 'ean_13', 'code_128'] },
    )
    const onDetected = jest.fn()
    render(<BarcodeScanner open onClose={jest.fn()} onDetected={onDetected} />)
    await waitFor(() => expect(onDetected).toHaveBeenCalledWith('036000291452', 'upc_a'))
    expect((globalThis as any).BarcodeDetector).toHaveBeenCalledWith({
      formats: ['ean_13', 'upc_a', 'code_128'],
    })
    expect(stopTrack).toHaveBeenCalled()
    expect(decodeImageData).not.toHaveBeenCalled()
  })

  it('falls back to the bundled reader, and confirms a code by reading it twice', async () => {
    decodeImageData
      .mockReturnValueOnce({ format: 'code_128', text: '1042' })
      .mockReturnValueOnce({ format: 'code_128', text: '1042' })
    const onDetected = jest.fn()
    render(<BarcodeScanner open onClose={jest.fn()} onDetected={onDetected} />)
    await waitFor(() => expect(onDetected).toHaveBeenCalledWith('1042', 'code_128'), { timeout: 2000 })
    expect(decodeImageData).toHaveBeenCalledTimes(2)
  })

  it('says what to do when the camera is blocked', async () => {
    ;(navigator as any).mediaDevices = {
      getUserMedia: jest.fn(async () => {
        throw Object.assign(new Error('denied'), { name: 'NotAllowedError' })
      }),
    }
    render(<BarcodeScanner open onClose={jest.fn()} onDetected={jest.fn()} />)
    expect(await screen.findByText(/Camera access is blocked/)).toBeTruthy()
  })

  it('maps camera errors to actions', () => {
    expect(cameraErrorMessage({ name: 'NotFoundError' })).toMatch(/No camera/)
    expect(cameraErrorMessage({ name: 'NotReadableError' })).toMatch(/in use/)
    expect(cameraErrorMessage(new Error('x'))).toMatch(/Type the code/)
  })
})
