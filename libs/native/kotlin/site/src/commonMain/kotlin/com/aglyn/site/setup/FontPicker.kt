// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.site.setup

import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.jsonValue
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

/*
 * The fonts plugin's picker (the console's `FontPicker`, `FontBrowserDialog`, `FontDetail`, AGL-3656): the site's body font
 * and heading font, the whole Google Fonts catalog to choose from, a family's weights and italics, suggested pairings and what
 * the fonts cost to download. Ports of `font-choice.ts`, `font-pairings.ts` and `expandCatalogRow`, replayed from the
 * console's own cases; the catalog comes from the fonts plugin's `fonts/catalog` route and a choice is saved through the
 * theme editor's `fonts` edit. The Swift kit's FontPicker.swift holds the same.
 */

/** Which role a picker choice is for (the console's `FontRole`). */
enum class FontPickerRole(val key: String, val label: String) { BODY("body", "Body text"), HEADING("heading", "Headings") }

/** One family of the Google Fonts catalog (`GoogleFontFamily`). */
data class GoogleFontFamily(
  val family: String,
  val category: String,
  val weights: List<Int>,
  val italics: List<Int> = emptyList(),
  val axes: List<Axis> = emptyList(),
  val subsets: List<String> = listOf("latin"),
  val popularity: Int = 0,
) {
  data class Axis(val tag: String, val min: Double, val max: Double)
}

private val AXIS = Regex("""^([A-Za-z]{4}):(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$""")

private fun ints(json: JsonElement?, key: String): List<Int> = json.arr(key).mapNotNull { (it as? JsonPrimitive)?.doubleOrNull?.toInt() }

/** `expandCatalogRow`: one compact catalog row (`f`, `c`, `w`, `i`, `a`, `s`, `p`) as a family; null without a name. */
fun expandCatalogRow(row: JsonElement?): GoogleFontFamily? {
  val family = row.str("f") ?: return null
  val axes = row.str("a").orEmpty().split(',').mapNotNull { entry ->
    AXIS.find(entry)?.groupValues?.let { GoogleFontFamily.Axis(it[1], it[2].toDouble(), it[3].toDouble()) }
  }
  return GoogleFontFamily(
    family = family,
    category = row.str("c") ?: "sans-serif",
    weights = ints(row, "w"),
    italics = ints(row, "i"),
    axes = axes,
    subsets = row.arr("s").mapNotNull { (it as? JsonPrimitive)?.contentOrNull },
    popularity = row.num("p")?.toInt() ?: 0,
  )
}

/** The catalog route's answer, most used first. */
fun googleFontsCatalogOf(json: JsonElement?): List<GoogleFontFamily> = json.arr("families").mapNotNull(::expandCatalogRow)

/** A font for one role (`ThemeFontChoice`): a Google family or the site's own, its upright weights and its italics. */
data class ThemeFontChoice(
  val family: String,
  val category: String,
  val weights: List<Int>,
  val italics: List<Int> = emptyList(),
  /** `google` or `custom`. */
  val source: String = "google",
) {
  fun body(): Map<String, Any?> = buildMap {
    put("family", family)
    put("category", category)
    put("weights", weights)
    put("source", source)
    if (italics.isNotEmpty()) put("italics", italics)
  }

  companion object {
    fun of(json: JsonElement?): ThemeFontChoice? {
      val family = (json as? JsonObject)?.let { it.str("family") } ?: return null
      return ThemeFontChoice(
        family = family,
        category = json.str("category") ?: "sans-serif",
        weights = ints(json, "weights").ifEmpty { listOf(400) },
        italics = ints(json, "italics"),
        source = if (json.str("source") == "custom") "custom" else "google",
      )
    }
  }
}

/** The body font and the heading font (`ThemeFontSelection`); null is the theme default, or "same as body text". */
data class ThemeFontSelection(val body: ThemeFontChoice? = null, val heading: ThemeFontChoice? = null) {
  /** The theme editor's `fonts` edit value, and the cost route's `fonts`. */
  fun value(): Map<String, Any?> = mapOf("body" to body?.body(), "heading" to heading?.body())

