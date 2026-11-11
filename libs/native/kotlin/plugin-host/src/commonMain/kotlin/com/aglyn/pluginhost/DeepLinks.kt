package com.aglyn.pluginhost

import io.ktor.http.decodeURLPart
import io.ktor.http.decodeURLQueryComponent

/**
 * Turns a console URL or path into where the app should go. Every link the
 * app meets is a console link: an App Link to the console's own domain, an
 * `aglyn://` link, or a notification's `link`. A plugin that answers a path
 * natively registers a deep link for it; a Besigner page opens the Besigner
 * inside the app; anything else is [Unmatched], which the shell answers with
 * its nearest native screen. No link ever opens a console page.
 */
sealed interface NativeLinkTarget {
  data class Screen(val screen: String, val params: NativeParams) : NativeLinkTarget
  data class Besigner(val path: String) : NativeLinkTarget
  data class Unmatched(val path: String) : NativeLinkTarget
}

data class ConsoleScopeSplit(val orgSlug: String? = null, val hostSlug: String? = null, val rest: String)

object DeepLinks {
  /**
   * The console nests most pages under their workspace and site:
   * `/{orgSlug}/hosts/{hostSlug}/redirects` and `/{orgSlug}/crm`. Its own
   * top-level sections are not workspaces and are matched whole.
   */
  val CONSOLE_TOP_LEVEL = setOf("admin", "api", "auth", "billing", "manage", "signin", "signup", "support")

  private val HTTP_URL = Regex("^(https?)://([^/?#]*)([^?#]*)(\\?[^#]*)?(#.*)?$", RegexOption.IGNORE_CASE)
  private val AGLYN_URL = Regex("^aglyn://(.*)$", RegexOption.IGNORE_CASE)

  fun splitConsoleScope(path: String): ConsoleScopeSplit {
    val segments = path.split('/').filter { it.isNotEmpty() }
    if (segments.isEmpty() || segments[0] in CONSOLE_TOP_LEVEL) return ConsoleScopeSplit(rest = path.ifEmpty { "/" })
    val orgSlug = segments[0]
    if (segments.getOrNull(1) == "hosts" && !segments.getOrNull(2).isNullOrEmpty()) {
      return ConsoleScopeSplit(orgSlug, segments[2], "/" + segments.drop(3).joinToString("/"))
    }
    return ConsoleScopeSplit(orgSlug, rest = "/" + segments.drop(1).joinToString("/"))
  }

  /** The path part of a console URL, an `aglyn://` URL, or a bare path. */
  fun consolePathOf(link: String?): String? {
    val value = (link ?: "").trim()
    if (value.isEmpty()) return null
    if (value.startsWith("/")) return if (value.startsWith("//")) null else value
    AGLYN_URL.matchEntire(value)?.let { return "/" + it.groupValues[1].trimStart('/') }
    val match = HTTP_URL.matchEntire(value) ?: return null
    if (match.groupValues[2].isEmpty()) return null
    return match.groupValues[3].ifEmpty { "/" } + match.groupValues[4]
  }

  /**
   * Matches `/a/:b/c` against a path; returns the `:` params or null. A param may name the values it takes,
   * `:section(payouts|sales)`, or the ones it refuses, `:listingId(!upload)`: a console page whose literal segment sits
   * where an id would never becomes that id (AGL-4215).
   */
  fun matchPathPattern(pattern: String, path: String): Map<String, String>? {
    val want = pattern.split('/').filter { it.isNotEmpty() }
    val have = path.split('/').filter { it.isNotEmpty() }
    if (want.size != have.size) return null
    val params = linkedMapOf<String, String>()
    for (i in want.indices) {
      val param = PathParam.of(want[i])
      if (param != null) {
        val decoded = runCatching { have[i].decodeURLPart() }.getOrNull() ?: return null
        if (!param.admits(decoded)) return null
        params[param.name] = decoded
      } else if (want[i] != have[i]) {
        return null
      }
    }
    return params
  }

  /** One `:name`, `:name(a|b)` or `:name(!a|b)` segment of a route pattern. */
  private class PathParam(val name: String, val values: Set<String>?, val refuses: Boolean) {
    /** Whether it takes any value but the ones it refuses (an id), rather than one of a few named pages. */
    val open get() = values == null || refuses

    fun admits(value: String) = values == null || (value in values) != refuses

    companion object {
      fun of(segment: String): PathParam? {
        if (!segment.startsWith(":")) return null
        val body = segment.substring(1)
        val at = body.indexOf('(')
        if (at < 0 || !body.endsWith(")")) return PathParam(body, null, false)
        var list = body.substring(at + 1, body.length - 1)
        val refuses = list.startsWith("!")
        if (refuses) list = list.substring(1)
        return PathParam(body.substring(0, at), list.split('|').toSet(), refuses)
      }
    }
  }

