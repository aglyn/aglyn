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

import {
  AUTH_COLORS,
  authThemeKotlin,
  authThemeSwift,
  facetsSvg,
  INTRO_TIMELINE,
  LAUNCH_ART,
  LAUNCH_BACKGROUND,
} from './native-auth-theme.mjs'

export const BRAND_DIR = 'apps/console/public/_static/images/brand'
export const APPLE_CATALOG =
  'libs/native/apple/Sources/AglynUI/Resources/Brand.xcassets'
export const COMPOSE_RESOURCES =
  'libs/native/kotlin/ui/src/commonMain/composeResources'

/** Each brand image: its Apple image set, its Compose drawable, and the SVG per ground. */
export const BRAND_IMAGES = [
  {
    apple: 'AglynMark',
    compose: 'aglyn_mark',
    light: 'aglyn-logo-mark-multi.svg',
    dark: 'aglyn-logo-mark-multi.svg',
  },
  {
    apple: 'AglynLogo',
    compose: 'aglyn_logo',
    light: 'aglyn-logo-full-dark.svg',
    dark: 'aglyn-logo-full-light.svg',
  },
  {
    apple: 'AglynWordmark',
    compose: 'aglyn_wordmark',
    light: 'aglyn-logo-text-dark.svg',
    dark: 'aglyn-logo-text-light.svg',
  },
]

/**
 * The app icons, one per app, each drawn from vector sources in BRAND_DIR
 * (never from hand-placed PNGs). `layers` are SVGs on a 1024 grid, drawn in
 * order: the first is the ground (the Android background layer), the rest
 * the foreground. The mark is then placed at `mark`, on the same grid, from
 * the console's own mark SVG, unchanged.
 *
 * - Aglyn: the all-white mark (the brand's variant for saturated grounds) on
 *   the primary-to-secondary gradient, its 24-unit frame spanning 600/1024.
 * - Aglyn POS: the multi-color mark printed on a receipt over the same
 *   gradient, so the two read as one family and apart at a glance.
 */
export const APP_ICONS = [
  {
    name: 'Aglyn',
    apple: 'Aglyn',
    android: 'app',
    desktop: 'aglyn',
    layers: ['app-icon/native-icon-ground.svg'],
    mark: { source: 'aglyn-logo-mark-white.svg', x: 212, y: 212, size: 600 },
  },
  {
    name: 'Aglyn POS',
    apple: 'AglynPOS',
    android: 'pos',
    desktop: 'aglyn-pos',
    layers: [
      'app-icon/native-icon-ground.svg',
      'app-icon/native-pos-receipt.svg',
    ],
    mark: {
      source: 'aglyn-logo-mark-multi.svg',
      x: 296.96,
      y: 179.2,
      size: 430.08,
    },
  },
]

/** Every brand file an app icon is drawn from, relative to BRAND_DIR. */
export const iconSources = () =>
  [
    ...new Set(APP_ICONS.flatMap((icon) => [...icon.layers, icon.mark.source])),
  ].sort()

/**
 * The launch screen's mark (LaunchScreen.storyboard), in each app's own asset
 * catalog: the logo kit's multi-color mark alone, centered over the Facets
 * launch art at 96 pt (iPhone) / 120 pt (iPad), as the intro's first frame
 * draws it (AGL-3934). PNGs at 1x-3x of 120 pt: the system's launch-screen
 * snapshot does not draw an SVG image set.
 */
export const LAUNCH_LOGO = {
  apple: 'LaunchLogo',
  light: 'aglyn-logo-mark-multi.svg',
  dark: 'aglyn-logo-mark-multi.svg',
  width: 120,
  height: 120,
}

export const appleLaunchSet = (app) =>
  `apps/ios/${app}/Assets.xcassets/${LAUNCH_LOGO.apple}.imageset`

/**
 * A brand SVG with an explicit size on its root element, everything else
 * byte for byte: the console's files say `width="100%"`, which an asset
 * catalog cannot size a launch image from.
 */