  companion object {
    fun of(json: JsonElement?): ThemeFontSelection = ThemeFontSelection(ThemeFontChoice.of(json.obj("body")), ThemeFontChoice.of(json.obj("heading")))
  }
}

/** The categories the browser filters by, in the console's order and words (`FONT_CATEGORY_LABELS`). */
val FONT_CATEGORY_LABELS: List<Pair<String, String>> = listOf(
  "sans-serif" to "Sans serif",
  "serif" to "Serif",
  "display" to "Display",
  "handwriting" to "Handwriting",
  "monospace" to "Monospace",
)

/** `categoryLabel`. */
fun fontCategoryLabel(category: String): String = FONT_CATEGORY_LABELS.firstOrNull { it.first == category }?.second ?: category

private val WEIGHT_NAMES = mapOf(
  100 to "Thin", 200 to "Extra light", 300 to "Light", 400 to "Regular", 500 to "Medium", 600 to "Semibold",
  700 to "Bold", 800 to "Extra bold", 900 to "Black", 1000 to "Extra black",
)

/** `weightLabel`: `Bold 700`, or the bare number for a weight with no name. */
fun fontWeightLabel(weight: Int): String = WEIGHT_NAMES[weight]?.let { "$it $weight" } ?: weight.toString()

/** `nearestWeights`: each wanted weight as the nearest one offered, without repeats, ascending. */
fun nearestWeights(wanted: List<Int>, offered: List<Int>): List<Int> {
  if (offered.isEmpty()) return wanted
  return wanted.map { weight -> offered.reduce { best, candidate -> if (abs(candidate - weight) < abs(best - weight)) candidate else best } }
    .toSortedSet().toList()
}

/** `defaultFontChoice`: body text in its regular and bold with a true italic, headings in its bold. */
fun defaultFontChoice(family: GoogleFontFamily, role: FontPickerRole): ThemeFontChoice {
  val weights = nearestWeights(if (role == FontPickerRole.BODY) listOf(400, 700) else listOf(700), family.weights)
  val italics = if (role == FontPickerRole.BODY && family.italics.isNotEmpty()) nearestWeights(listOf(400), family.italics) else emptyList()
  return ThemeFontChoice(family.family, family.category, weights, italics)
}

/** `choiceStylesLabel`: `Regular 400, Bold 700 + italic`. */
fun fontChoiceStylesLabel(choice: ThemeFontChoice): String {
  val weights = choice.weights.joinToString(", ") { fontWeightLabel(it) }
  return if (choice.italics.isNotEmpty()) "$weights + italic" else weights
}

/** `searchFontFamilies`: families matching a search, most used first, names that start with it before the rest. */
fun searchFontFamilies(catalog: List<GoogleFontFamily>, query: String, category: String): List<GoogleFontFamily> {
  val words = query.trim().lowercase()
  val inCategory = if (category.isEmpty()) catalog else catalog.filter { it.category == category }
  if (words.isEmpty()) return inCategory
  val starts = inCategory.filter { it.family.lowercase().startsWith(words) }
  val contains = inCategory.filter { !it.family.lowercase().startsWith(words) && it.family.lowercase().contains(words) }
  return starts + contains
}

/** Pairs designers keep coming back to (`CURATED_FONT_PAIRS`): heading to body. */
val CURATED_FONT_PAIRS: List<Pair<String, String>> = listOf(
  "Playfair Display" to "Source Sans 3", "Playfair Display" to "Lato", "Montserrat" to "Merriweather", "Oswald" to "Open Sans",
  "Raleway" to "Lora", "Merriweather" to "Open Sans", "Roboto Slab" to "Roboto", "Libre Baskerville" to "Source Sans 3",
  "Bebas Neue" to "Montserrat", "DM Serif Display" to "DM Sans", "Fraunces" to "Inter", "Space Grotesk" to "Inter",
  "Archivo Black" to "Roboto", "Abril Fatface" to "Lato", "Cormorant Garamond" to "Proza Libre", "Josefin Sans" to "Merriweather",
  "Poppins" to "Lora", "Work Sans" to "Bitter", "EB Garamond" to "Lato", "Pacifico" to "Open Sans", "Cinzel" to "Fira Sans",
  "Syne" to "Manrope", "IBM Plex Serif" to "IBM Plex Sans", "Zilla Slab" to "Karla",
)

