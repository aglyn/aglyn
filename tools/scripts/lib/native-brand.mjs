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
 * The brand assets in the native apps (docs/mobile/native-architecture.md
 * §7): the official SVGs the console serves, as an Apple asset catalog and as
 * Android vector drawables for Compose, plus the app icons. File names name
 * the INK, not the ground (docs/BRAND_ASSETS.md): a `-dark` file is drawn on a
 * light ground, so it is the light appearance, and `-light` the dark one.
 */

export const BRAND_DIR = 'apps/console/public/_static/images/brand'
export const APPLE_CATALOG = 'libs/native/apple/Sources/AglynUI/Resources/Brand.xcassets'
export const COMPOSE_RESOURCES = 'libs/native/kotlin/ui/src/commonMain/composeResources'

/** Each brand image: its Apple image set, its Compose drawable, and the SVG per ground. */
export const BRAND_IMAGES = [
  { apple: 'AglynMark', compose: 'aglyn_mark', light: 'aglyn-logo-mark-multi.svg', dark: 'aglyn-logo-mark-multi.svg' },
  { apple: 'AglynLogo', compose: 'aglyn_logo', light: 'aglyn-logo-full-dark.svg', dark: 'aglyn-logo-full-light.svg' },
  { apple: 'AglynWordmark', compose: 'aglyn_wordmark', light: 'aglyn-logo-text-dark.svg', dark: 'aglyn-logo-text-light.svg' },
]

/**
 * The app icons: the multi-color mark on the solid light ground the console's
 * installed icon uses (`app-icon/light-solid-*.png`), the art spanning the
 * same 300/512 of the square. The brand assets carry no POS variant, so
 * "Aglyn POS" wears the same mark.
 */
export const ICON_SOURCE = 'aglyn-logo-mark-multi.svg'
export const ICON_GROUND = '#FFFFFF'
export const ICON_ART_FRACTION = 300 / 512
export const APPLE_APPS = ['Aglyn', 'AglynPOS']
export const ANDROID_APPS = ['app', 'pos']

export const appleIconSet = (app) => `apps/ios/${app}/Assets.xcassets/AppIcon.appiconset`
export const androidRes = (app) => `apps/android/${app}/src/main/res`
export const androidPlayIcon = (app) => `apps/android/${app}/src/main/ic_launcher-playstore.png`

/** The rasters, each rendered from ICON_SOURCE at its size. */
export function iconRasters() {
  return [
    ...APPLE_APPS.flatMap((app) => [
      { file: `${appleIconSet(app)}/AppIcon-1024.png`, size: 1024 },
      { file: `${appleIconSet(app)}/AppIcon-512.png`, size: 512 },
    ]),
    ...ANDROID_APPS.map((app) => ({ file: androidPlayIcon(app), size: 512 })),
  ]
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`
const XCODE_INFO = { author: 'xcode', version: 1 }

export const catalogContents = () => json({ info: XCODE_INFO })

/** An image set: the SVG kept as a vector, with a dark appearance when the ink changes. */
export function imageSetContents(image) {
  const images = [{ filename: `${image.apple}.svg`, idiom: 'universal' }]
  if (image.dark !== image.light) {
    images.push({
      appearances: [{ appearance: 'luminosity', value: 'dark' }],
      filename: `${image.apple}-dark.svg`,
      idiom: 'universal',
    })
  }
  return json({ images, info: XCODE_INFO, properties: { 'preserves-vector-representation': true } })
}

export const appIconContents = () =>
  json({
    images: [
      { filename: 'AppIcon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
      { filename: 'AppIcon-512.png', idiom: 'mac', scale: '1x', size: '512x512' },
      { filename: 'AppIcon-1024.png', idiom: 'mac', scale: '2x', size: '512x512' },
    ],
    info: XCODE_INFO,
  })

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)
  return m ? m[1] : undefined
}
const styleOf = (tag) =>
  Object.fromEntries(
    (attr(tag, 'style') ?? '')
      .split(';')
      .map((rule) => rule.split(':').map((s) => s.trim()))
      .filter(([key, value]) => key && value),
  )

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i
const androidColor = (fill, where) => {
  const m = HEX.exec(fill)
  if (!m) throw new Error(`${where}: fill "${fill}" is not #rgb or #rrggbb`)
  const digits = m[1].length === 3 ? [...m[1]].map((d) => d + d).join('') : m[1]
  return `#FF${digits.toUpperCase()}`
}

/**
 * The paths of one of the brand SVGs: flat `<path>`s filled with a solid
 * color, inside `<g>`s with no transform, beside invisible `<rect>` frames.
 * Anything else is refused by name rather than drawn wrong.
 */
export function svgPaths(svg, where) {
  const viewBox = /<svg\b[^>]*\sviewBox="([^"]+)"/.exec(svg)?.[1]?.split(/[\s,]+/).map(Number)
  if (!viewBox || viewBox.length !== 4 || viewBox.some((n) => !Number.isFinite(n))) {
    throw new Error(`${where}: no numeric viewBox`)
  }
  if (viewBox[0] !== 0 || viewBox[1] !== 0) throw new Error(`${where}: a viewBox must start at 0 0`)
  const paths = []
  for (const [tag, name] of svg.matchAll(/<([a-zA-Z]+)\b[^>]*>/g)) {
    if (name === 'svg') continue
    if (name === 'g') {
      if (attr(tag, 'transform')) throw new Error(`${where}: a <g> with a transform`)
      continue
    }
    if (name === 'rect') {
      if (styleOf(tag).fill !== 'none') throw new Error(`${where}: a visible <rect>`)
      continue
    }
    if (name !== 'path') throw new Error(`${where}: <${name}> is not a brand-SVG element`)
    if (attr(tag, 'transform')) throw new Error(`${where}: a <path> with a transform`)
    const style = styleOf(tag)
    const fill = style.fill ?? attr(tag, 'fill')
    const rule = style['fill-rule'] ?? attr(tag, 'fill-rule') ?? styleOf(svg.match(/<svg\b[^>]*>/)[0])['fill-rule'] ?? 'nonzero'
    const d = attr(tag, 'd')
    if (!d) throw new Error(`${where}: a <path> with no d`)
    paths.push({ d, fill: androidColor(fill, where), evenOdd: rule === 'evenodd' })
  }
  if (!paths.length) throw new Error(`${where}: no paths`)
  return { width: viewBox[2], height: viewBox[3], paths }
}