  /**
   * A route pattern split into its path and the query keys it needs: `/products/orders?order=:orderId` matches
   * `/products/orders` only when the link carries a non-empty `order`, and binds it as `orderId` (the console's own
   * order and quote addresses, AGL-4215).
   */
  private class RoutePattern(pattern: String) {
    val path = pattern.substringBefore('?')
    val query: List<Pair<String, String>> = if ('?' !in pattern) emptyList() else pattern.substringAfter('?').split('&').mapNotNull { pair ->
      val key = pair.substringBefore('=', "")
      val value = pair.substringAfter('=', "")
      if (key.isEmpty() || !value.startsWith(":")) null else key to value.substring(1)
    }
    val segments = path.split('/').count { it.isNotEmpty() }

    /** How many segments take any value; a pattern with fewer wins a tie. */
    val openParams = path.split('/').count { PathParam.of(it)?.open == true }

    /** The query params it binds, or null when the link lacks one it needs. */
    fun bind(linkQuery: Map<String, String>): Map<String, String>? {
      val bound = linkedMapOf<String, String>()
      for ((key, param) in query) bound[param] = linkQuery[key]?.takeIf { it.isNotEmpty() } ?: return null
      return bound
    }
  }

  /** A link without its `#fragment`, which names a spot on a page and never a page (`/admin/orgs/{id}#site-care`). */
  fun withoutFragment(link: String): String = link.substringBefore('#')

  private fun parseQuery(query: String): Map<String, String> = query.split('&')
    .filter { it.isNotEmpty() }
    .associate { pair ->
      val at = pair.indexOf('=')
      val key = if (at < 0) pair else pair.substring(0, at)
      val value = if (at < 0) "" else pair.substring(at + 1)
      key.decodeURLQueryComponent(plusIsSpace = true) to value.decodeURLQueryComponent(plusIsSpace = true)
    }

  fun resolve(link: String?, deepLinks: List<NativeDeepLink>): NativeLinkTarget? {
    val raw = consolePathOf(link) ?: return null
    val full = withoutFragment(raw)
    val at = full.indexOf('?')
    val path = if (at < 0) full else full.substring(0, at)
    val query = if (at < 0) emptyMap() else parseQuery(full.substring(at + 1))
    val scope = splitConsoleScope(path)
    // Most specific pattern first: in a tie in length, the one that needs more of the query, then the one with fewer
    // segments that take any value (`/marketplace/payouts` and `:section(payouts|…)` before `:listingId`).
    val ordered = deepLinks.map { it to RoutePattern(it.path) }.sortedWith(
      compareByDescending<Pair<NativeDeepLink, RoutePattern>> { it.second.segments }
        .thenByDescending { it.second.query.size }
        .thenBy { it.second.openParams },
    )
    for ((candidate, pattern) in ordered) {
      val params = matchPathPattern(pattern.path, scope.rest) ?: continue
      val bound = pattern.bind(query) ?: continue
      return NativeLinkTarget.Screen(
        candidate.screen,
        buildMap {
          putAll(query)
          scope.orgSlug?.let { put("orgSlug", it) }
          scope.hostSlug?.let { put("hostSlug", it) }
          putAll(bound)
          putAll(params)
        },
      )
    }
    return if (BesignerPaths.isBesignerPath(raw)) NativeLinkTarget.Besigner(raw) else NativeLinkTarget.Unmatched(full)
  }

  /**
   * A notification's stored link as the console follows it (`normalizeNotificationLink`, AGL-644): host notifications
   * are stored as `/{hostDocId}/…` and opened at `/{orgSlug}/hosts/{subdomain}/…`, `/org/…` is the workspace's own
   * `/{orgSlug}/…`, and the bare `/hosts` is the workspace's Sites. Anything else, and an absolute URL, is left as it is.
   */
  fun notificationLink(link: String?, orgSlug: String?, hostId: String?, hostSubdomain: String?): String? {
    if (link.isNullOrEmpty()) return null
    if (!link.startsWith("/")) return link
    if (!orgSlug.isNullOrEmpty() && !hostId.isNullOrEmpty() && !hostSubdomain.isNullOrEmpty()) {
      val prefix = "/$hostId"
      if (link == prefix || link.startsWith("$prefix/") || link.startsWith("$prefix?")) {
        return "/$orgSlug/hosts/$hostSubdomain" + link.substring(prefix.length)
      }
    }
    if (!orgSlug.isNullOrEmpty()) {
      if (link == "/org" || link.startsWith("/org/") || link.startsWith("/org?")) return "/$orgSlug" + link.substring("/org".length)
      if (link == "/hosts") return "/$orgSlug/hosts"
    }
    return link
  }
}

/** A plugin's own page path under the picked workspace or site, as the console nests it. */
fun scopedConsolePath(path: String, scope: ConsoleScope, orgSlug: String?, hostSlug: String?): String {
  val rest = if (path.startsWith("/")) path else "/$path"
  if (scope == ConsoleScope.ABSOLUTE) return rest
  if (orgSlug.isNullOrEmpty()) return "/"
  val tail = if (rest == "/") "" else rest
  if (scope == ConsoleScope.ORG) return "/$orgSlug$tail"
  if (hostSlug.isNullOrEmpty()) return "/$orgSlug/hosts"
  return "/$orgSlug/hosts/$hostSlug$tail"
}
