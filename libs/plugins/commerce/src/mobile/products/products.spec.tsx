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
const mockLayout = { split: false }
const mockScan = { code: '' }

jest.mock('firebase/firestore', () => require('../testing/firestore-double').firestoreDouble.module)
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
)
jest.mock('@expo/vector-icons/Ionicons', () => () => null)
jest.mock('expo-print', () => ({ printAsync: jest.fn(async () => undefined) }))
jest.mock('expo-camera', () => ({
  // A camera that reads the code a spec puts in front of it.
  CameraView: (props: { onBarcodeScanned?: (scan: { data: string }) => void }) => {
    const { Pressable } = jest.requireActual('react-native')
    const React = jest.requireActual('react')
    return React.createElement(Pressable, { testID: 'mock-camera', onPress: () => props.onBarcodeScanned?.({ data: mockScan.code }) })
  },
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
}))
jest.mock('expo-image-picker', () => ({}))
jest.mock('@aglyn/mobile-core', () => ({ getMobileConfig: () => ({}) }))
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ canGoBack: () => false, goBack: jest.fn() }) }))
jest.mock('@aglyn/mobile-ui', () => {
  const actual = jest.requireActual('@aglyn/mobile-ui')
  return {
    ...actual,
    Screen: ({ children }: { children: unknown }) => children,
    useLayout: () => ({ ...actual.layoutFor(mockLayout.split ? 1024 : 390, 800), split: mockLayout.split }),
    SplitView: ({ list, detail }: { list: unknown; detail: unknown }) => {
      const { View } = jest.requireActual('react-native')
      const React = jest.requireActual('react')
      return mockLayout.split
        ? React.createElement(View, { testID: 'split-view' }, list, detail)
        : React.createElement(React.Fragment, null, list)
    },
  }
})

import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { createApiDouble, firestoreDouble as double } from '../testing/firestore-double'
import { pluginContext, renderScreen } from '../testing/render.spec-helpers'
import ProductsScreen from './products-screen'
import ScanScreen from './scan-screen'

const mug = {
  name: 'Stoneware Mug',
  nameLower: 'stoneware mug',
  slug: 'mug',
  type: 'physical',
  status: 'active',
  variants: [{ id: 'default', sku: 'MUG-01', barcode: '0123456789012', priceUsd: 24, inventory: 18 }],
  skus: ['mug-01'],
  barcodes: ['0123456789012'],
  inventory: 18,
  deletedAt: null,
}

function seed() {
  double.reset()
  double.setDoc('hosts/h1/settings/store', { currency: 'USD' })
  double.setCollection('hosts/h1/products', [
    { id: 'p1', data: mug },
    { id: 'p2', data: { ...mug, name: 'Canvas Tote', nameLower: 'canvas tote', variants: [{ id: 'default', priceUsd: 19, inventory: 2 }] } },
  ])
  double.setDoc('hosts/h1/products/p1', mug)
}

describe('the products screens (AGL-3621)', () => {
  beforeEach(() => {
    seed()
    mockLayout.split = false
    mockScan.code = ''
  })

  it('lists products and opens one in the editor on a phone', async () => {
    const context = pluginContext(createApiDouble().client)
    await renderScreen(<ProductsScreen context={context} params={{}} />)
    expect(await screen.findByText('Stoneware Mug')).toBeTruthy()
    expect(screen.getByText('Canvas Tote')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('product-p1'))
    expect(context.navigate).toHaveBeenCalledWith('commerce.product', { productId: 'p1' })
  })

  it('narrows by status with a Firestore query', async () => {
    await renderScreen(<ProductsScreen context={pluginContext(createApiDouble().client)} params={{}} />)
    await screen.findByText('Stoneware Mug')
    await fireEvent.press(screen.getByTestId('products-filter-draft'))
    await waitFor(() =>
      expect(JSON.stringify(double.queries[double.queries.length - 1].constraints)).toContain('"value":"draft"'),
    )
  })

  it('finds a scanned barcode by its index and offers the stock adjust', async () => {
    mockScan.code = '0123456789012'
    await renderScreen(<ScanScreen context={pluginContext(createApiDouble().client)} params={{}} />)
    await fireEvent.press(screen.getByTestId('scan-again'))
    await fireEvent.press(await screen.findByTestId('mock-camera'))
    expect(await screen.findByTestId('scan-adjust-default')).toBeTruthy()
    expect(JSON.stringify(double.queries[0].constraints)).toContain('"path":"barcodes"')
    expect(screen.getByText(/18 in stock/)).toBeTruthy()
  })

  it('offers to add a product when a scanned code names none', async () => {
    double.setCollection('hosts/h1/products', [])
    mockScan.code = '999'
    const context = pluginContext(createApiDouble().client)
    await renderScreen(<ScanScreen context={context} params={{}} />)
    await fireEvent.press(screen.getByTestId('scan-again'))
    await fireEvent.press(await screen.findByTestId('mock-camera'))
    expect(await screen.findByText('No product has this code')).toBeTruthy()
    await fireEvent.press(screen.getByText('Add a product with it'))
    expect(context.navigate).toHaveBeenCalledWith('commerce.product', { productId: 'new', barcode: '999' })
  })
})
