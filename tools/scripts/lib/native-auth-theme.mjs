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
 * The native sign-in and launch theme (AGL-3934), from the Figma build spec
 * "Build spec · Sign in & launch" (file NrDk4KvvasUKUcramPMwU5, node 53:1638):
 * the Facets background, the auth card, the button and provider-button
 * system, the field, and the intro timeline. One source for the Swift and
 * Kotlin token files and the iOS launch art, so the three never drift
 * (generate-native-brand-assets.mjs writes them all and `--check` holds them).
 */

/** A color per appearance, as `#RRGGBB` (or `#RRGGBBAA`). */
const pair = (light, dark = light) => ({ light, dark })

/** The colors, named by the Figma variables they mirror. */
export const AUTH_COLORS = {
  /** bg/canvas: the ground under the Facets planes and the Android splash. */
  canvas: pair('#F5F5F5', '#161C21'),
  /** bg/surface: a field's fill. */
  surface: pair('#FFFFFF', '#1E262E'),
  /** bg/raised: the auth card. */
  raised: pair('#FFFFFF', '#27313B'),
  /** bg/hover and bg/sunken: a secondary or tertiary button hovered and pressed. */
  hover: pair('#EEF1F5', '#2A343E'),
  sunken: pair('#EDF0F4', '#12181D'),
  borderSubtle: pair('#E3E7EC', '#2E3944'),
  borderStrong: pair('#C8D0D9', '#45525F'),
  textPrimary: pair('#1F2329', '#F3F5F7'),
  textSecondary: pair('#5E6773', '#B3BCC6'),
  textTertiary: pair('#7A838E', '#8A96A3'),
  dangerForeground: pair('#A8231E', '#ED7876'),
  dangerBackground: pair('#FCE6E5', '#3B1A1A'),
  warningForeground: pair('#85560F', '#FFC479'),
  warningBackground: pair('#FFF0DA', '#3A2C14'),
  infoForeground: pair('#10548F', '#5DA1DC'),
  infoBackground: pair('#E3F0FB', '#132C42'),
  /** accent/ring: a focused field. */
  focusRing: pair('#00B0FF'),
  /**
   * accent/fill: the primary button, the brand blue under white as the console's contained button draws it (AGL-3990;
   * #0073AE is retired). Hover is the console's `primary.hover`.
   */
  primary: pair('#00B0FF'),
  primaryHover: pair('#0077AD'),
  primaryPressed: pair('#006999'),
  onPrimary: pair('#FFFFFF'),
  secondaryFill: pair('#FFFFFF', '#1E262E'),
  secondaryHover: pair('#EEF1F5', '#2A343E'),
  secondaryPressed: pair('#EDF0F4', '#12181D'),
  secondaryStroke: pair('#C8D0D9', '#45525F'),
  destructive: pair('#B3261E', '#C93A31'),
  destructiveHover: pair('#9C211A', '#B3261E'),
  destructivePressed: pair('#861C16', '#9C211A'),
  /** Google's own button colors (Google Identity branding): light on a light ground, dark on a dark one. */
  googleFill: pair('#FFFFFF', '#131314'),
  googleStroke: pair('#747775', '#8E918F'),
  googleText: pair('#1F1F1F', '#E3E3E3'),
  googleNeutralFill: pair('#F2F2F2'),
  /** The soft light at the top of the Facets ground. */
  softLight: pair('#FFFFFF', '#00B0FF'),
  /** The card's shadow ink (Elevation/Popover). */
  shadow: pair('#0F1721'),
}

/**
 * The brand gradient every Facets plane is filled with: 242°, blue → violet
 * 55% → pink, as the Figma boards draw it. Each plane's own box is the unit
 * square (y down); the gradient runs toward its last stop along
 * (sin 242°, cos 242°), up and to the left, centered on the box.
 */
export const BRAND_GRADIENT = {
  degrees: 242,
  stops: [
    ['#00B0FF', 0],
    ['#7A5CF0', 0.55],
    ['#E040FB', 1],
  ],
}

