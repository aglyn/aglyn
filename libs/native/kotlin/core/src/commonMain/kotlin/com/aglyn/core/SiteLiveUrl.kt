package com.aglyn.core

/*
 * Where a site's pages are live, as the CONSOLE the app talks to reaches them: the port of the console's
 * `siteLiveUrlForSlug` (libs/aglyn/src/lib/app-utils/site-live-url.ts, AGL-3758). A deployed console links the site's
 * custom domain, else its platform address; a LOCAL console (localhost, a loopback, the Android emulator's 10.0.2.2)
 * links the local tenant, and a preview console (`*.vercel.app`) the tenant preview deployment, both naming the site
 * with `?tenantHost=`. So Visit site and "Open live page" on the local stack open the local site, never production
 * (AGL-4086). function-cases.generated.json replays the console's answers; the Apple core's SiteLiveURL.swift.
 */
object SiteLiveUrl {
  /** The tenant preview deployment a preview console links (the console's `TENANT_PREVIEW_HOST` default). */
  const val TENANT_PREVIEW_HOST = "aglyn-tenant-git-main-aglyn.vercel.app"

  /** The local tenant a local console links (the console's `TENANT_LOCAL_ORIGIN` default, `nx serve tenant`). */
  const val TENANT_LOCAL_ORIGIN = "http://localhost:4500"

  /** The loopbacks and the Android emulator's address for its machine: never a deployment. */
  private val LOCAL_CONSOLE_ADDRESSES = setOf("127.0.0.1", "::1", "[::1]", "10.0.2.2")

  /** `localhost`, `*.localhost` and the loopback addresses, which have a local tenant to use. */
  fun isLocalConsole(hostname: String): Boolean =
    hostname == "localhost" || hostname.endsWith(".localhost") || hostname in LOCAL_CONSOLE_ADDRESSES

  /** A Vercel preview console, or a local one. */
  fun isPreviewConsole(hostname: String): Boolean = hostname.endsWith(".vercel.app") || isLocalConsole(hostname)

  /** The hostname of a console origin (`http://10.0.2.2:4610` → `10.0.2.2`), as the console's `window.location.hostname` reads its own. */
  fun consoleHostname(origin: String?): String? {
    val rest = origin?.substringAfter("://", "")?.takeIf { it.isNotEmpty() } ?: return null
    val authority = rest.substringBefore('/').substringBefore('?').substringBefore('#').substringAfterLast('@')
    val host = if (authority.startsWith("[")) authority.substringBefore(']') + "]" else authority.substringBefore(':')
    return host.lowercase().takeIf { it.isNotEmpty() }
  }

  /**
   * The live URL for a site-relative [slug] ("/" is the home), or null when the site has no address to link.
   * [consoleHostname] is the console's own; null reads as a deployed console.
   */
  fun forSlug(subdomain: String?, cname: String?, slug: String, consoleHostname: String?, apex: String = DEFAULT_TENANT_APEX): String? {
    // Published slugs carry a leading slash; the origin ends without one.
    val path = if (slug == "/") "" else slug.trimStart('/')
    val sub = subdomain?.takeIf { it.isNotEmpty() }
    if (consoleHostname != null && isPreviewConsole(consoleHostname)) {
      if (sub == null) return null
      val origin = if (isLocalConsole(consoleHostname)) TENANT_LOCAL_ORIGIN else "https://$TENANT_PREVIEW_HOST"
      return "$origin/$path?tenantHost=${encodeUriComponent(sub)}"
    }
    val domain = cname?.takeIf { it.isNotEmpty() } ?: sub?.let { "$it.$apex" } ?: return null
    return "https://$domain/$path"
  }

  /** Visit site's address: the site's home as the console at [consoleOrigin] reaches it. */
  fun home(subdomain: String?, cname: String?, consoleOrigin: String?): String? =
    forSlug(subdomain, cname, "/", consoleHostname(consoleOrigin))

  /** JavaScript's `encodeURIComponent`: everything but `A–Z a–z 0–9 - _ . ! ~ * ' ( )` is percent-encoded (UTF-8). */
  internal fun encodeUriComponent(text: String): String = buildString {
    for (byte in text.encodeToByteArray()) {
      val c = (byte.toInt() and 0xFF)
      val ch = c.toChar()
      if (c < 0x80 && (ch.isLetterOrDigit() || ch in "-_.!~*'()")) append(ch)
      else append('%').append("0123456789ABCDEF"[c shr 4]).append("0123456789ABCDEF"[c and 0xF])
    }
  }
}