export function sizedSvg(svg, width, height, where = 'svg') {
  const text = svg.toString('utf8')
  const root = /<svg\b[^>]*>/.exec(text)
  if (!root) throw new Error(`${where}: no <svg> element`)
  let tag = root[0]
  for (const [name, value] of [
    ['width', width],
    ['height', height],
  ]) {
    tag = new RegExp(`\\s${name}="[^"]*"`).test(tag)
      ? tag.replace(new RegExp(`(\\s${name}=)"[^"]*"`), `$1"${value}"`)
      : tag.replace(/^<svg\b/, `<svg ${name}="${value}"`)
  }
  return (
    text.slice(0, root.index) + tag + text.slice(root.index + root[0].length)
  )
}

export const appleIconSet = (app) =>
  `apps/ios/${app}/Assets.xcassets/AppIcon.appiconset`
export const androidRes = (app) => `apps/android/${app}/src/main/res`
export const androidPlayIcon = (app) =>
  `apps/android/${app}/src/main/ic_launcher-playstore.png`
export const desktopIcon = (icon, ext) =>
  `apps/android/desktop/icons/${icon.desktop}.${ext}`

/** The Mac icon sizes in points; each ships at 1x and 2x. */
export const MAC_ICON_SIZES = [16, 32, 128, 256, 512]
const MAC_PIXELS = [16, 32, 64, 128, 256, 512, 1024]
export const WINDOWS_ICON_SIZES = [16, 24, 32, 48, 64, 128, 256]
/** The .icns entries: each OSType holds a PNG of its pixel size. */
export const ICNS_TYPES = [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
]

/**
 * The PNG outputs. `variant` frames the art: `full` bleeds to the edges and is
 * opaque (iOS and Google Play apply their own mask), `mac` is the macOS plate
 * on a clear canvas.
 */
export function iconRasters() {
  return APP_ICONS.flatMap((icon) => [
    {
      icon,
      file: `${appleIconSet(icon.apple)}/AppIcon-1024.png`,
      size: 1024,
      variant: 'full',
    },
    ...MAC_PIXELS.map((size) => ({
      icon,
      file: `${appleIconSet(icon.apple)}/AppIcon-mac-${size}.png`,
      size,
      variant: 'mac',
    })),
    { icon, file: androidPlayIcon(icon.android), size: 512, variant: 'full' },
  ])
}

/** The desktop app's icon files: a Windows .ico (rounded tile) and a macOS .icns (plate), each a set of PNGs. */
export function iconContainers() {
  return APP_ICONS.flatMap((icon) => [
    {
      icon,
      file: desktopIcon(icon, 'ico'),
      format: 'ico',
      variant: 'windows',
      sizes: WINDOWS_ICON_SIZES,
    },
    {
      icon,
      file: desktopIcon(icon, 'icns'),
      format: 'icns',
      variant: 'mac',
      sizes: ICNS_TYPES.map(([, size]) => size),
    },
  ])
}

/** Files an earlier icon layout wrote: removed by a write, refused by `--check`. */
export const RETIRED_OUTPUTS = APP_ICONS.flatMap((icon) => [
  `${appleIconSet(icon.apple)}/AppIcon-512.png`,
  // The launch screen showed the full logo as SVGs, light and dark, until AGL-3934; it is the mark as PNGs now.
  `apps/ios/${icon.apple}/Assets.xcassets/LaunchLogo.imageset/LaunchLogo-dark.svg`,
  `apps/ios/${icon.apple}/Assets.xcassets/LaunchLogo.imageset/LaunchLogo.svg`,
])

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
  return json({
    images,
    info: XCODE_INFO,
    properties: { 'preserves-vector-representation': true },
  })
}

