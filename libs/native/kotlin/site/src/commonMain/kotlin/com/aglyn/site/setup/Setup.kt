package com.aglyn.site.setup

import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FirestoreDelete
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.FirestoreWriter
import com.aglyn.core.firestoreNow
import com.aglyn.core.jsonValue
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull

/*
 * A site's setup as the console's Setup pages read and save it
 * (`hosts/[host]/setup/(sections)`): every field is a key of the host
 * document, saved as the console's settings forms save it — a merge of the
 * nested fields, a blank clearable field deleted, the date stamped — and then
 * announced to the live site (`/api/screens/revalidate`, `entireHost`), as
 * `writeSiteWideChange` does. The theme goes through `/api/hosts/theme`.
 */

/** The setup sections, in the console's order (`setup-sections.ts`). */
enum class SetupSection(val id: String, val title: String, val supporting: String, val icon: String) {
  DETAILS("details", "Basic details", "Logo, business details, layout and languages", "info"),
  SEO("seo", "SEO", "Search title, social image, business profile and verification", "travel_explore"),
  TRACKING("tracking", "Tracking", "Analytics, ad tags and the consent banner", "analytics"),
  THEME("theme", "Theme", "Colors, font, shape and your saved themes", "palette"),
  EMAILS("emails", "Emails", "The emails your site sends to customers", "mail"),
  ;

  companion object {
    /** A section by its id or by an old `?tab=` value (`SETUP_TAB_SECTIONS`); details otherwise. */
    fun of(value: String?): SetupSection = when (value) {
      "hostSeo" -> SEO
      "hostTracking" -> TRACKING
      "hostDetails", "activity" -> DETAILS
      else -> entries.firstOrNull { it.id == value } ?: DETAILS
    }
  }
}

/** The value at a dotted [path] of a document's fields. */
fun Map<String, Any?>?.at(path: String): Any? {
  var current: Any? = this
  for (key in path.split('.')) current = (current as? Map<*, *>)?.get(key) ?: return null
  return current
}

fun Map<String, Any?>?.text(path: String): String = (at(path) as? String).orEmpty()

/**
 * A nested map from dotted paths, as a settings form submits its values:
 * `seo.title` becomes `{seo: {title}}`. A blank value at a [clearable] path
 * the document still holds becomes a delete (the form's way back to the
 * default); any other blank is written as the empty text the form holds.
 */
fun settingsPayload(values: Map<String, Any?>, stored: Map<String, Any?>?, clearable: Set<String> = emptySet()): Map<String, Any?> {
  val root = mutableMapOf<String, Any?>()
  for ((path, raw) in values) {
    val value = (raw as? String)?.trim() ?: raw
    val blank = value == null || (value is String && value.isEmpty())
    val stored0 = stored.at(path)
    val written: Any? = when {
      path in clearable && blank -> if (stored0 != null && stored0.toString().isNotEmpty()) FirestoreDelete else continue
      else -> value
    }
    val keys = path.split('.')
    var node = root
    for (key in keys.dropLast(1)) {
      @Suppress("UNCHECKED_CAST")
      node = node.getOrPut(key) { mutableMapOf<String, Any?>() } as MutableMap<String, Any?>
    }
    node[keys.last()] = written
  }
  return root
}

/** The analytics ids' shapes, as `visitor-consent.ts` checks them before the tenant writes them into a page. */
object TrackingPatterns {
  val GA_MEASUREMENT_ID = Regex("^G-[A-Z0-9]{4,16}$")
  val GTM_CONTAINER_ID = Regex("^GTM-[A-Z0-9]{5,10}$")
  val META_PIXEL_ID = Regex("^[0-9]{8,20}$")
  val GOOGLE_ADS_ID = Regex("^AW-[0-9]{6,16}$")
  val LINKEDIN_PARTNER_ID = Regex("^[0-9]{4,10}$")
}

/** One tracking field: its path, label, shape and an example. */
data class TrackingField(val path: String, val label: String, val pattern: Regex, val example: String)

