package com.aglyn.core.listquery

/*
 * The console's name-search normalizers (libs/aglyn app-utils/name-search.ts):
 * how a name is keyed, tokenized and reversed when it is stored, so a query
 * asks for exactly what a document holds.
 */

/** How many leading letters of a word are indexed. */
const val NAME_TOKEN_MAX_PREFIX = 12

/** The most tokens one name stores. */
const val NAME_TOKEN_LIMIT = 120

private val WHITESPACE = Regex("\\s+")

/** Trimmed, single-spaced, lower case. */
fun nameSearchKey(name: String?): String = (name ?: "").trim().replace(WHITESPACE, " ").lowercase()

/** Every prefix of every word, up to [NAME_TOKEN_MAX_PREFIX] letters, at most [NAME_TOKEN_LIMIT]. */
fun nameSearchTokens(name: String?): List<String> {
  val key = nameSearchKey(name)
  if (key.isEmpty()) return emptyList()
  val tokens = LinkedHashSet<String>()
  for (word in key.split(' ')) {
    if (word.isEmpty()) continue
    val capped = word.take(NAME_TOKEN_MAX_PREFIX)
    for (end in 1..capped.length) {
      tokens += capped.substring(0, end)
      if (tokens.size >= NAME_TOKEN_LIMIT) return tokens.toList()
    }
  }
  return tokens.toList()
}

/** The token a query asks for: its first word, capped like a stored token. */
fun nameSearchToken(query: String?): String {
  val key = nameSearchKey(query)
  if (key.isEmpty()) return ""
  return key.split(' ').first().take(NAME_TOKEN_MAX_PREFIX)
}

/** The key reversed by code point, for "ends with". */
fun nameSearchReversed(name: String?): String {
  val key = nameSearchKey(name)
  val points = mutableListOf<String>()
  var i = 0
  while (i < key.length) {
    val pair = key[i].isHighSurrogate() && i + 1 < key.length && key[i + 1].isLowSurrogate()
    points += key.substring(i, if (pair) i + 2 else i + 1)
    i += if (pair) 2 else 1
  }
  return points.asReversed().joinToString("")
}

/** How a planner normalizes what a person typed. */
interface ListQueryNormalizers {
  fun key(value: String): String
  fun token(value: String): String
  fun reversed(value: String): String
  val maxPrefix: Int
}

object NameSearchNormalizers : ListQueryNormalizers {
  override fun key(value: String) = nameSearchKey(value)
  override fun token(value: String) = nameSearchToken(value)
  override fun reversed(value: String) = nameSearchReversed(value)
  override val maxPrefix: Int = NAME_TOKEN_MAX_PREFIX
}

/**
 * The name keys a rename writes beside `displayName` (`displayNameSearchFields`):
 * `nameLower`, `nameTokens` and `nameReversed`, so list search and sort find
 * the new name.
 */
fun displayNameSearchFields(displayName: String?): Map<String, Any?> = mapOf(
  "nameLower" to nameSearchKey(displayName),
  "nameTokens" to nameSearchTokens(displayName),
  "nameReversed" to nameSearchReversed(displayName),
)
