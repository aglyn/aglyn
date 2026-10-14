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
 * The picture lightboxes (AGL-3717): an Image's own, an Image List's gallery,
 * and a gallery named across Images.
 */

import * as Aglyn from '@aglyn/aglyn'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import Image, { schema as imageSchema } from './image'
import ImageListElement, {
  ImageListItemElement,
  imageListSchema,
} from './image-list'
import { schema as videoSchema } from './video'
import { imageGalleryOf, listGalleryOf, stepIndex } from './image-lightbox-items'

const inEditor = (element: JSX.Element) => (
  <Aglyn.ScreenLinkContext.Provider
    value={{ suppressNavigation: true, editorInert: true }}
  >
    {element}
  </Aglyn.ScreenLinkContext.Provider>
)

const gallery = (props: Record<string, unknown> = {}) => (
  <ImageListElement lightbox {...props}>
    {['One', 'Two', 'Three'].map((caption, index) => (
      <ImageListItemElement key={caption} title={caption}>
        <Image src={`https://cdn.example.com/${index + 1}.jpg`} alt={`Photo ${index + 1}`} />
      </ImageListItemElement>
    ))}
  </ImageListElement>
)

const counter = () => screen.getByLabelText(/^Picture \d+ of \d+$/)

describe('an Image that opens in a lightbox', () => {
  it('is a plain picture until its switch is on', () => {
    render(<Image src="https://cdn.example.com/a.jpg" alt="A" />)
    const img = screen.getByRole('img', { name: 'A' })
    expect(img.getAttribute('role')).toBeNull()
    expect(img.getAttribute('tabindex')).toBeNull()
  })

  it('renders nothing of the dialog until it is pressed', () => {
    const html = renderToString(
      <Image src="https://cdn.example.com/a.jpg" alt="A" lightbox />,
    )
    expect(html).not.toContain('role="dialog"')
    expect(html.match(/<img/g)).toHaveLength(1)
  })

  it('opens the full-size picture, with its alt and caption, and closes back to it', async () => {
    render(
      <Image
        src="https://cdn.example.com/a.jpg"
        alt="A lake"
        lightbox
        lightboxCaption="Lake Tahoe at dawn"
      />,
    )
    const trigger = screen.getByRole('button', { name: 'A lake' })
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog')
    const full = within(dialog).getByRole('img', { name: 'A lake' })
    expect(full.getAttribute('src')).toBe('https://cdn.example.com/a.jpg')
    expect(full.getAttribute('sizes')).toBe('100vw')
    expect(full.getAttribute('loading')).toBe('eager')
    expect(within(dialog).getByText('Lake Tahoe at dawn')).toBeTruthy()
    // One picture: no previous, next or counter.
    expect(within(dialog).queryByRole('button', { name: 'Next picture' })).toBeNull()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close picture' }))
    })
    expect(document.activeElement).toBe(trigger)
  })

  it('opens from the keyboard', async () => {
    render(<Image src="https://cdn.example.com/a.jpg" alt="A" lightbox />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'A' }), { key: 'Enter' })
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('takes a bound yes/no as the component property hands it over', () => {
    render(<Image src="https://cdn.example.com/a.jpg" alt="A" lightbox="false" />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('follows its link instead when it has one', () => {
    render(
      <Image src="https://cdn.example.com/a.jpg" alt="A" lightbox href="https://example.com" />,
    )
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('is inert on the canvas, where a press selects the node', async () => {
    render(inEditor(<Image src="https://cdn.example.com/a.jpg" alt="A" lightbox />))
    fireEvent.click(screen.getByRole('button', { name: 'A' }))
    await act(async () => undefined)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('names a decorative picture so the button still has a name', () => {
    render(<Image src="https://cdn.example.com/a.jpg" decorative lightbox />)
    expect(screen.getByRole('button', { name: 'Open picture' })).toBeTruthy()
  })

  it('keeps every lightbox setting off the <img>', () => {
    const { container } = render(
      <Image
        src="https://cdn.example.com/a.jpg"
        alt="A"
        lightbox
        lightboxRadius={8}
        lightboxBackdropColor="#fff"
      />,
    )
    const html = (container.querySelector('img') as HTMLElement).outerHTML
    expect(html).not.toMatch(/lightboxradius|lightboxbackdropcolor/i)
  })

  it('opens every picture sharing its gallery name, as one gallery', async () => {
    render(
      <>
        <Image src="https://cdn.example.com/1.jpg" alt="One" lightbox lightboxGallery="work" />
        <Image src="https://cdn.example.com/x.jpg" alt="Elsewhere" lightbox />
        <Image src="https://cdn.example.com/2.jpg" alt="Two" lightbox lightboxGallery="work" />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Two' }))
    const dialog = await screen.findByRole('dialog', { name: 'work' })
    expect(counter().textContent).toBe('2 / 2')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next picture' }))
    expect(within(dialog).getByRole('img', { name: 'One' })).toBeTruthy()
  })
})

describe('an Image List gallery', () => {
  it('fetches nothing for the dialog until a picture is pressed', () => {
    const { baseElement } = render(gallery())
    expect(baseElement.querySelectorAll('img')).toHaveLength(3)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens at the picture pressed, with the tile caption and a counter', async () => {
    render(gallery())
    fireEvent.click(screen.getByRole('button', { name: 'Photo 2' }))
    const dialog = await screen.findByRole('dialog', { name: 'Gallery' })
    expect(within(dialog).getByRole('img', { name: 'Photo 2' })).toBeTruthy()
    expect(within(dialog).getByText('Two')).toBeTruthy()
    expect(counter().textContent).toBe('2 / 3')
  })

  it('moves with previous and next, wrapping at both ends', async () => {
    render(gallery())
    fireEvent.click(screen.getByRole('button', { name: 'Photo 3' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next picture' }))
    expect(counter().textContent).toBe('1 / 3')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Previous picture' }))
    expect(counter().textContent).toBe('3 / 3')
  })

  it('moves with the arrow keys, Home and End', async () => {
    render(gallery())
    fireEvent.click(screen.getByRole('button', { name: 'Photo 1' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'ArrowRight' })
    expect(counter().textContent).toBe('2 / 3')
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' })
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' })
    expect(counter().textContent).toBe('3 / 3')
    fireEvent.keyDown(dialog, { key: 'Home' })
    expect(counter().textContent).toBe('1 / 3')
    fireEvent.keyDown(dialog, { key: 'End' })
    expect(counter().textContent).toBe('3 / 3')
  })

  it('moves with a sideways swipe and ignores a tap', async () => {
    render(gallery())
    fireEvent.click(screen.getByRole('button', { name: 'Photo 1' }))
    const dialog = await screen.findByRole('dialog')
    const figure = dialog.querySelector('figure') as HTMLElement
    fireEvent.pointerDown(figure, { clientX: 300, clientY: 100 })
    fireEvent.pointerUp(figure, { clientX: 200, clientY: 110 })
    expect(counter().textContent).toBe('2 / 3')
    fireEvent.pointerDown(figure, { clientX: 300, clientY: 100 })
    fireEvent.pointerUp(figure, { clientX: 290, clientY: 100 })
    expect(counter().textContent).toBe('2 / 3')
  })

  it('offers a strip of thumbnails when asked, each one a button', async () => {
    render(gallery({ lightboxThumbnails: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Photo 1' }))
    const dialog = await screen.findByRole('dialog')
    const strip = within(dialog).getByRole('group', { name: 'Pictures' })
    const third = within(strip).getByRole('button', { name: 'Show picture 3: Photo 3' })
    fireEvent.click(third)
    expect(counter().textContent).toBe('3 / 3')
    expect(third.getAttribute('aria-current')).toBe('true')
    // Thumbnails defer like every non-LCP picture (AGL-2486).
    const thumb = third.querySelector('img') as HTMLImageElement
    expect(thumb.getAttribute('loading')).toBe('lazy')
  })

  it('hides captions when the author says so', async () => {
    render(gallery({ lightboxCaptionPlacement: 'hidden' }))
    fireEvent.click(screen.getByRole('button', { name: 'Photo 1' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByText('One')).toBeNull()
  })

  it('is a plain list of pictures with its switch off', () => {
    render(gallery({ lightbox: false }))
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})

describe('reading a gallery off the page', () => {
  const page = () => {
    document.body.innerHTML = `
      <ul id="list">
        <li><img data-aglyn-lightbox="" src="/1.jpg" srcset="/1.jpg?w=320 320w" alt="1"><div class="MuiImageListItemBar-title">First</div></li>
        <li><img src="/skip.jpg" alt="not taking part"></li>
        <li><img data-aglyn-lightbox="" data-aglyn-lightbox-caption="Mine" src="/2.jpg" alt="2"></li>
        <li><img data-aglyn-lightbox="" alt="no source"></li>
      </ul>
      <img id="lone" data-aglyn-lightbox="" src="/lone.jpg" alt="lone">
      <img id="a" data-aglyn-lightbox="g" src="/a.jpg" alt="a">
      <img id="b" data-aglyn-lightbox="g" src="/b.jpg" alt="b">`
  }

  it('takes the pictures that take part, in order, with their captions', () => {
    page()
    const list = document.getElementById('list') as HTMLElement
    const second = list.querySelectorAll('img')[2]
    expect(listGalleryOf(list, second)).toEqual({
      index: 1,
      pictures: [
        { src: '/1.jpg', srcSet: '/1.jpg?w=320 320w', alt: '1', caption: 'First' },
        { src: '/2.jpg', alt: '2', caption: 'Mine' },
      ],
    })
  })

  it('opens a lone picture alone and a named one with its gallery', () => {
    page()
    expect(imageGalleryOf(document.getElementById('lone') as HTMLElement).pictures).toHaveLength(1)
    const named = imageGalleryOf(document.getElementById('b') as HTMLElement)
    expect(named.pictures.map((picture) => picture.alt)).toEqual(['a', 'b'])
    expect(named.index).toBe(1)
  })

  it('wraps an index both ways', () => {
    expect(stepIndex(2, 1, 3)).toBe(0)
    expect(stepIndex(0, -1, 3)).toBe(2)
    expect(stepIndex(0, 1, 0)).toBe(0)
  })
})

describe('the lightbox settings in the props panel', () => {
  const names = (schema: Aglyn.ComponentSchema) =>
    (schema.attributes ?? []).map((attribute) => attribute.name)

  it.each([
    ['Image', imageSchema],
    ['Image List', imageListSchema],
    ['Video', videoSchema],
  ])('%s offers every appearance setting, shown while its lightbox is on', (_name, schema) => {
    const attributes = (schema.attributes ?? []).filter((attribute) =>
      String(attribute.name).startsWith('lightbox') && attribute.name !== 'lightbox',
    )
    expect(names(schema)).toContain('lightbox')
    expect(names(schema)).toEqual(
      expect.arrayContaining([
        'lightboxBackdropColor',
        'lightboxBackdropOpacity',
        'lightboxBackdropBlur',
        'lightboxMaxWidth',
        'lightboxMaxHeight',
        'lightboxPadding',
        'lightboxRadius',
        'lightboxCloseStyle',
        'lightboxClosePosition',
        'lightboxCaptionPlacement',
        'lightboxTransition',
        'lightboxCloseOnBackdrop',
        'lightboxCloseOnEscape',
      ]),
    )
    for (const attribute of attributes) {
      expect(attribute.condition).toEqual({ when: 'lightbox', is: true })
    }
  })
})
