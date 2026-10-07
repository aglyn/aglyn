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

  /** Matches `/a/:b/c` against a path; returns the `:` params or null. */
  fun matchPathPattern(pattern: String, path: String): Map<String, String>? {
    val want = pattern.split('/').filter { it.isNotEmpty() }
    val have = path.split('/').filter { it.isNotEmpty() }
    if (want.size != have.size) return null
    val params = linkedMapOf<String, String>()
    for (i in want.indices) {
      if (want[i].startsWith(":")) {
        params[want[i].substring(1)] = runCatching { have[i].decodeURLPart() }.getOrNull() ?: return null
      } else if (want[i] != have[i]) {
        return null
      }
    }
    return params
  }

  private fun parseQuery(query: String): Map<String, String> = query.split('&')
    .filter { it.isNotEmpty() }
    .associate { pair ->
      val at = pair.indexOf('=')
      val key = if (at < 0) pair else pair.substring(0, at)
      val value = if (at < 0) "" else pair.substring(at + 1)
      key.decodeURLQueryComponent(plusIsSpace = true) to value.decodeURLQueryComponent(plusIsSpace = true)
    }

  fun resolve(link: String?, deepLinks: List<NativeDeepLink>): NativeLinkTarget? {
    val full = consolePathOf(link) ?: return null
    val at = full.indexOf('?')
    val path = if (at < 0) full else full.substring(0, at)
    val query = if (at < 0) emptyMap() else parseQuery(full.substring(at + 1))
    val scope = splitConsoleScope(path)
    // Most specific pattern first: fewer `:` segments wins a tie in length.
    val ordered = deepLinks.sortedWith(
      compareByDescending<NativeDeepLink> { it.path.split('/').size }
        .thenBy { link -> link.path.count { it == ':' } },
    )
    for (candidate in ordered) {
      val params = matchPathPattern(candidate.path, scope.rest) ?: continue
      return NativeLinkTarget.Screen(
        candidate.screen,
        buildMap {
          putAll(query)
          scope.orgSlug?.let { put("orgSlug", it) }
          scope.hostSlug?.let { put("hostSlug", it) }
          putAll(params)
        },
      )
    }
    return if (BesignerPaths.isBesignerPath(full)) NativeLinkTarget.Besigner(full) else NativeLinkTarget.Unmatched(full)
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
