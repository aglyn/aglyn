package com.aglyn.site.pages

/*
 * A page's own SEO, as the console's page view SEO card reads and saves it
 * (AGL-117, AGL-1337, AGL-2417, AGL-3197): the search title (which may name
 * variables), the description, the breadcrumb label, and the social image with
 * its size and description, all in the screen's `seo` map. The Apple kit's
 * PageSeo.swift.
 */

/** The card's limits (`SEO_LISTING_FIELDS`): what a search result shows before it truncates. */
object PageSeoLimits {
  const val TITLE = 60
  const val DESCRIPTION = 155
  const val BREADCRUMB = 40
  const val IMAGE_ALT = 300
}

/** The variables a page title may name (`SEO_TITLE_VARIABLES`), in the console's menu order. */
val PAGE_SEO_TITLE_VARIABLES: List<Pair<String, String>> = listOf("page.name" to "Page name", "site.separator" to "Separator", "site.name" to "Site name")

/** The separator when the site sets none (`DEFAULT_TITLE_SEPARATOR`). */
const val DEFAULT_SEO_TITLE_SEPARATOR = "–"

/** Whether a written title names a variable (`hasSeoTitleVariables`). */
fun hasSeoTitleVariables(value: String): Boolean = value.contains("{{")

private val SEO_TITLE_TOKEN = Regex("""\{\{\s*([a-zA-Z][\w.]*)\s*\}\}""")

/**
 * The title as the live page renders it (`resolveSeoTitleVariables`): each known variable filled in, an unknown one left
 * as written, a separator kept only where something renders on each side of it, runs of spaces collapsed.
 */
fun resolveSeoTitleVariables(written: String, pageName: String, siteName: String, separator: String): String {
  if (!hasSeoTitleVariables(written)) return written
  val known = PAGE_SEO_TITLE_VARIABLES.map { it.first }.toSet()
  val parts = mutableListOf<Pair<String, String?>>()
  var at = 0
  for (match in SEO_TITLE_TOKEN.findAll(written)) {
    if (match.range.first > at) parts += written.substring(at, match.range.first) to null
    val name = match.groupValues[1]
    val text = when {
      name !in known -> match.value
      name == "site.separator" -> separator.trim().ifEmpty { DEFAULT_SEO_TITLE_SEPARATOR }
      name == "page.name" -> pageName.trim()
      else -> siteName.trim()
    }
    parts += text to name
    at = match.range.last + 1
  }
  if (at < written.length) parts += written.substring(at) to null
  val rendered = parts.map { it.first }.toMutableList()
  fun live(from: Int, to: Int) = rendered.subList(from, to).any { it.isNotBlank() }
  parts.forEachIndexed { index, part ->
    if (part.second == "site.separator" && (!live(0, index) || !live(index + 1, rendered.size))) rendered[index] = ""
  }
  return rendered.joinToString("").replace(Regex("""\s{2,}"""), " ").trim()
}

/** A staged social image (`ScreenSocialImageDraft`); an empty [image] clears it. */
data class PageSocialImage(val image: String, val width: Long, val height: Long, val alt: String)

/** What the card reads from the screen's `seo` map. */
data class PageSeo(val title: String, val description: String, val breadcrumb: String, val image: PageSocialImage?) {
  companion object {
    fun from(seo: Map<*, *>?): PageSeo = PageSeo(
      title = seo?.get("title") as? String ?: "",
      description = seo?.get("description") as? String ?: "",
      breadcrumb = seo?.get("breadcrumb") as? String ?: "",
      image = (seo?.get("image") as? String)?.takeIf { it.isNotEmpty() }?.let {
        PageSocialImage(it, (seo["imageWidth"] as? Number)?.toLong() ?: 0, (seo["imageHeight"] as? Number)?.toLong() ?: 0, seo["imageAlt"] as? String ?: "")
      },
    )
  }
}

/**
 * The `seo` map a save writes (`buildScreenSeoUpdate`): everything the card does not edit carried forward; a typed field
 * trimmed, and removed when blank; the image group moving as one, its blank description removed; null when nothing is
 * left, so the save deletes the map.
 */
fun buildScreenSeoUpdate(existing: Map<*, *>?, title: String?, description: String?, breadcrumb: String?, image: PageSocialImage?): Map<String, Any?>? {
  val seo = existing.orEmpty().entries.associate { it.key.toString() to it.value }.toMutableMap()
  for ((key, staged) in listOf("title" to title, "description" to description, "breadcrumb" to breadcrumb)) {
    val value = staged?.trim() ?: continue
    if (value.isEmpty()) seo.remove(key) else seo[key] = value
  }
  if (image != null) {
    if (image.image.isEmpty()) {
      listOf("image", "imageWidth", "imageHeight", "imageAlt").forEach { seo.remove(it) }
    } else {
      seo["image"] = image.image
      seo["imageWidth"] = image.width
      seo["imageHeight"] = image.height
      val alt = image.alt.trim()
      if (alt.isEmpty()) seo.remove("imageAlt") else seo["imageAlt"] = alt
    }
  }
  return seo.ifEmpty { null }
}

/** The description a picked file brings (`inheritedMediaAlt`): the file's own alt, only while the card has none. */
fun inheritedSocialImageAlt(current: String, assetAlt: String): String =
  if (current.isNotBlank()) current else assetAlt.trim().ifEmpty { null }?.take(PageSeoLimits.IMAGE_ALT) ?: current