/**
 * The Facets planes. Points are fractions of the canvas (x of the width, y of
 * the height); a plane's sloped edge keeps the mark's own angles, so its far
 * end is computed from the canvas's aspect rather than stored.
 */
export const FACETS = {
  /** The pen's angle in the mark, and its complement. */
  penDegrees: 34.5,
  complementDegrees: 55.5,
  topStartX: 0.7,
  bandLeftX: -0.05,
  bandRightX: 1.25,
  bandStartY: 0.88,
  /** The band's vertical thickness, a fraction of the height. */
  bandThickness: 0.14,
  cornerStartX: 0.4,
  accentStartX: 0.56,
  /** The accent's vertical thickness, a fraction of the canvas's shorter side. */
  accentThickness: 0.07,
  /** The soft light's box: its top-left corner and size, fractions of the canvas. */
  softLightX: 0.55,
  softLightY: -0.3,
  softLightWidth: 0.7,
  softLightHeight: 0.7,
  /** The soft light's blur radius, a fraction of the canvas's shorter side. */
  softLightBlur: 0.14,
  opacity: {
    light: { softLight: 0.55, top: 0.16, band: 0.1, corner: 0.2, accent: 0.38 },
    dark: { softLight: 0.2, top: 0.26, band: 0.18, corner: 0.34, accent: 0.5 },
  },
  /** Intro frame 1 (= the launch screen): each plane sits this far out from rest, at this share of its opacity. */
  settleDistance: 12,
  settleOpacity: 0.9,
  /** iPad lays the planes out on a square of its longer side, centered, so they hold in both orientations. */
}

/** The auth layout, buttons and fields (points on Apple, dp on Android). */
export const AUTH_METRICS = {
  cardRadius: 24,
  cardMarginCompact: 16,
  cardPaddingCompact: 20,
  cardPaddingRegular: 24,
  cardSpacingCompact: 12,
  cardSpacingRegular: 16,
  cardWidthTablet: 440,
  cardWidthDesktop: 420,
  lockupHeight: 28,
  lockupClearSpace: 28,
  lockupTopCompact: 16,
  lockupLeadingCompact: 28,
  lockupLeadingRegular: 48,
  cardGapBelowLockup: 42,
  footerGap: 8,
  launchMarkCompact: 96,
  launchMarkRegular: 120,
  buttonHeight: 48,
  buttonRadius: 12,
  buttonPadding: 20,
  buttonIconGap: 10,
  buttonIcon: 20,
  buttonMediumHeight: 36,
  buttonMediumRadius: 8,
  buttonMediumPadding: 14,
  providerPadding: 16,
  providerSpacing: 8,
  googleGlyph: 20,
  fieldHeight: 48,
  fieldRadius: 8,
  fieldPadding: 14,
  fieldLabelGap: 6,
  fieldMessageGap: 6,
  fieldMessageIcon: 14,
  focusRingWidth: 2,
  disabledOpacity: 0.4,
}

/** The intro, in milliseconds (spec "Intro timeline"; Android "SplashScreen"). */
export const INTRO_TIMELINE = {
  settleMs: 240,
  lockupStartMs: 360,
  lockupEndMs: 600,
  crossFadeMs: 200,
  destinationMs: 220,
  destinationRise: 24,
  breatheLow: 0.8,
  breathePeriodMs: 1200,
  reduceMotionFadeMs: 200,
  /** The lockup's spring. */
  springResponse: 0.45,
  springDamping: 0.9,
  androidIconMs: 800,
  androidFrameStartMs: 0,
  androidFrameEndMs: 450,
  androidPenStartMs: 250,
  androidPenEndMs: 700,
  androidExitMs: 300,
  androidExitSlide: 120,
  androidExitIconScale: 0.9,
}

const rad = (deg) => (deg * Math.PI) / 180

/**
 * The Facets layout on a `width` × `height` canvas: the soft light and the
 * four planes, each with its polygon (canvas units) and opacity. `settle` runs
 * from 0 (intro frame 1: planes `settleDistance` out from rest at
 * `settleOpacity`) to 1 (rest), already eased by the caller.
 */
