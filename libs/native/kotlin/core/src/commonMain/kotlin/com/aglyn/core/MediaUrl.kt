package com.aglyn.core

import com.aglyn.contracts.resolveMediaSrc

/**
 * Where a picture the console stored is shown from in the app: a product photo, a site's favicon, a workspace or
 * store logo, a photo field. The console keeps three generations in those fields (a `media:` reference, a path on
 * its media CDN, an https address) and renders them relative to its own origin (`resolveMediaSrc`). Here a reference
 * becomes the CDN path, qualified for the site being shown; a path is read from [origin], the console the app talks
 * to; a CDN path gets a [width] the CDN serves a delivery copy at. Null for nothing, or for anything that is not then
 * an http(s) address, so a stored value can never point an image loader anywhere else.
 */
fun mediaPreviewUrl(value: String?, origin: String, hostId: String?, width: Int = 320): String? {
  val resolved = resolveMediaSrc(value?.trim()?.ifEmpty { null }, hostId) ?: return null
  val base = origin.trimEnd('/')
  val address = when {
    resolved.startsWith("/api/media/cdn/") && "?" !in resolved -> "$base$resolved?w=$width"
    resolved.startsWith("/") && !resolved.startsWith("//") -> base + resolved
    else -> resolved
  }
  val lower = address.lowercase()
  val rest = when {
    lower.startsWith("https://") -> address.substring(8)
    lower.startsWith("http://") -> address.substring(7)
    else -> return null
  }
  val host = rest.substringBefore('/').substringBefore('?').substringBefore('#')
  return if (host.isEmpty() || host.any { it.isWhitespace() } || address.any { it.isWhitespace() }) null else address
}

/**
 * The sides the media CDN draws an asset at as a transparent PNG (`?icon=png-N`; `site-icon-set.ts`'s FAVICON_PNG_SIZES
 * and MANIFEST_ICON_SIZES), as Apple's `AglynRasterArt.pngSides`.
 */
val MEDIA_PNG_SIDES = listOf(16, 32, 48, 72, 96, 128, 144, 152, 192, 256, 384, 512)

/**
 * The media CDN's PNG of the picture at [url], at least as wide as the `w` it was asked at (160 when none), for art the
 * image decoders cannot read: the CDN serves an SVG unchanged at `?w=`, so a workspace logo uploaded as an SVG drew
 * its initials and gave the rail no color (AGL-4000, as Apple's AGL-3996). Null for an address that is not on
 * the media CDN, or one that already names a representation (`icon=`).
 */
fun mediaRasterUrl(url: String): String? {
  val path = url.substringBefore('#').substringBefore('?')
  if ("/api/media/cdn/" !in path) return null
  val query = url.substringBefore('#').substringAfter('?', "")
  val items = query.split('&').filter { it.isNotEmpty() }
  if (items.any { it.substringBefore('=') == "icon" }) return null
  val width = items.firstOrNull { it.substringBefore('=') == "w" }?.substringAfter('=')?.toIntOrNull() ?: 160
  val side = MEDIA_PNG_SIDES.firstOrNull { it >= width } ?: MEDIA_PNG_SIDES.last()
  return path + "?" + (items.filter { it.substringBefore('=') != "w" } + "icon=png-$side").joinToString("&")
}