const GENERATED_XML = (source) =>
  `<!-- GENERATED by tools/scripts/generate-native-brand-assets.mjs from ${source} — do not edit. -->`

const pathXml = (path, indent) =>
  `${indent}<path\n` +
  `${indent}    android:fillColor="${path.fill}"\n` +
  `${indent}    android:fillType="${path.evenOdd ? 'evenOdd' : 'nonZero'}"\n` +
  `${indent}    android:pathData="${path.d}" />`

/** An Android vector drawable (Compose resources draw these on every target), 24dp tall. */
export function vectorDrawable(svg, source) {
  const { width, height, paths } = svgPaths(svg, source)
  const dpWidth = Number(((width / height) * 24).toFixed(3))
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n${GENERATED_XML(source)}\n` +
    `<vector xmlns:android="http://schemas.android.com/apk/res/android"\n` +
    `    android:width="${dpWidth}dp"\n    android:height="24dp"\n` +
    `    android:viewportWidth="${width}"\n    android:viewportHeight="${height}">\n` +
    `${paths.map((p) => pathXml(p, '  ')).join('\n')}\n</vector>\n`
  )
}

/**
 * An adaptive icon's foreground: the mark in the 108dp canvas, scaled so its
 * frame spans the same fraction of the safe 72dp as the art does of the
 * console's solid icon.
 */
export function adaptiveForeground(svg, source) {
  const { width, height, paths } = svgPaths(svg, source)
  const box = 108
  const scale = Number(((72 * ICON_ART_FRACTION * (24 / 21)) / Math.max(width, height)).toFixed(4))
  const offset = (extent) => Number(((box - extent * scale) / 2).toFixed(4))
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n${GENERATED_XML(source)}\n` +
    `<vector xmlns:android="http://schemas.android.com/apk/res/android"\n` +
    `    android:width="${box}dp"\n    android:height="${box}dp"\n` +
    `    android:viewportWidth="${box}"\n    android:viewportHeight="${box}">\n` +
    `  <group\n      android:scaleX="${scale}"\n      android:scaleY="${scale}"\n` +
    `      android:translateX="${offset(width)}"\n      android:translateY="${offset(height)}">\n` +
    `${paths.map((p) => pathXml(p, '    ')).join('\n')}\n  </group>\n</vector>\n`
  )
}

export const adaptiveIcon = () =>
  `<?xml version="1.0" encoding="utf-8"?>\n${GENERATED_XML(ICON_SOURCE)}\n` +
  `<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n` +
  `  <background android:drawable="@color/ic_launcher_background" />\n` +
  `  <foreground android:drawable="@drawable/ic_launcher_foreground" />\n` +
  `  <monochrome android:drawable="@drawable/ic_launcher_foreground" />\n` +
  `</adaptive-icon>\n`

export const launcherBackground = () =>
  `<?xml version="1.0" encoding="utf-8"?>\n${GENERATED_XML(ICON_SOURCE)}\n` +
  `<resources>\n  <color name="ic_launcher_background">${ICON_GROUND}</color>\n</resources>\n`

/**
 * Every text output, as `{ file, content }` (Buffer for the SVG copies, which
 * are the console's bytes exactly). `read(name)` returns a brand SVG's bytes.
 */
export function brandTextOutputs(read) {
  const outputs = [{ file: `${APPLE_CATALOG}/Contents.json`, content: catalogContents() }]
  for (const image of BRAND_IMAGES) {
    const set = `${APPLE_CATALOG}/${image.apple}.imageset`
    outputs.push({ file: `${set}/Contents.json`, content: imageSetContents(image) })
    outputs.push({ file: `${set}/${image.apple}.svg`, content: read(image.light) })
    if (image.dark !== image.light) outputs.push({ file: `${set}/${image.apple}-dark.svg`, content: read(image.dark) })
    outputs.push({
      file: `${COMPOSE_RESOURCES}/drawable/${image.compose}.xml`,
      content: vectorDrawable(read(image.light).toString('utf8'), image.light),
    })
    if (image.dark !== image.light) {
      outputs.push({
        file: `${COMPOSE_RESOURCES}/drawable-dark/${image.compose}.xml`,
        content: vectorDrawable(read(image.dark).toString('utf8'), image.dark),
      })
    }
  }
  const mark = read(ICON_SOURCE).toString('utf8')
  for (const app of APPLE_APPS) outputs.push({ file: `${appleIconSet(app)}/Contents.json`, content: appIconContents() })
  for (const app of ANDROID_APPS) {
    const res = androidRes(app)
    outputs.push({ file: `${res}/mipmap-anydpi-v26/ic_launcher.xml`, content: adaptiveIcon() })
    outputs.push({ file: `${res}/drawable/ic_launcher_foreground.xml`, content: adaptiveForeground(mark, ICON_SOURCE) })
    outputs.push({ file: `${res}/values/ic_launcher_background.xml`, content: launcherBackground() })
  }
  return outputs
}
