package com.aglyn.contracts

/*
 * Where a page made from a template lands, and how its placeholders are
 * filled, ported once from libs/aglyn/src/lib/app-utils/{screen-slug,
 * template-slug,resolve-named-tokens}.ts. The cases in
 * function-cases.generated.json are the TypeScript's own answers, and the
 * tests replay every one.
 */

const val SCREEN_ROOT_PATH = "/"

/** Root path `/`; anything else one lower-case url-safe segment, or null for nothing (empty, or `###`). */
fun normalizeScreenSlug(input: String?): String? {
  val trimmed = (input ?: "").trim()
  if (trimmed.isEmpty()) return null
  if (trimmed == SCREEN_ROOT_PATH) return SCREEN_ROOT_PATH
  val segment = trimmed
    .lowercase()
    .replace(Regex("^/+|/+$"), "")
    .replace(Regex("\\s+"), "-")
    .replace(Regex("[^a-z0-9\\-_]"), "")
    .replace(Regex("-{2,}"), "-")
    .replace(Regex("^-+|-+$"), "")
  return segment.ifEmpty { null }
}

/** The reserved segment a routing-map path would collide with (`search`, `api`, `404`…), or null when it is servable. */
fun reservedScreenRouteSegment(path: String?): String? {
  if (path.isNullOrEmpty() || path == SCREEN_ROOT_PATH) return null
  val first = path.replace(Regex("^/+"), "").split('/').first()
  return first.takeIf { it in Contracts.reservedScreenRouteSegments }
}

/** What an author reads when a slug names a reserved segment. */
fun reservedScreenRouteMessage(segment: String): String = "\"/$segment\" is a reserved address on every Aglyn site — pick another slug"

/** A raw slug holding an interior `/`: a slug is one path segment (leading and trailing slashes are not separators). */
fun screenSlugHasPathSeparator(input: String?): Boolean {
  val trimmed = (input ?: "").trim()
  if (trimmed.isEmpty() || trimmed == SCREEN_ROOT_PATH) return false
  return trimmed.replace(Regex("^/+|/+$"), "").contains('/')
}

/** Why one template page cannot get the address it asks for, or null when it can. */
fun templateScreenAddressRefusal(slug: String?, displayName: String?): String? {
  if (screenSlugHasPathSeparator(slug)) return Contracts.screenSlugPathSeparatorMessage
  val requested = normalizeScreenSlug(slug) ?: normalizeScreenSlug(displayName) ?: "page"
  return reservedScreenRouteSegment(requested)?.let(::reservedScreenRouteMessage)
}

/** The address a page claims and the one it asked for. */
data class TemplateSlug(val slug: String, val requestedSlug: String)

/**
 * The address a template page claims. A collision falls back (the home page
 * to its name, then numeric suffixes); it never overwrites. Adds what it
 * hands out to [taken].
 */
fun resolveTemplateSlug(slug: String?, displayName: String, taken: MutableSet<String>): TemplateSlug {
  val named = normalizeScreenSlug(displayName) ?: "page"
  val requested = normalizeScreenSlug(slug) ?: named
  val base = if (requested == SCREEN_ROOT_PATH && SCREEN_ROOT_PATH in taken) named else requested
  var claimed = base
  var attempt = 2
  while (claimed in taken) claimed = "$base-${attempt++}"
  taken.add(claimed)
  return TemplateSlug(claimed, requested)
}

/**
 * Gives a multi-page bundle a home page when nothing in it claims one and the
 * site has none: the first page takes the root. [slugOf] reads a page's slug;
 * [withSlug] returns it with the slug set.
 */
fun <T> withBundleRootScreen(screens: List<T>, taken: Collection<String>, slugOf: (T) -> String?, withSlug: (T, String) -> T): List<T> {
  if (screens.isEmpty() || SCREEN_ROOT_PATH in taken) return screens
  if (screens.any { normalizeScreenSlug(slugOf(it)) == SCREEN_ROOT_PATH }) return screens
  return listOf(withSlug(screens.first(), SCREEN_ROOT_PATH)) + screens.drop(1)
}

/**
 * A template's `{{name}}` placeholders filled in across every node's props
 * (nested maps and lists too); a name with no value is blanked. No values,
 * no change.
 */
@Suppress("UNCHECKED_CAST")
fun resolveNamedTokens(nodes: Map<String, Any?>, tokens: Map<String, String>?): Map<String, Any?> {
  if (tokens.isNullOrEmpty()) return nodes
  val pattern = Regex("\\{\\{\\s*(" + tokens.keys.joinToString("|") { Regex.escape(it) } + ")\\s*\\}\\}")
  fun substitute(value: Any?): Any? = when (value) {
    is String -> pattern.replace(value) { match -> tokens[match.groupValues[1]] ?: "" }
    is List<*> -> value.map(::substitute)
    is Map<*, *> -> value.entries.associate { it.key.toString() to substitute(it.value) }
    else -> value
  }
  return nodes.mapValues { (_, node) ->
    val map = node as? Map<String, Any?>
    if (map != null && map["props"] != null && map["props"] != false) map + ("props" to substitute(map["props"])) else node
  }
}

private val PLACEHOLDER = Regex("\\{\\{\\s*([a-zA-Z][A-Za-z0-9_.\\-]*)\\s*\\}\\}")

/**
 * The bare `{{name}}` tokens in a captured tree, sorted: what a saved template
 * asks for when it is used. A `{{var:…}}`/`{{fn:…}}` binding resolves against
 * the site and a `{{prop.*}}` token binds to a property the template carries,
 * so neither is a placeholder.
 */
fun detectTemplatePlaceholders(nodes: Map<String, Any?>): List<String> {
  val found = sortedSetOf<String>()
  fun walk(value: Any?) {
    when (value) {
      is String -> PLACEHOLDER.findAll(value).forEach { match ->
        val name = match.groupValues[1]
        if (name.isNotEmpty() && ':' !in name && !name.startsWith(Contracts.componentPropTokenPrefix)) found.add(name)
      }
      is List<*> -> value.forEach(::walk)
      is Map<*, *> -> value.values.forEach(::walk)
    }
  }
  walk(nodes)
  return found.toList()
}
