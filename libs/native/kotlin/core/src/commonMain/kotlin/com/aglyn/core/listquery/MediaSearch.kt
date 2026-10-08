package com.aglyn.core.listquery

/*
 * The media library's search normalizer (`MEDIA_NAME_NORMALIZERS`,
 * libs/aglyn app-utils/media-filter.ts): a file name's punctuation is a word
 * break, so `hero-banner_2024.jpg` is found by `hero`, `banner` or `2024`.
 */

private val NOT_A_LETTER_OR_DIGIT = Regex("[^\\p{L}\\p{N}]+")

/** A file name's words: every run of letters and digits, space separated (`mediaNameWords`). */
fun mediaNameWords(fileName: String?): String = (fileName ?: "").replace(NOT_A_LETTER_OR_DIGIT, " ").trim()

/** The token a library search asks for (`mediaSearchToken`). */
fun mediaSearchToken(query: String?): String = nameSearchToken(mediaNameWords(query))

/** A file's family from its type, as the Type filter names it (`mediaKindOf`). */
fun mediaKindOf(contentType: String?): String {
  val type = (contentType ?: "").trim().lowercase()
  return when {
    type.startsWith("image/") -> "image"
    type.startsWith("video/") -> "video"
    type == "application/pdf" -> "pdf"
    else -> "document"
  }
}

object MediaNameNormalizers : ListQueryNormalizers {
  override fun key(value: String) = nameSearchKey(value)
  override fun token(value: String) = mediaSearchToken(value)
  override fun reversed(value: String) = nameSearchReversed(value)
  override val maxPrefix: Int = NAME_TOKEN_MAX_PREFIX
}
