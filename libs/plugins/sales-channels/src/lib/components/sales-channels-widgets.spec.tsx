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

import ConfirmationProviderComponent from '@aglyn/shared-ui-jsx/components/confirmation-provider.component'
import { fireEvent, render as renderBare, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { SALES_CHANNELS_API_ROUTES } from '../constants/bundle-common'
import { ProductChannelFields } from './product-channel-fields.component'
import type { SalesChannelsState } from './sales-channels-api'
import { SalesChannelsCard } from './sales-channels-card.component'

/**
 * The sales channels plugin's console widgets (AGL-3637): the card on the
 * store's Settings — a card per channel with its switch, address, setup
 * steps and what its feed leaves out — and the channel fields in the
 * product editor.
 */

/** The console mounts the shared confirmation provider above every widget. */
const render = (ui: ReactElement) => renderBare(<ConfirmationProviderComponent>{ui}</ConfirmationProviderComponent>)

const request = jest.fn()
const enqueueSnackbar = jest.fn()

jest.mock('./sales-channels-api', () => ({
  ...jest.requireActual('./sales-channels-api'),
  useSalesChannelsFetch: () => request,
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))

const URL_GOOGLE = 'https://candles.example.com/api/sales-channels/feed/google/TOKEN.xml?hostId=host-1'

function state(overrides: Partial<SalesChannelsState> = {}): SalesChannelsState {
  return {
    sells: true,
    store: {
      name: 'Candle Co',
      origin: 'https://candles.example.com',
      currency: 'USD',
      productPagesServed: true,
      carrierPricedCountries: [],
    },
    channels: ['google', 'meta', 'tiktok', 'pinterest', 'snapchat', 'microsoft'].map((id) => ({
      id: id as never,
      enabled: id === 'google',
      url: id === 'google' ? URL_GOOGLE : null,
      createdAtMs: id === 'google' ? 1 : null,
      rotatedAtMs: null,
      lastFetchAtMs: null,
      lastFetchAgent: null,
    })),
    legacy: { url: 'https://candles.example.com/api/commerce/feed?hostId=host-1', active: true },
    settings: { defaultBrand: '', defaultCondition: 'new', defaultGoogleCategory: '' },
    ...overrides,
  }
}

beforeEach(() => {
  request.mockReset()
  enqueueSnackbar.mockReset()
})

describe('SalesChannelsCard', () => {
  it('draws a card per channel with its setup steps, and the address only for a feed that is on', async () => {
    request.mockResolvedValueOnce(state())
    render(<SalesChannelsCard hostId="host-1" />)
    await screen.findByTestId('sales-channels-card')
    expect(request).toHaveBeenCalledWith(SALES_CHANNELS_API_ROUTES.state, { query: { hostId: 'host-1' } })
    for (const id of ['google', 'meta', 'tiktok', 'pinterest', 'snapchat', 'microsoft']) {
      expect(screen.getByTestId(`sales-channel-${id}`)).toBeTruthy()
    }
    const google = within(screen.getByTestId('sales-channel-google'))
    expect((google.getByLabelText('Google feed address') as HTMLInputElement).value).toBe(URL_GOOGLE)
    expect(google.getByText(/Paste the feed URL below/)).toBeTruthy()
    expect(within(screen.getByTestId('sales-channel-meta')).queryByLabelText('Meta feed address')).toBeNull()
    expect(screen.getByText(/earlier Merchant Center address still works/)).toBeTruthy()
    expect(google.getByText('On')).toBeTruthy()
    expect(google.getByText('Not read yet')).toBeTruthy()
    expect(within(screen.getByTestId('sales-channel-tiktok')).getByText('CSV feed')).toBeTruthy()
  })

  it('copies a feed address from its field', async () => {
    const writeText = jest.fn(async () => undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    request.mockResolvedValueOnce(state())
    render(<SalesChannelsCard hostId="host-1" />)
    await screen.findByTestId('sales-channels-card')
    fireEvent.click(screen.getByRole('button', { name: 'Copy google feed address' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL_GOOGLE))
    expect(enqueueSnackbar).toHaveBeenCalledWith('Feed address copied', expect.anything())
  })

  it('pages a long list of products a feed leaves out', async () => {
    request.mockResolvedValueOnce(state())
    render(<SalesChannelsCard hostId="host-1" />)
    await screen.findByTestId('sales-channels-card')
    const products = Array.from({ length: 12 }, (_, n) => ({
      productId: `p${n}`,
      productName: `Candle ${String(n).padStart(2, '0')}`,
      excludedOffers: 1,
      offers: 1,
      issues: [{ field: 'image_link', severity: 'error', message: 'Add a photo: every channel requires one.' }],
    }))
    request.mockResolvedValueOnce({
      offers: 12,
      partial: false,
      store: [],
      channels: ['google', 'meta', 'tiktok', 'pinterest', 'snapchat', 'microsoft'].map((channel) => ({
        channel,
        listed: 0,
        excluded: 12,
        warned: 0,
        truncated: false,
        products: channel === 'google' ? products : [],
      })),
    })
    fireEvent.click(screen.getByText('Check products'))
    const google = within(screen.getByTestId('sales-channel-google'))
    expect(await google.findByText('Candle 09')).toBeTruthy()
    expect(google.queryByText('Candle 10')).toBeNull()
    fireEvent.click(google.getByRole('button', { name: /next page/i }))
    expect(google.getByText('Candle 11')).toBeTruthy()
    expect(within(screen.getByTestId('sales-channel-meta')).getByText('Every product is listed as it is.')).toBeTruthy()
  })

  it('switches a feed on through the route and shows its new address', async () => {
    request.mockResolvedValueOnce(state())
    render(<SalesChannelsCard hostId="host-1" />)
    await screen.findByTestId('sales-channels-card')
    request.mockResolvedValueOnce({
      channel: {
        id: 'meta',
        enabled: true,
        url: 'https://candles.example.com/api/sales-channels/feed/meta/T.xml?hostId=host-1',
        createdAtMs: 2,
        rotatedAtMs: null,
        lastFetchAtMs: null,
        lastFetchAgent: null,
      },
    })
    fireEvent.click(screen.getByLabelText('Meta feed'))
    await waitFor(() =>
      expect(request).toHaveBeenLastCalledWith(SALES_CHANNELS_API_ROUTES.channel, {
        body: { hostId: 'host-1', channel: 'meta', enabled: true },
      }),
    )
    expect(await screen.findByLabelText('Meta feed address')).toBeTruthy()
  })

  it('replaces an address only after confirming, and retires the earlier Google address with it', async () => {
    request.mockResolvedValueOnce(state())
    render(<SalesChannelsCard hostId="host-1" />)
    await screen.findByTestId('sales-channels-card')
    fireEvent.click(screen.getByRole('button', { name: 'Replace address' }))
    const dialog = await screen.findByRole('dialog')
    expect(request).toHaveBeenCalledTimes(1)
    request.mockResolvedValueOnce({ channel: { ...state().channels[0], url: URL_GOOGLE.replace('TOKEN', 'NEW') } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Replace' }))
    await waitFor(() =>
      expect(request).toHaveBeenLastCalledWith(SALES_CHANNELS_API_ROUTES.rotate, {
        body: { hostId: 'host-1', channel: 'google' },
      }),
    )
    await waitFor(() => expect(screen.queryByText(/earlier Merchant Center address still works/)).toBeNull())
  })

  it('shows what each feed leaves out once products are checked', async () => {
    request.mockResolvedValueOnce(state())
    render(<SalesChannelsCard hostId="host-1" />)
    await screen.findByTestId('sales-channels-card')
    request.mockResolvedValueOnce({
      offers: 2,
      partial: false,
      store: [],
      channels: ['google', 'meta', 'tiktok', 'pinterest', 'snapchat', 'microsoft'].map((channel) => ({
        channel,
        listed: 1,
        excluded: 1,
        warned: 0,
        truncated: false,
        products: [
          {
            productId: 'p2',
            productName: 'No Photo',
            excludedOffers: 1,
            offers: 1,
            issues: [{ field: 'image_link', severity: 'error', message: 'Add a photo: every channel requires one.' }],
          },
        ],
      })),
    })
    fireEvent.click(screen.getByText('Check products'))
    const google = within(screen.getByTestId('sales-channel-google'))
    expect(await google.findByText('1 listed')).toBeTruthy()
    expect(google.getByText('1 left out')).toBeTruthy()
    expect(google.getByText('No Photo')).toBeTruthy()
    expect(google.getByText('Left out')).toBeTruthy()
    expect(google.getByText('Add a photo: every channel requires one.')).toBeTruthy()
  })

  it('says what is missing for a site with no address, no product pages, or commerce off', async () => {
    request.mockResolvedValueOnce(
      state({
        sells: false,
        store: { name: 'Candle Co', origin: null, currency: 'USD', productPagesServed: false, carrierPricedCountries: [] },
      }),
    )
    render(<SalesChannelsCard hostId="host-1" />)
    expect(await screen.findByText(/Turn on Commerce for this site/)).toBeTruthy()
    expect(screen.getByText(/no web address yet/)).toBeTruthy()
    expect((screen.getByLabelText('Meta feed') as HTMLInputElement).disabled).toBe(true)
  })

  it('saves the defaults from the header button', async () => {
    request.mockResolvedValueOnce(state())
    render(<SalesChannelsCard hostId="host-1" />)
    await screen.findByTestId('sales-channels-card')
    fireEvent.change(screen.getByLabelText('Brand'), { target: { value: 'Wick Co' } })
    request.mockResolvedValueOnce({ settings: { defaultBrand: 'Wick Co', defaultCondition: 'new', defaultGoogleCategory: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(request).toHaveBeenLastCalledWith(SALES_CHANNELS_API_ROUTES.settings, {
        body: { hostId: 'host-1', settings: { defaultBrand: 'Wick Co', defaultCondition: 'new', defaultGoogleCategory: '' } },
      }),
    )
  })

  it('shows the route’s sentence when the state cannot be read', async () => {
    request.mockRejectedValueOnce(new Error('Sales channels come with the plans that include commerce.'))
    render(<SalesChannelsCard hostId="host-1" />)
    expect(await screen.findByText('Sales channels come with the plans that include commerce.')).toBeTruthy()
  })
})

describe('ProductChannelFields', () => {
  const product = (channel = { brand: '', gtin: '', mpn: '', condition: '' as const, googleProductCategory: '' }) => ({
    id: 'p1',
    type: 'physical',
    channel,
  })

  it('stages each field in the editor as it is typed', () => {
    const proposeValues = jest.fn()
    render(<ProductChannelFields hostId="host-1" product={product()} proposeValues={proposeValues} />)
    fireEvent.change(screen.getByLabelText('Brand'), { target: { value: 'Candle Co' } })
    expect(proposeValues).toHaveBeenLastCalledWith({ channel: { brand: 'Candle Co' } }, 'sales-channels-fields')
    fireEvent.change(screen.getByLabelText('Barcode (GTIN)'), { target: { value: '0360-0029' } })
    expect(proposeValues).toHaveBeenLastCalledWith({ channel: { gtin: '03600029' } }, 'sales-channels-fields')
    fireEvent.change(screen.getByLabelText('Part number (MPN)'), { target: { value: 'BW-1' } })
    expect(proposeValues).toHaveBeenLastCalledWith({ channel: { mpn: 'BW-1' } }, 'sales-channels-fields')
  })

  it('flags a barcode with a wrong check digit', () => {
    render(
      <ProductChannelFields
        hostId="host-1"
        product={product({ brand: '', gtin: '036000291453', mpn: '', condition: '', googleProductCategory: '' })}
        proposeValues={jest.fn()}
      />,
    )
    expect(screen.getByText(/its last digit does not match/)).toBeTruthy()
  })

  it('is not drawn for a service', () => {
    const { container } = render(
      <ProductChannelFields hostId="host-1" product={{ id: 'p1', type: 'service' }} proposeValues={jest.fn()} />,
    )
    expect(container.innerHTML).toBe('')
  })
})
