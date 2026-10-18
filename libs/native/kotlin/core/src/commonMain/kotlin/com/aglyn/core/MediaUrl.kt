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