export const appIconContents = () =>
  json({
    images: [
      {
        filename: 'AppIcon-1024.png',
        idiom: 'universal',
        platform: 'ios',
        size: '1024x1024',
      },
      ...MAC_ICON_SIZES.flatMap((size) =>
        [1, 2].map((scale) => ({
          filename: `AppIcon-mac-${size * scale}.png`,
          idiom: 'mac',
          scale: `${scale}x`,
          size: `${size}x${size}`,
        })),
      ),
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
  const viewBox = /<svg\b[^>]*\sviewBox="([^"]+)"/
    .exec(svg)?.[1]
    ?.split(/[\s,]+/)
    .map(Number)
  if (
    !viewBox ||
    viewBox.length !== 4 ||
    viewBox.some((n) => !Number.isFinite(n))
  ) {
    throw new Error(`${where}: no numeric viewBox`)
  }
  if (viewBox[0] !== 0 || viewBox[1] !== 0)
    throw new Error(`${where}: a viewBox must start at 0 0`)
  const paths = []
  for (const [tag, name] of svg.matchAll(/<([a-zA-Z]+)\b[^>]*>/g)) {
    if (name === 'svg') continue
    if (name === 'g') {
      if (attr(tag, 'transform'))
        throw new Error(`${where}: a <g> with a transform`)
      continue
    }
    if (name === 'rect') {
      if (styleOf(tag).fill !== 'none')
        throw new Error(`${where}: a visible <rect>`)
      continue
    }
    if (name !== 'path')
      throw new Error(`${where}: <${name}> is not a brand-SVG element`)
    if (attr(tag, 'transform'))
      throw new Error(`${where}: a <path> with a transform`)
    const style = styleOf(tag)
    const fill = style.fill ?? attr(tag, 'fill')
    const rule =
      style['fill-rule'] ??
      attr(tag, 'fill-rule') ??
      styleOf(svg.match(/<svg\b[^>]*>/)[0])['fill-rule'] ??
      'nonzero'
    const d = attr(tag, 'd')
    if (!d) throw new Error(`${where}: a <path> with no d`)
    paths.push({
      d,
      fill: androidColor(fill, where),
      evenOdd: rule === 'evenodd',
    })
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

const GRID = 1024
const num = (n) => Number(n.toFixed(4))
const rgbHex = (argb) => `#${argb.slice(3)}`

/** The drawing inside an icon-layer SVG: everything between its <svg> tags, comments dropped. */
function svgInner(svg, where) {
  const m = /<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/.exec(svg)
  if (!m) throw new Error(`${where}: not an <svg> document`)
  return m[1].replace(/<!--[\s\S]*?-->/g, '').trim()
}

const MAC_PLATE = { inset: 100, size: 824, radius: 185 }
const WINDOWS_TILE_RADIUS = 64

/**
 * One app icon as an SVG on the 1024 grid: its layers, then its mark.
 * `full` bleeds to the edges; `mac` sets that art on the macOS plate (824 of
 * 1024, rounded, with the platform's drop shadow) on a clear canvas;
 * `windows` rounds the corners of the full art on a clear canvas.
 */
export function appIconSvg(icon, read, variant = 'full') {
  const { paths, width } = svgPaths(
    read(icon.mark.source).toString('utf8'),
    icon.mark.source,
  )
  const mark =
    `<g transform="translate(${icon.mark.x} ${icon.mark.y}) scale(${num(icon.mark.size / width)})">` +
    paths
      .map(
        (p) =>
          `<path d="${p.d}" fill="${rgbHex(p.fill)}" fill-rule="${p.evenOdd ? 'evenodd' : 'nonzero'}"/>`,
      )
      .join('') +
    '</g>'
  const art = `${icon.layers.map((layer) => svgInner(read(layer).toString('utf8'), layer)).join('\n')}\n${mark}`
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}" width="${GRID}" height="${GRID}">`
  if (variant === 'full') return `${open}${art}</svg>`
  if (variant === 'windows') {
    return (
      `${open}<defs><clipPath id="tile"><rect width="${GRID}" height="${GRID}" rx="${WINDOWS_TILE_RADIUS}"/></clipPath></defs>` +
      `<g clip-path="url(#tile)">${art}</g></svg>`
    )
  }
  if (variant !== 'mac') throw new Error(`no app-icon variant "${variant}"`)
  const { inset, size, radius } = MAC_PLATE
  const plate = `x="${inset}" y="${inset}" width="${size}" height="${size}" rx="${radius}"`
  return (
    `${open}<defs><clipPath id="plate"><rect ${plate}/></clipPath>` +
    '<filter id="plate-shadow" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">' +
    '<feGaussianBlur in="SourceAlpha" stdDeviation="14"/><feOffset dy="12" result="blur"/>' +
    '<feFlood flood-color="#000000" flood-opacity="0.28"/><feComposite in2="blur" operator="in"/></filter></defs>' +
    `<rect ${plate} fill="#000000" filter="url(#plate-shadow)"/>` +
    `<g clip-path="url(#plate)"><g transform="translate(${inset} ${inset}) scale(${num(size / GRID)})">${art}</g></g></svg>`
  )
}

/** The ground layer's linear gradient: its line as fractions of the square, and its stops. */
export function groundGradient(svg, where) {
  const tag = /<linearGradient\b[^>]*>/.exec(svg)?.[0]
  if (!tag) throw new Error(`${where}: no <linearGradient>`)
  const at = (name, fallback) => {
    const value = attr(tag, name) ?? fallback
    const n = value.endsWith('%')
      ? Number(value.slice(0, -1)) / 100
      : Number(value)
    if (!Number.isFinite(n))
      throw new Error(`${where}: ${name}="${value}" is not a number`)
    return n
  }
  if (
    attr(tag, 'gradientUnits') &&
    attr(tag, 'gradientUnits') !== 'objectBoundingBox'
  )
    throw new Error(`${where}: gradient units must be the bounding box`)
  const stops = [...svg.matchAll(/<stop\b[^>]*>/g)].map(([s]) => ({
    offset: Number(attr(s, 'offset')),
    color: androidColor(attr(s, 'stop-color') ?? '', where),
  }))
  if (stops.length < 2) throw new Error(`${where}: a gradient needs two stops`)
  return {
    x1: at('x1', '0'),
    y1: at('y1', '0'),
    x2: at('x2', '1'),
    y2: at('y2', '0'),
    stops,
  }
}

/**
 * The paths of a foreground layer, in drawing order. A path that carries a
 * `filter` is that layer's drop shadow (it draws only the shadow); anything
 * but <path> outside <defs> is refused by name rather than drawn wrong.
 */
export function layerPaths(svg, where) {
  const body = svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<defs\b[\s\S]*?<\/defs>/g, '')
  const paths = []
  for (const [tag, name] of body.matchAll(/<([a-zA-Z]+)\b[^>]*>/g)) {
    if (name === 'svg') continue
    if (name !== 'path')
      throw new Error(`${where}: <${name}> is not an icon-layer element`)
    const d = attr(tag, 'd')
    if (!d) throw new Error(`${where}: a <path> with no d`)
    paths.push({
      d,
      fill: androidColor(attr(tag, 'fill') ?? '', where),
      shadow: Boolean(attr(tag, 'filter')),
    })
  }
  if (!paths.length) throw new Error(`${where}: no paths`)
  return paths
}