export function facetsLayout(width, height, { dark = false, settle = 1 } = {}) {
  const f = FACETS
  const pen = Math.tan(rad(f.penDegrees))
  const complement = Math.tan(rad(f.complementDegrees))
  const short = Math.min(width, height)
  const opacity = f.opacity[dark ? 'dark' : 'light']
  const bandRise = (f.bandRightX - f.bandLeftX) * width * pen
  const bandTopLeft = f.bandStartY * height
  const accentThickness = f.accentThickness * short
  const accentTop = height - (1 - f.accentStartX) * width * pen
  const planes = [
    {
      name: 'top',
      points: [
        [f.topStartX * width, 0],
        [width, 0],
        [width, (1 - f.topStartX) * width * complement],
      ],
    },
    {
      name: 'band',
      points: [
        [f.bandLeftX * width, bandTopLeft],
        [f.bandRightX * width, bandTopLeft - bandRise],
        [
          f.bandRightX * width,
          bandTopLeft - bandRise + f.bandThickness * height,
        ],
        [f.bandLeftX * width, bandTopLeft + f.bandThickness * height],
      ],
    },
    {
      name: 'corner',
      points: [
        [f.cornerStartX * width, height],
        [width, height - (1 - f.cornerStartX) * width * pen],
        [width, height],
      ],
    },
    {
      name: 'accent',
      points: [
        [f.accentStartX * width, height],
        [width, accentTop],
        [width, accentTop + accentThickness],
        [f.accentStartX * width + accentThickness / pen, height],
      ],
    },
  ]
  const cx = width / 2
  const cy = height / 2
  for (const plane of planes) {
    const n = plane.points.length
    const mx = plane.points.reduce((s, p) => s + p[0], 0) / n
    const my = plane.points.reduce((s, p) => s + p[1], 0) / n
    const len = Math.hypot(mx - cx, my - cy) || 1
    const out = f.settleDistance * (1 - settle)
    const dx = ((mx - cx) / len) * out
    const dy = ((my - cy) / len) * out
    plane.points = plane.points.map(([x, y]) => [x + dx, y + dy])
    plane.opacity =
      opacity[plane.name] * (f.settleOpacity + (1 - f.settleOpacity) * settle)
  }
  return {
    softLight: {
      cx: (f.softLightX + f.softLightWidth / 2) * width,
      cy: (f.softLightY + f.softLightHeight / 2) * height,
      rx: (f.softLightWidth * width) / 2,
      ry: (f.softLightHeight * height) / 2,
      blur: f.softLightBlur * short,
      opacity: opacity.softLight,
    },
    planes,
  }
}

/**
 * The gradient line across a box (see BRAND_GRADIENT): its start (first stop)
 * and end (last stop) points, in the box's own coordinates.
 */
export function gradientLine(minX, minY, maxX, maxY, degrees) {
  const a = rad(degrees)
  const w = maxX - minX || 1
  const h = maxY - minY || 1
  // The direction in the unit box, carried into the box: u grows by 1 from start to end.
  const gx = Math.sin(a) / w
  const gy = Math.cos(a) / h
  const g2 = gx * gx + gy * gy
  const dx = gx / g2
  const dy = gy / g2
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  return [cx - dx / 2, cy - dy / 2, cx + dx / 2, cy + dy / 2]
}

const r2 = (n) => Number(n.toFixed(2))

/**
 * The Facets ground as an SVG at `width` × `height`, optionally with the mark
 * centered at `mark` units (`markPaths` from the brand SVG, on its 24 grid):
 * the iOS launch screen's art is this at `settle` 0.
 */