/** The Tracking form (`hostTracking`), every field clearable. */
val TRACKING_FIELDS = listOf(
  TrackingField("analytics.gaMeasurementId", "Google Analytics measurement ID", TrackingPatterns.GA_MEASUREMENT_ID, "G-XXXXXXXXXX"),
  TrackingField("analytics.gtmContainerId", "Google Tag Manager container ID", TrackingPatterns.GTM_CONTAINER_ID, "GTM-XXXXXXX"),
  TrackingField("analytics.adTags.meta", "Meta pixel ID", TrackingPatterns.META_PIXEL_ID, "123456789012345"),
  TrackingField("analytics.adTags.google-ads", "Google Ads conversion ID", TrackingPatterns.GOOGLE_ADS_ID, "AW-123456789"),
  TrackingField("analytics.adTags.linkedin", "LinkedIn partner ID", TrackingPatterns.LINKEDIN_PARTNER_ID, "1234567"),
)

/** The tracking error for [value], or null when it is blank or fits. */
fun trackingError(field: TrackingField, value: String): String? =
  if (value.isBlank() || field.pattern.matches(value.trim())) null else "Use the ID as ${field.label.substringBefore(" ID")} shows it, like ${field.example}"

/** The consent modes (`resolveHostConsentMode`): `geo` asks only where the law needs it, `strict` asks everyone. */
fun consentMode(host: Map<String, Any?>?): String = if (host.at("consent.mode") == "strict") "strict" else "geo"

/** A verification token (`SEARCH_ENGINE_VERIFICATION_TOKEN_PATTERN`). */
val VERIFICATION_TOKEN = Regex("^[A-Za-z0-9_-]{1,128}$")

private fun attribute(tag: String, name: String): String? {
  val match = Regex("\\b$name\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'>/]+))", RegexOption.IGNORE_CASE).find(tag) ?: return null
  return (match.groups[1]?.value ?: match.groups[2]?.value ?: match.groups[3]?.value ?: "").trim()
}

/** What a paste into a verification field reads as: the tag's `content` and `name`, or the trimmed paste. */
fun parseVerificationInput(input: String?): Pair<String, String?> {
  val trimmed = input?.trim() ?: return "" to null
  if (!trimmed.contains('<') && !Regex("\\bcontent\\s*=", RegexOption.IGNORE_CASE).containsMatchIn(trimmed)) return trimmed to null
  return (attribute(trimmed, "content") ?: "") to attribute(trimmed, "name")?.lowercase()
}

/** The token a paste stores as (`extractSearchEngineVerificationToken`). */
fun extractVerificationToken(input: String?): String = parseVerificationInput(input).first

/** Whether the tenant will emit [value] (`isSearchEngineVerificationToken`). */
fun isVerificationToken(value: String?): Boolean = value != null && VERIFICATION_TOKEN.matches(value)

/** The field error for a paste into [engine]'s field (`searchEngineVerificationError`). */
fun verificationError(engine: String, input: String?, metaNames: Map<String, String>, labels: Map<String, String>): String? {
  if (input.isNullOrBlank()) return null
  val (token, metaName) = parseVerificationInput(input)
  if (metaName != null && metaName != metaNames[engine]) {
    val other = listOf("google", "bing").firstOrNull { metaNames[it] == metaName }
    return if (other != null) "That tag is for ${labels[other]} — paste it in that field instead" else "That tag isn’t a ${labels[engine]} verification tag"
  }
  if (!isVerificationToken(token)) return "Paste the verification code, or the whole meta tag — the code is letters, numbers, - and _ only"
  return null
}

/** A language tag the Languages card accepts (`en`, `pt-BR`). */
val LOCALE_PATTERN = Regex("^[a-z]{2}(-[A-Za-z]{2,4})?$")

/** The Languages card's list: comma separated, each a tag, repeats dropped; null names the first bad one. */
fun parseLocales(text: String): Pair<List<String>, String?> {
  val out = mutableListOf<String>()
  for (raw in text.split(',')) {
    val tag = raw.trim()
    if (tag.isEmpty()) continue
    if (!LOCALE_PATTERN.matches(tag)) return out to "\"$tag\" is not a language code like en or pt-BR"
    if (tag !in out) out += tag
  }
  return out to null
}

/** One social link of the business details. */
data class SocialLink(val label: String, val url: String)

/** The business details card's list limit (`MAX_LINKS`). */
const val SOCIAL_LINKS_MAX = 8