/** One suggested pairing and why. */
data class FontPairing(val family: GoogleFontFamily, val reason: String)

private fun contrasting(category: String, role: FontPickerRole): List<String> = if (role == FontPickerRole.HEADING) {
  when (category) {
    "serif" -> listOf("sans-serif", "display")
    "monospace" -> listOf("sans-serif", "serif")
    else -> listOf("serif", "display")
  }
} else {
  when (category) {
    "serif" -> listOf("sans-serif")
    "sans-serif" -> listOf("serif", "sans-serif")
    else -> listOf("sans-serif", "serif")
  }
}

private fun fitsRole(family: GoogleFontFamily, role: FontPickerRole): Boolean {
  if ("latin" !in family.subsets) return false
  if (role == FontPickerRole.BODY) {
    return (family.category == "sans-serif" || family.category == "serif") && 400 in family.weights && family.weights.any { it >= 600 }
  }
  return family.weights.any { it >= 600 } || family.category == "display" || family.weights.size == 1
}

/**
 * `suggestFontPairings`: for a family in one role, families for the OTHER role — the classic pairs first, then two of each
 * contrasting category, most used first.
 */
fun suggestFontPairings(family: GoogleFontFamily, role: FontPickerRole, catalog: List<GoogleFontFamily>, limit: Int = 4): List<FontPairing> {
  val byName = LinkedHashMap<String, GoogleFontFamily>()
  for (entry in catalog) byName.putIfAbsent(entry.family.lowercase(), entry)
  val name = family.family.lowercase()
  val picked = mutableListOf<FontPairing>()
  val seen = mutableSetOf(name)
  fun add(entry: GoogleFontFamily?, reason: String) {
    if (entry == null || entry.family.lowercase() in seen || picked.size >= limit) return
    seen += entry.family.lowercase()
    picked += FontPairing(entry, reason)
  }
  for ((heading, body) in CURATED_FONT_PAIRS) {
    if (role == FontPickerRole.HEADING && body.lowercase() == name) add(byName[heading.lowercase()], "A classic pairing")
    if (role == FontPickerRole.BODY && heading.lowercase() == name) add(byName[body.lowercase()], "A classic pairing")
  }
  for (category in contrasting(family.category, role)) {
    val reason = if (role == FontPickerRole.HEADING) "${capital(category)} headings over ${family.category} text" else "${capital(category)} text under ${family.category} headings"
    var taken = 0
    for (entry in catalog) {
      if (taken >= 2 || picked.size >= limit) break
      if (entry.category != category || !fitsRole(entry, role) || entry.family.lowercase() in seen) continue
      add(entry, reason)
      taken += 1
    }
  }
  return picked
}

private fun capital(text: String) = text.replaceFirstChar { it.uppercase() }

/** One family's share of a cost (`FontFamilyCost`). */
data class FontFamilyCost(val family: String, val bytes: Long, val files: Int, val complete: Boolean)

/** What the site's fonts cost a visitor to download, as the console's badge reads the `fonts/cost` route. */
data class FontCost(val bytes: Long, val files: Int, val complete: Boolean, val families: List<FontFamilyCost> = emptyList()) {
  /** One family's share, by name (`familyCost`). */
  fun share(family: String): FontFamilyCost? {
    val wanted = family.trim().lowercase()
    return families.firstOrNull { it.family.trim().lowercase() == wanted }
  }