export function facetsSvg(width, height, { dark = false, settle = 1 } = {}) {
  const { softLight, planes } = facetsLayout(width, height, { dark, settle })
  const ground = AUTH_COLORS.canvas[dark ? 'dark' : 'light']
  const light = AUTH_COLORS.softLight[dark ? 'dark' : 'light']
  const defs = [
    `<filter id="soft" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="${r2(softLight.blur / 2)}"/></filter>`,
  ]
  const shapes = []
  planes.forEach((plane, i) => {
    const xs = plane.points.map((p) => p[0])
    const ys = plane.points.map((p) => p[1])
    const [x1, y1, x2, y2] = gradientLine(
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
      BRAND_GRADIENT.degrees,
    )
    defs.push(
      `<linearGradient id="g${i}" gradientUnits="userSpaceOnUse" x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}">` +
        BRAND_GRADIENT.stops
          .map(([color, at]) => `<stop offset="${at}" stop-color="${color}"/>`)
          .join('') +
        '</linearGradient>',
    )
    shapes.push(
      `<polygon points="${plane.points.map(([x, y]) => `${r2(x)},${r2(y)}`).join(' ')}" fill="url(#g${i})" fill-opacity="${r2(plane.opacity * 1000) / 1000}"/>`,
    )
  })
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs>${defs.join('')}</defs>` +
    `<rect width="${width}" height="${height}" fill="${ground}"/>` +
    `<ellipse cx="${r2(softLight.cx)}" cy="${r2(softLight.cy)}" rx="${r2(softLight.rx)}" ry="${r2(softLight.ry)}" fill="${light}" fill-opacity="${softLight.opacity}" filter="url(#soft)"/>` +
    shapes.join('') +
    '</svg>\n'
  )
}

/**
 * The iOS launch screen's background art, per app and idiom: iPhone at its
 * largest portrait canvas, iPad on the square it lays the planes out on. The
 * launch storyboard aspect-fills it, as the intro's first frame does.
 */
export const LAUNCH_ART = [
  { idiom: 'iphone', width: 440, height: 956, scale: 3 },
  { idiom: 'ipad', width: 1376, height: 1376, scale: 2 },
]
export const LAUNCH_BACKGROUND = 'LaunchBackground'

const SWIFT_HEADER =
  '// GENERATED by tools/scripts/generate-native-brand-assets.mjs from tools/scripts/lib/native-auth-theme.mjs — do not edit.\n' +
  '// The sign-in and launch theme (AGL-3934, Figma "Build spec · Sign in & launch" 53:1638).\n'

const hexInt = (hex) => {
  const raw = hex.replace('#', '')
  const rgb = raw.slice(0, 6).toUpperCase()
  const alpha = raw.length === 8 ? raw.slice(6).toUpperCase() : 'FF'
  return { rgb, alpha }
}
const swiftNumber = (n) => (Number.isInteger(n) ? `${n}` : `${n}`)

/** `AuthTheme.generated.swift` for AglynUI. */
export function authThemeSwift() {
  const colors = Object.entries(AUTH_COLORS)
    .map(([name, { light, dark }]) => {
      const l = hexInt(light)
      const d = hexInt(dark)
      return `    public static let ${name} = AglynAuthColor(light: 0x${l.rgb}${l.alpha}, dark: 0x${d.rgb}${d.alpha})`
    })
    .join('\n')
  const numbers = (object, indent) =>
    Object.entries(object)
      .filter(([, value]) => typeof value === 'number')
      .map(
        ([name, value]) =>
          `${indent}public static let ${name}: CGFloat = ${swiftNumber(value)}`,
      )
      .join('\n')
  const opacity = (mode) =>
    Object.entries(FACETS.opacity[mode])
      .map(([name, value]) => `${name}: ${value}`)
      .join(', ')
  return (
    `${SWIFT_HEADER}\nimport SwiftUI\n\n` +
    '/// The sign-in and launch theme: colors per appearance, the Facets ground, the layout metrics and the intro timeline.\n' +
    'public enum AglynAuthTokens {\n' +
    '  public enum Colors {\n' +
    `${colors}\n  }\n\n` +
    '  /// The brand gradient on every Facets plane (degrees as BRAND_GRADIENT in native-auth-theme.mjs reads them; stops as RGB and position).\n' +
    `  public static let gradientDegrees: Double = ${BRAND_GRADIENT.degrees}\n` +
    `  public static let gradientStops: [(rgb: UInt32, at: Double)] = [${BRAND_GRADIENT.stops.map(([c, at]) => `(0x${hexInt(c).rgb}, ${at})`).join(', ')}]\n\n` +
    '  public enum Facets {\n' +
    `${numbers(FACETS, '    ')}\n` +
    `    public static let lightOpacity = AglynFacetsOpacity(${opacity('light')})\n` +
    `    public static let darkOpacity = AglynFacetsOpacity(${opacity('dark')})\n` +
    '  }\n\n' +
    '  public enum Metrics {\n' +
    `${numbers(AUTH_METRICS, '    ')}\n  }\n\n` +
    '  /// Milliseconds, distances in points, and the spring.\n' +
    '  public enum Intro {\n' +
    `${numbers(INTRO_TIMELINE, '    ')}\n  }\n` +
    '}\n'
  )
}

const KOTLIN_HEADER =
  '// GENERATED by tools/scripts/generate-native-brand-assets.mjs from tools/scripts/lib/native-auth-theme.mjs — do not edit.\n' +
  '// The sign-in and launch theme (AGL-3934, Figma "Build spec · Sign in & launch" 53:1638).\n'

const kotlinFloat = (n) => `${Number.isInteger(n) ? `${n}.0` : n}f`
const lowerCamelToConst = (name) =>
  name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()

/** `AuthTheme.generated.kt` for the Compose ui module. */
export function authThemeKotlin() {
  const colors = Object.entries(AUTH_COLORS)
    .map(([name, { light, dark }]) => {
      const l = hexInt(light)
      const d = hexInt(dark)
      return `    val ${name} = AuthColor(0x${l.alpha}${l.rgb}, 0x${d.alpha}${d.rgb})`
    })
    .join('\n')
  const numbers = (object, indent) =>
    Object.entries(object)
      .filter(([, value]) => typeof value === 'number')
      .map(
        ([name, value]) =>
          `${indent}const val ${lowerCamelToConst(name)} = ${kotlinFloat(value)}`,
      )
      .join('\n')
  const opacity = (mode) =>
    Object.entries(FACETS.opacity[mode])
      .map(([name, value]) => `${name} = ${kotlinFloat(value)}`)
      .join(', ')
  return (
    `${KOTLIN_HEADER}package com.aglyn.ui\n\n` +
    '/** The sign-in and launch theme: colors per appearance, the Facets ground, the layout metrics and the intro timeline. */\n' +
    'object AuthTokens {\n' +
    '  object Colors {\n' +
    `${colors}\n  }\n\n` +
    '  /** The brand gradient on every Facets plane (degrees as BRAND_GRADIENT in native-auth-theme.mjs reads them; stops as ARGB and position). */\n' +
    `  const val GRADIENT_DEGREES = ${kotlinFloat(BRAND_GRADIENT.degrees)}\n` +
    `  val GRADIENT_STOPS: List<Pair<Long, Float>> = listOf(${BRAND_GRADIENT.stops.map(([c, at]) => `0xFF${hexInt(c).rgb} to ${kotlinFloat(at)}`).join(', ')})\n\n` +
    '  object Facets {\n' +
    `${numbers(FACETS, '    ')}\n` +
    `    val LIGHT_OPACITY = FacetsOpacity(${opacity('light')})\n` +
    `    val DARK_OPACITY = FacetsOpacity(${opacity('dark')})\n` +
    '  }\n\n' +
    '  /** dp. */\n' +
    '  object Metrics {\n' +
    `${numbers(AUTH_METRICS, '    ')}\n  }\n\n` +
    '  /** Milliseconds, distances in dp, and the spring. */\n' +
    '  object Intro {\n' +
    `${numbers(INTRO_TIMELINE, '    ')}\n  }\n` +
    '}\n'
  )
}