fun socialLinksOf(host: Map<String, Any?>?): List<SocialLink> = (host.at("business.socialLinks") as? List<*>)?.mapNotNull { row ->
  val map = row as? Map<*, *> ?: return@mapNotNull null
  SocialLink((map["label"] as? String).orEmpty(), (map["url"] as? String).orEmpty())
}.orEmpty()

/** The SEO form's limits (`hostSeo`, `hostSeoEntity`, `hostSeoAgent`). */
object SeoLimits {
  const val TITLE = 60
  const val DESCRIPTION = 155
  const val SEPARATOR = 3
  const val TITLE_PATTERN = 120
  const val ENTITY_DESCRIPTION = 300
  const val IMAGE_ALT = 300
  const val AGENT = 1000
}

/** The business entity's kinds (`HostEntityType`, stored as the enum's number in text). */
val ENTITY_TYPES = listOf("1" to "Organization", "2" to "Person")

/** One of the site's saved themes (`hosts/{hostId}/themes`). */
data class SavedTheme(val id: String, val name: String, val updatedAt: FirestoreTimestamp?)

fun savedThemeOf(doc: FirestoreDoc) = SavedTheme(doc.id, doc.string("name")?.ifBlank { null } ?: "Untitled theme", doc.data["updatedAt"] as? FirestoreTimestamp)

/** Which theme the site picked (`themeSelection`): its kind (default, preset, custom, installed), id and name. */
data class ThemeSelection(val kind: String, val id: String?, val name: String?)

fun themeSelectionOf(host: Map<String, Any?>?): ThemeSelection {
  val raw = host?.get("themeSelection") as? Map<*, *>
  val kind = raw?.get("kind") as? String
  return when {
    kind != null -> ThemeSelection(kind, raw["id"] as? String, raw["name"] as? String)
    (host.at("themeInstalledFrom.listingId") as? String) != null -> ThemeSelection("installed", null, null)
    (host?.get("theme") as? Map<*, *>)?.isNotEmpty() == true -> ThemeSelection("custom", null, null)
    else -> ThemeSelection("default", null, null)
  }
}

/** Whether the site's override has edits on top of its picked theme. */
fun hasThemeEdits(host: Map<String, Any?>?): Boolean = ((host?.get("themeOverride") as? Map<*, *>)?.get("patch") as? Map<*, *>)?.isNotEmpty() == true

/** The theme library's limits (`THEME_LIBRARY_MAX_CUSTOM`, `THEME_NAME_MAX`). */
const val THEME_LIBRARY_MAX_CUSTOM = 25
const val THEME_NAME_MAX = 60

/** One theme color control. */
data class ThemeColorControl(val token: String, val label: String, val group: String)

/** One font of the theme's list. */
data class ThemeFontOption(val family: String, val category: String)

/** A number control's label and range. */
data class ThemeRange(val label: String, val min: Int, val max: Int)

/** The editor's controls as the theme route hands them out (`THEME_EDITOR_CATALOG`). */
data class ThemeCatalog(
  val schemes: List<String>,
  val colors: List<ThemeColorControl>,
  val darkSchemeLabel: String,
  val darkSchemeOptions: List<Pair<String, String>>,
  val systemFont: String,
  val fonts: List<ThemeFontOption>,
  val borderRadius: ThemeRange,
  val spacing: ThemeRange,
  val navHeightXs: ThemeRange,
  val navHeightSm: ThemeRange,
)

/** One of the built-in themes a site can start from (`ThemePresetSummary`): its id, name, one line and swatches. */
data class ThemePreset(val id: String, val name: String, val description: String, val swatches: List<String>)

fun themePresetsOf(json: JsonElement?): List<ThemePreset> = (json as? JsonArray).orEmpty().mapNotNull { row ->
  val id = row.str("id") ?: return@mapNotNull null
  ThemePreset(id, row.str("name") ?: id, row.str("description").orEmpty(), row.arr("swatches").mapNotNull { (it as? JsonPrimitive)?.contentOrNull })
}

/** What the theme page loads once: the editor's controls, what they show, and the built-in themes. */
data class ThemeEditorLoad(val catalog: ThemeCatalog, val values: ThemeValues, val presets: List<ThemePreset>)

/** The font categories the browser filters by, in the order the console lists them (`HostThemeFontCategory`). */
val FONT_CATEGORIES: List<Pair<String, String>> = listOf(
  "sans-serif" to "Sans serif", "serif" to "Serif", "display" to "Display", "handwriting" to "Handwriting", "monospace" to "Monospace",
)