// An adaptive icon is a 108dp canvas, of which a launcher shows the middle
// 72dp; the icon's 1024 grid maps onto those 72dp.
const CANVAS = 108
const VIEWPORT = 72
// Vector drawables cannot blur, so a layer's soft shadow becomes the same
// shape, offset down by the shadow's distance at a light alpha.
const ANDROID_SHADOW = { dy: 12.288, color: '#1F001A33' }
// A monochrome (themed) icon is one tint, so a white shape on a layer would
// swallow what is printed on it: there it is drawn as an outline instead.
const MONOCHROME_OUTLINE = { color: '#FFFFFFFF', width: 24 }

const ICON_XML = (icon) =>
  GENERATED_XML([...icon.layers, icon.mark.source].join(', '))
const vectorOpen = (extra = '') =>
  `<vector xmlns:android="http://schemas.android.com/apk/res/android"${extra}\n` +
  `    android:width="${CANVAS}dp"\n    android:height="${CANVAS}dp"\n` +
  `    android:viewportWidth="${CANVAS}"\n    android:viewportHeight="${CANVAS}">\n`

/** An adaptive icon's background: the ground's gradient across the whole 108dp canvas. */
export function adaptiveBackground(icon, read) {
  const ground = icon.layers[0]
  const g = groundGradient(read(ground).toString('utf8'), ground)
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n${GENERATED_XML(ground)}\n` +
    vectorOpen('\n    xmlns:aapt="http://schemas.android.com/aapt"') +
    `  <path android:pathData="M0,0h${CANVAS}v${CANVAS}h-${CANVAS}z">\n` +
    `    <aapt:attr name="android:fillColor">\n` +
    `      <gradient\n          android:type="linear"\n` +
    `          android:startX="${num(g.x1 * CANVAS)}"\n          android:startY="${num(g.y1 * CANVAS)}"\n` +
    `          android:endX="${num(g.x2 * CANVAS)}"\n          android:endY="${num(g.y2 * CANVAS)}">\n` +
    g.stops
      .map(
        (s) =>
          `        <item android:offset="${s.offset}" android:color="${s.color}" />`,
      )
      .join('\n') +
    `\n      </gradient>\n    </aapt:attr>\n  </path>\n</vector>\n`
  )
}

/**
 * An adaptive icon's foreground (or, with `monochrome`, its themed-icon
 * layer): the icon's foreground layers and its mark, on the 1024 grid mapped
 * onto the 72dp viewport.
 */
export function adaptiveForeground(icon, read, { monochrome = false } = {}) {
  const lines = []
  for (const layer of icon.layers.slice(1)) {
    for (const p of layerPaths(read(layer).toString('utf8'), layer)) {
      if (p.shadow) {
        if (monochrome) continue
        lines.push(
          `    <group android:translateY="${ANDROID_SHADOW.dy}">`,
          pathXml({ ...p, fill: ANDROID_SHADOW.color }, '      '),
          '    </group>',
        )
      } else if (monochrome && p.fill === MONOCHROME_OUTLINE.color) {
        lines.push(
          `    <path\n        android:fillColor="#00000000"\n        android:strokeColor="${MONOCHROME_OUTLINE.color}"\n` +
            `        android:strokeWidth="${MONOCHROME_OUTLINE.width}"\n        android:strokeLineJoin="round"\n        android:pathData="${p.d}" />`,
        )
      } else lines.push(pathXml(p, '    '))
    }
  }
  const { width, paths } = svgPaths(
    read(icon.mark.source).toString('utf8'),
    icon.mark.source,
  )
  const s = num(icon.mark.size / width)
  lines.push(
    `    <group\n        android:translateX="${icon.mark.x}"\n        android:translateY="${icon.mark.y}"\n        android:scaleX="${s}"\n        android:scaleY="${s}">`,
    ...paths.map((p) => pathXml(p, '      ')),
    '    </group>',
  )
  const k = num(VIEWPORT / GRID)
  const offset = (CANVAS - VIEWPORT) / 2
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n${ICON_XML(icon)}\n` +
    vectorOpen() +
    `  <group\n      android:translateX="${offset}"\n      android:translateY="${offset}"\n      android:scaleX="${k}"\n      android:scaleY="${k}">\n` +
    `${lines.join('\n')}\n  </group>\n</vector>\n`
  )
}