  companion object {
    /** What a theme with no web font costs: nothing, and nothing to ask (`NO_FONT_COST`). */
    val NONE = FontCost(0, 0, true)

    private fun JsonElement?.flag(key: String) = ((this as? JsonObject)?.get(key) as? JsonPrimitive)?.booleanOrNull != false

    /** The route's answer. */
    fun of(json: JsonElement?) = FontCost(
      bytes = json.num("bytes")?.toLong() ?: 0,
      files = json.num("files")?.toInt() ?: 0,
      complete = json.flag("complete"),
      families = json.arr("families").mapNotNull { row ->
        val family = row.str("family") ?: return@mapNotNull null
        FontFamilyCost(family, row.num("bytes")?.toLong() ?: 0, row.arr("files").size, row.flag("complete"))
      },
    )
  }
}

/** `formatDownloadSize`: `0 KB`, `38 KB`, `1.2 MB` (kilobytes of 1,024 bytes). */
fun formatDownloadSize(bytes: Long): String {
  if (bytes <= 0) return "0 KB"
  if (bytes >= 1024L * 1024) {
    val tenths = (bytes / (1024.0 * 1024) * 10).roundToInt()
    return "${tenths / 10}.${tenths % 10} MB"
  }
  return "${max(1, (bytes / 1024.0).roundToInt())} KB"
}

/** `downloadCostLabel`: `38 KB · 2 files`, `≈` when part of it could not be measured. */
fun fontCostLabel(cost: FontCost): String {
  val size = (if (cost.complete) "" else "≈ ") + formatDownloadSize(cost.bytes)
  return if (cost.files == 0) size else "$size · ${cost.files} ${if (cost.files == 1) "file" else "files"}"
}

/** The fonts plugin's routes the picker reads. */
class FontPickerApi(private val api: ConsoleApiClient, val hostId: String) {
  /** The whole catalog, most used first. */
  suspend fun catalog(): List<GoogleFontFamily> = googleFontsCatalogOf(api.request("/api/fonts/catalog", ApiMethod.GET))

  /** What the site's fonts would cost a visitor with [selection] written into its theme (`/api/fonts/cost`). */
  suspend fun cost(selection: ThemeFontSelection): FontCost {
    val answer = api.request("/api/fonts/cost", ApiMethod.POST, jsonValue(mapOf("hostId" to hostId, "fonts" to selection.value())))
    if (answer.num("bytes") == null) throw ConsoleApiError("The size could not be measured.", 0, answer)
    return FontCost.of(answer)
  }
}

/** The words a font preview is drawn in (`SiteSample`): the site's own, where it has them. */
data class SiteSample(val title: String, val heading: String, val paragraph: String) {
  companion object {
    val FALLBACK = SiteSample(
      title = "Your site",
      heading = "A headline that sets the tone",
      paragraph = "Running text reads like this, sentence after sentence, on every page of your site.",
    )
  }
}

private val SAMPLE_SPACE = Regex("\\s+")
private val SAMPLE_LAST_WORD = Regex("\\s+\\S*$")

/** Trims a site's text to a preview's length, on a word (in UTF-16 units, as the console's slice counts them). */
private fun clipSample(text: String, max: Int): String {
  val clean = text.replace(SAMPLE_SPACE, " ").trim()
  if (clean.length <= max) return clean
  return clean.substring(0, max).replace(SAMPLE_LAST_WORD, "") + "…"
}

/** `siteSampleFrom`: the sample for a site document as it was read. */
fun siteSampleFrom(host: JsonElement?): SiteSample {
  val name = listOf(host.str("displayName"), host.str("name")).firstOrNull { !it.isNullOrBlank() }?.let { clipSample(it, 48) }.orEmpty()
  val seo = host.obj("seo")
  val title = seo.str("title")?.takeIf { it.isNotBlank() }?.let { clipSample(it, 70) }.orEmpty()
  val description = seo.str("description")?.takeIf { it.isNotBlank() }?.let { clipSample(it, 160) }.orEmpty()
  return SiteSample(
    title = name.ifEmpty { title.ifEmpty { SiteSample.FALLBACK.title } },
    heading = if (title.isNotEmpty() && title != name) title else if (name.isNotEmpty()) "Welcome to $name" else SiteSample.FALLBACK.heading,
    paragraph = description.ifEmpty { SiteSample.FALLBACK.paragraph },
  )
}