/** The fonts the browser lists: those whose name has every typed word, in the picked category (null: all). */
fun filterFonts(fonts: List<ThemeFontOption>, search: String, category: String?): List<ThemeFontOption> {
  val words = search.lowercase().split(Regex("\\s+")).filter { it.isNotEmpty() }
  return fonts.filter { font ->
    if (category != null && font.category != category) return@filter false
    val name = font.family.lowercase()
    words.all { name.contains(it) }
  }
}

/** What each control shows (`readThemeEditorValues`). */
data class ThemeValues(
  val colors: Map<String, Map<String, String?>>,
  val darkScheme: String,
  val fontFamily: String,
  val borderRadius: Double?,
  val spacing: Double?,
  val navHeightXs: Double?,
  val navHeightSm: Double?,
)

internal fun JsonElement?.obj(key: String): JsonObject? = (this as? JsonObject)?.get(key) as? JsonObject
internal fun JsonElement?.arr(key: String): List<JsonElement> = ((this as? JsonObject)?.get(key) as? JsonArray).orEmpty()
internal fun JsonElement?.str(key: String): String? = ((this as? JsonObject)?.get(key) as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull
internal fun JsonElement?.num(key: String): Double? = ((this as? JsonObject)?.get(key) as? JsonPrimitive)?.takeIf { it !is JsonNull }?.doubleOrNull

private fun rangeOf(json: JsonElement?) = ThemeRange(json.str("label").orEmpty(), json.num("min")?.toInt() ?: 0, json.num("max")?.toInt() ?: 100)

fun themeCatalogOf(json: JsonElement?): ThemeCatalog = ThemeCatalog(
  schemes = json.arr("schemes").mapNotNull { (it as? JsonPrimitive)?.contentOrNull },
  colors = json.arr("colors").map { ThemeColorControl(it.str("token").orEmpty(), it.str("label").orEmpty(), it.str("group").orEmpty()) },
  darkSchemeLabel = json.obj("darkScheme").str("label") ?: "Dark scheme",
  darkSchemeOptions = json.obj("darkScheme").arr("options").map { it.str("value").orEmpty() to it.str("label").orEmpty() },
  systemFont = json.str("systemFont") ?: "__system__",
  fonts = json.arr("fonts").map { ThemeFontOption(it.str("family").orEmpty(), it.str("category").orEmpty()) },
  borderRadius = rangeOf(json.obj("borderRadius")),
  spacing = rangeOf(json.obj("spacing")),
  navHeightXs = rangeOf(json.obj("navHeight").obj("xs")),
  navHeightSm = rangeOf(json.obj("navHeight").obj("sm")),
)

fun themeValuesOf(json: JsonElement?): ThemeValues = ThemeValues(
  colors = json.obj("colors")?.mapValues { (_, scheme) -> (scheme as? JsonObject)?.mapValues { (_, v) -> (v as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull }.orEmpty() }.orEmpty(),
  darkScheme = json.str("darkScheme") ?: "auto",
  fontFamily = json.str("fontFamily") ?: "__system__",
  borderRadius = json.num("borderRadius"),
  spacing = json.num("spacing"),
  navHeightXs = json.obj("navHeight").num("xs"),
  navHeightSm = json.obj("navHeight").num("sm"),
)

/** One edit of the theme editor, as the route reads it (`ThemeEditorEdit`). */
sealed interface ThemeEdit {
  fun body(): Map<String, Any?>

  data class Color(val scheme: String, val token: String, val value: String?) : ThemeEdit {
    override fun body() = mapOf("control" to "color", "scheme" to scheme, "token" to token, "value" to value)
  }
  data class DarkScheme(val value: String) : ThemeEdit {
    override fun body() = mapOf("control" to "darkScheme", "value" to value)
  }
  data class FontFamily(val value: String) : ThemeEdit {
    override fun body() = mapOf("control" to "fontFamily", "value" to value)
  }
  data class BorderRadius(val value: Double?) : ThemeEdit {
    override fun body() = mapOf("control" to "borderRadius", "value" to value)
  }
  data class Spacing(val value: Double?) : ThemeEdit {
    override fun body() = mapOf("control" to "spacing", "value" to value)
  }
  data class NavHeight(val breakpoint: String, val value: Double?) : ThemeEdit {
    override fun body() = mapOf("control" to "navHeight", "breakpoint" to breakpoint, "value" to value)
  }
}

/** The edits that turn [before] into [after]: only the controls that changed. */
fun themeEdits(before: ThemeValues, after: ThemeValues): List<ThemeEdit> = buildList {
  for ((scheme, colors) in after.colors) for ((token, value) in colors) {
    if (before.colors[scheme]?.get(token) != value) add(ThemeEdit.Color(scheme, token, value?.ifBlank { null }))
  }
  if (before.darkScheme != after.darkScheme) add(ThemeEdit.DarkScheme(after.darkScheme))
  if (before.fontFamily != after.fontFamily) add(ThemeEdit.FontFamily(after.fontFamily))
  if (before.borderRadius != after.borderRadius) add(ThemeEdit.BorderRadius(after.borderRadius))
  if (before.spacing != after.spacing) add(ThemeEdit.Spacing(after.spacing))
  if (before.navHeightXs != after.navHeightXs) add(ThemeEdit.NavHeight("xs", after.navHeightXs))
  if (before.navHeightSm != after.navHeightSm) add(ThemeEdit.NavHeight("sm", after.navHeightSm))
}

/** The site's setup writes, each the console's own. */
class HostSettingsApi(private val api: ConsoleApiClient, private val writer: FirestoreWriter, private val hostId: String) {
  private val path = "hosts/$hostId"

  /** Tells the live site its pages changed, as every setup save does; a failure here never undoes the save. */
  private suspend fun announce() {
    runCatching { api.request("/api/screens/revalidate", ApiMethod.POST, jsonValue(mapOf("hostId" to hostId, "entireHost" to true))) }
  }

  /** A settings form's save: the nested fields merged, the date stamped. */
  suspend fun save(fields: Map<String, Any?>) {
    writer.merge(path, fields + ("updatedAt" to firestoreNow()))
    announce()
  }

  /** A save that replaces whole top-level fields (`mergeFields`, `updateDoc`): a list or a card's own record. */
  suspend fun replace(fields: Map<String, Any?>) {
    writer.update(path, fields + ("updatedAt" to firestoreNow()))
    announce()
  }

  private suspend fun theme(body: Map<String, Any?>): JsonElement? =
    api.request("/api/hosts/theme", ApiMethod.POST, jsonValue(mapOf("hostId" to hostId) + body))

  /** The editor's controls, what they show now and the built-in themes on offer. */
  suspend fun themeEditor(): ThemeEditorLoad {
    val answer = theme(mapOf("action" to "values")) as? JsonObject
    return ThemeEditorLoad(themeCatalogOf(answer?.get("catalog")), themeValuesOf(answer?.get("values")), themePresetsOf(answer?.get("presets")))
  }

  /** Saves the changed controls as the site's theme edits; answers what they show now. */
  suspend fun saveTheme(edits: List<ThemeEdit>): ThemeValues {
    val answer = theme(mapOf("action" to "edit", "edits" to edits.map { it.body() }))
    return themeValuesOf((answer as? JsonObject)?.get("values"))
  }

  /** Switches to the default theme or a saved one (`select`). */
  suspend fun selectTheme(kind: String, id: String? = null) {
    theme(mapOf("action" to "select", "target" to buildMap { put("kind", kind); id?.let { put("id", it) } }))
  }

  suspend fun saveThemeAs(name: String) {
    theme(mapOf("action" to "save-as", "name" to name.trim()))
  }

  /** Writes the edits into the saved theme the site is on (`update`). */
  suspend fun updateSavedTheme() {
    theme(mapOf("action" to "update"))
  }

  /** Drops the edits, back to the picked theme as it was (`restore`). */
  suspend fun restoreTheme() {
    theme(mapOf("action" to "restore"))
  }

  suspend fun renameTheme(id: String, name: String) {
    theme(mapOf("action" to "rename", "id" to id, "name" to name.trim()))
  }

  suspend fun deleteTheme(id: String) {
    theme(mapOf("action" to "delete", "id" to id))
  }

  /** Back to the email's default design (`versionId: null`), as Reset to default does. */
  suspend fun resetEmail(key: String) {
    writer.update("$path/emailTemplates/$key", mapOf("versionId" to null))
  }
}