/**
 * The `ic_launcher_background` color: the Android splash screen takes one
 * color behind the icon's foreground, not a drawable, so it gets the ground's
 * first stop (primary blue), on which both apps' foregrounds are designed to
 * sit.
 */
export function launcherBackground(icon, read) {
  const ground = icon.layers[0]
  const { stops } = groundGradient(read(ground).toString('utf8'), ground)
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n${GENERATED_XML(ground)}\n` +
    `<resources>\n  <color name="ic_launcher_background">#${stops[0].color.slice(3)}</color>\n</resources>\n`
  )
}

export const adaptiveIcon = (icon) =>
  `<?xml version="1.0" encoding="utf-8"?>\n${ICON_XML(icon)}\n` +
  `<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n` +
  `  <background android:drawable="@drawable/ic_launcher_background" />\n` +
  `  <foreground android:drawable="@drawable/ic_launcher_foreground" />\n` +
  `  <monochrome android:drawable="@drawable/ic_launcher_monochrome" />\n` +
  `</adaptive-icon>\n`

/** A Windows .ico of PNG images, `pngs` as `[{ size, png }]`. */
export function packIco(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  let offset = header.length
  pngs.forEach(({ size, png }, i) => {
    const at = 6 + 16 * i
    header.writeUInt8(size >= 256 ? 0 : size, at)
    header.writeUInt8(size >= 256 ? 0 : size, at + 1)
    header.writeUInt16LE(1, at + 4)
    header.writeUInt16LE(32, at + 6)
    header.writeUInt32LE(png.length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...pngs.map(({ png }) => png)])
}

/** A macOS .icns of PNG images, `pngs` as `[{ type, png }]`. */
export function packIcns(pngs) {
  const entries = pngs.map(({ type, png }) => {
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([head, png])
  })
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(8 + entries.reduce((n, e) => n + e.length, 0), 4)
  return Buffer.concat([head, ...entries])
}

/** The image count an .ico declares, or the entry count of an .icns; null when the bytes are neither. */
export function iconContainerCount(bytes, format) {
  if (format === 'ico')
    return bytes.length >= 6 && bytes.readUInt16LE(2) === 1
      ? bytes.readUInt16LE(4)
      : null
  if (
    bytes.length < 8 ||
    bytes.toString('ascii', 0, 4) !== 'icns' ||
    bytes.readUInt32BE(4) !== bytes.length
  )
    return null
  let n = 0
  for (let at = 8; at < bytes.length; at += bytes.readUInt32BE(at + 4)) n++
  return n
}

/**
 * Every text output, as `{ file, content }` (Buffer for the SVG copies, which
 * are the console's bytes exactly). `read(name)` returns a brand file's bytes.
 */
export function brandTextOutputs(read) {
  const outputs = [
    { file: `${APPLE_CATALOG}/Contents.json`, content: catalogContents() },
  ]
  for (const image of BRAND_IMAGES) {
    const set = `${APPLE_CATALOG}/${image.apple}.imageset`
    outputs.push({
      file: `${set}/Contents.json`,
      content: imageSetContents(image),
    })
    outputs.push({
      file: `${set}/${image.apple}.svg`,
      content: read(image.light),
    })
    if (image.dark !== image.light)
      outputs.push({
        file: `${set}/${image.apple}-dark.svg`,
        content: read(image.dark),
      })
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
  for (const icon of APP_ICONS) {
    outputs.push({
      file: `${appleIconSet(icon.apple)}/Contents.json`,
      content: appIconContents(),
    })
    outputs.push({
      file: `${appleLaunchSet(icon.apple)}/Contents.json`,
      content: launchLogoContents(),
    })
    const res = androidRes(icon.android)
    outputs.push({
      file: `${res}/mipmap-anydpi-v26/ic_launcher.xml`,
      content: adaptiveIcon(icon),
    })
    outputs.push({
      file: `${res}/drawable/ic_launcher_background.xml`,
      content: adaptiveBackground(icon, read),
    })
    outputs.push({
      file: `${res}/values/ic_launcher_background.xml`,
      content: launcherBackground(icon, read),
    })
    outputs.push({
      file: `${res}/drawable/ic_launcher_foreground.xml`,
      content: adaptiveForeground(icon, read),
    })
    outputs.push({
      file: `${res}/drawable/ic_launcher_monochrome.xml`,
      content: adaptiveForeground(icon, read, { monochrome: true }),
    })
  }
  outputs.push(...authOutputs(read))
  return outputs
}

/** Where the sign-in theme's token files go (AGL-3934). */
export const AUTH_THEME_SWIFT =
  'libs/native/apple/Sources/AglynUI/AuthTheme.generated.swift'
export const AUTH_THEME_KOTLIN =
  'libs/native/kotlin/ui/src/commonMain/kotlin/com/aglyn/ui/AuthTheme.generated.kt'

export const appleLaunchArtSet = (app) =>
  `apps/ios/${app}/Assets.xcassets/${LAUNCH_BACKGROUND}.imageset`
const launchArtFile = (art, dark) =>
  `${LAUNCH_BACKGROUND}-${art.idiom}${dark ? '-dark' : ''}.png`

/** The launch art's image set: iPhone and iPad, light and dark, each at the one scale it is drawn at. */
export function launchArtContents() {
  return json({
    images: LAUNCH_ART.flatMap((art) =>
      [false, true].map((dark) => ({
        ...(dark
          ? { appearances: [{ appearance: 'luminosity', value: 'dark' }] }
          : {}),
        filename: launchArtFile(art, dark),
        idiom: art.idiom,
        scale: `${art.scale}x`,
      })),
    ),
    info: XCODE_INFO,
  })
}

/**
 * The iOS launch art (LaunchScreen.storyboard's full-bleed image): the Facets
 * ground at intro frame 1, per app, idiom and appearance. Rendered with sharp
 * from `facetsSvg`; `--check` holds each by its pixel size, and the lock by
 * the SVG it was drawn from.
 */
export function launchArt() {
  return APP_ICONS.flatMap((icon) =>
    LAUNCH_ART.flatMap((art) =>
      [false, true].map((dark) => ({
        file: `${appleLaunchArtSet(icon.apple)}/${launchArtFile(art, dark)}`,
        width: art.width * art.scale,
        height: art.height * art.scale,
        scale: art.scale,
        svg: facetsSvg(art.width, art.height, { dark, settle: 0 }),
      })),
    ),
  )
}

/** The 288 dp splash-icon canvas and the mark's box in it (spec: 288 dp canvas, 192 dp mask; the mark at 112). */
const SPLASH_CANVAS = 288
const SPLASH_MARK = 112

/** The mark's paths on the splash canvas, each inside its own named group. */
function splashMarkGroups(read, { clips = false } = {}) {
  const source = LAUNCH_LOGO.light
  const { paths, width } = svgPaths(read(source).toString('utf8'), source)
  const offset = (SPLASH_CANVAS - SPLASH_MARK) / 2
  const scale = num(SPLASH_MARK / width)
  // The mark's first path is the pink frame, its second the blue pen.
  const names = ['frame', 'pen']
  const groups = paths.map((path, i) => {
    const name = names[i] ?? `part${i}`
    const clip = clips
      ? `        <clip-path\n            android:name="${name}_clip"\n            android:pathData="${SPLASH_REVEAL[name]?.from ?? FULL_CLIP}" />\n`
      : ''
    return (
      `      <group android:name="${name}">\n${clip}` +
      `${pathXml(path, '        ')}\n      </group>`
    )
  })
  return (
    `    <group\n        android:translateX="${offset}"\n        android:translateY="${offset}"\n` +
    `        android:scaleX="${scale}"\n        android:scaleY="${scale}">\n${groups.join('\n')}\n    </group>`
  )
}

const FULL_CLIP = 'M0,0 L24,0 L24,24 L0,24 Z'
/**
 * How each part of the mark draws in: a triangle growing from a corner of
 * its 24 grid until it covers the whole mark (the art itself never changes).
 * The frame grows from the top left, the pen from the bottom left, along it.
 */
const SPLASH_REVEAL = {
  frame: {
    from: 'M0,0 L0,0 L0,0 Z',
    to: 'M0,0 L48,0 L0,48 Z',
    start: INTRO_TIMELINE.androidFrameStartMs,
    end: INTRO_TIMELINE.androidFrameEndMs,
  },
  pen: {
    from: 'M0,24 L0,24 L0,24 Z',
    to: 'M0,24 L0,-24 L48,24 Z',
    start: INTRO_TIMELINE.androidPenStartMs,
    end: INTRO_TIMELINE.androidPenEndMs,
  },
}

const splashVectorOpen = (indent = '') =>
  `${indent}<vector xmlns:android="http://schemas.android.com/apk/res/android"\n` +
  `${indent}    android:width="${SPLASH_CANVAS}dp"\n${indent}    android:height="${SPLASH_CANVAS}dp"\n` +
  `${indent}    android:viewportWidth="${SPLASH_CANVAS}"\n${indent}    android:viewportHeight="${SPLASH_CANVAS}">\n`

/** The splash icon before Android 12 (the compat splash draws it still): the mark at rest. */
export function splashIconStatic(read) {
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n${GENERATED_XML(LAUNCH_LOGO.light)}\n` +
    `${splashVectorOpen()}${splashMarkGroups(read)}\n</vector>\n`
  )
}

/**
 * The Android 12+ animated splash icon: the frame draws in, then the pen
 * (spec: frame 0–450 ms, pen 250–700 ms, 800 ms in all).
 */
export function splashIconAnimated(read) {
  const targets = Object.entries(SPLASH_REVEAL).map(
    ([name, reveal]) =>
      `  <target android:name="${name}_clip">\n` +
      '    <aapt:attr name="android:animation">\n' +
      '      <objectAnimator\n' +
      '          android:propertyName="pathData"\n' +
      `          android:startOffset="${reveal.start}"\n` +
      `          android:duration="${reveal.end - reveal.start}"\n` +
      `          android:valueFrom="${reveal.from}"\n` +
      `          android:valueTo="${reveal.to}"\n` +
      '          android:valueType="pathType"\n' +
      '          android:interpolator="@android:interpolator/fast_out_slow_in" />\n' +
      '    </aapt:attr>\n  </target>',
  )
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n${GENERATED_XML(LAUNCH_LOGO.light)}\n` +
    '<animated-vector xmlns:android="http://schemas.android.com/apk/res/android"\n' +
    '    xmlns:aapt="http://schemas.android.com/aapt">\n' +
    '  <aapt:attr name="android:drawable">\n' +
    `${splashVectorOpen('    ')}${splashMarkGroups(read, { clips: true }).replace(/^/gm, '    ')}\n    </vector>\n` +
    '  </aapt:attr>\n' +
    `${targets.join('\n')}\n</animated-vector>\n`
  )
}

/** The splash ground (bg/canvas), light in values/ and dark in values-night/. */
const splashColors = (dark) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<!-- GENERATED by tools/scripts/generate-native-brand-assets.mjs from tools/scripts/lib/native-auth-theme.mjs — do not edit. -->\n` +
  `<resources>\n  <color name="aglyn_splash_ground">${AUTH_COLORS.canvas[dark ? 'dark' : 'light']}</color>\n` +
  `  <integer name="aglyn_splash_duration">${INTRO_TIMELINE.androidIconMs}</integer>\n</resources>\n`

/** Every text file the sign-in and launch theme writes (AGL-3934). */
export function authOutputs(read) {
  const outputs = [
    { file: AUTH_THEME_SWIFT, content: authThemeSwift() },
    { file: AUTH_THEME_KOTLIN, content: authThemeKotlin() },
  ]
  for (const icon of APP_ICONS) {
    outputs.push({
      file: `${appleLaunchArtSet(icon.apple)}/Contents.json`,
      content: launchArtContents(),
    })
    const res = androidRes(icon.android)
    outputs.push(
      { file: `${res}/values/splash.xml`, content: splashColors(false) },
      { file: `${res}/values-night/splash.xml`, content: splashColors(true) },
      {
        file: `${res}/drawable/splash_icon.xml`,
        content: splashIconStatic(read),
      },
      {
        file: `${res}/drawable-v31/splash_icon.xml`,
        content: splashIconAnimated(read),
      },
    )
  }
  return outputs
}

const LAUNCH_LOGO_SCALES = [1, 2, 3]

/** The launch mark's image set: one PNG per scale. */
export function launchLogoContents() {
  return json({
    images: LAUNCH_LOGO_SCALES.map((scale) => ({
      filename: `${LAUNCH_LOGO.apple}@${scale}x.png`,
      idiom: 'universal',
      scale: `${scale}x`,
    })),
    info: XCODE_INFO,
  })
}

/** The launch mark's PNGs, per app and scale, drawn from the mark SVG at its point size. */
export function launchLogoRasters(read) {
  const svg = sizedSvg(
    read(LAUNCH_LOGO.light),
    LAUNCH_LOGO.width,
    LAUNCH_LOGO.height,
    LAUNCH_LOGO.light,
  ).toString()
  return APP_ICONS.flatMap((icon) =>
    LAUNCH_LOGO_SCALES.map((scale) => ({
      file: `${appleLaunchSet(icon.apple)}/${LAUNCH_LOGO.apple}@${scale}x.png`,
      width: LAUNCH_LOGO.width * scale,
      height: LAUNCH_LOGO.height * scale,
      scale,
      svg,
    })),
  )
}
