// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.site.setup

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import com.aglyn.core.ConsoleApiError
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.PanelSheet
import com.aglyn.ui.SearchField
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.WithTooltip
import com.aglyn.ui.aglynFilterChipColors
import com.aglyn.ui.rememberWebFontFamily
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

/*
 * The theme editor's font control (the fonts plugin's `FontPicker`, `FontBrowserDialog`, `FontDetail` and `FontFamilyCard`,
 * AGL-3656): the site's body font and heading font, each drawn in the site's own words in its own face, with what the fonts
 * cost a visitor; a browser of the whole Google Fonts catalog and the site's uploaded fonts; and one family's styles, cost
 * and pairings. Every choice is an edit to the editor's draft, which the editor's Save keeps. Faces come from the shared
 * `WebFontLoader`; the system font stands in while one loads, offline, or when it cannot. The Swift kit's
 * FontPickerViews.swift draws the same.
 */

/** What a cost badge stands at: measuring, measured, or not measurable (`FontCostState`). */
data class FontCostState(val cost: FontCost? = null, val loading: Boolean = true, val error: String? = null)

/** Every answer the cost route gave this session, so going back to an earlier choice answers at once (`useFontCost`). */
private object FontCostCache {
  private val answers = mutableMapOf<String, FontCost>()

  suspend fun cost(api: FontPickerApi, selection: ThemeFontSelection): FontCost {
    val key = "${api.hostId}|$selection"
    answers[key]?.let { return it }
    // A failed answer is not kept: the next look asks again.
    return api.cost(selection).also { answers[key] = it }
  }
}

/** What [selection]'s fonts cost, asked a moment after the last change (`useFontCost`). */
@Composable
private fun rememberFontCost(api: FontPickerApi, selection: ThemeFontSelection?): FontCostState {
  var state by remember(api.hostId) { mutableStateOf(FontCostState()) }
  LaunchedEffect(api.hostId, selection) {
    if (selection == null) return@LaunchedEffect
    state = state.copy(loading = true, error = null)
    delay(250)
    state = try {
      FontCostState(FontCostCache.cost(api, selection), loading = false)
    } catch (error: CancellationException) {
      throw error
    } catch (error: Exception) {
      FontCostState(null, loading = false, error = (error as? ConsoleApiError)?.message ?: "The size could not be measured.")
    }
  }
  return state
}

/** What all the site's fonts cost a visitor (`ALL_FONTS_COST_TOOLTIP`). */
private const val ALL_FONTS_COST_HELP =
  "What a visitor downloads for all your fonts together: the Latin files your text styles and italics use, served from your site’s own address."

/** What one font costs a visitor (`FONT_COST_TOOLTIP`). */
private const val ONE_FONT_COST_HELP =
  "What a visitor downloads for this font: the Latin files your text styles and italics use, served from your site’s own address. Measured the way your published pages load them."

/** A download size as one small badge, with its measuring and failed states (`DownloadCostBadge`). */
@Composable
private fun FontCostBadge(state: FontCostState, help: String) {
  val cost = state.cost
  WithTooltip(state.error ?: help) {
    when {
      state.loading -> StatusChip("Measuring…")
      cost == null || state.error != null -> StatusChip("Size unavailable", StatusTone.WARNING)
      else -> StatusChip(fontCostLabel(cost), if (cost.bytes == 0L) StatusTone.SUCCESS else StatusTone.NEUTRAL)
    }
  }
}

/** The family a preview falls back to while its face loads: the category's own kind of system face (`genericFamily`). */
private fun fallbackFamily(category: String): FontFamily = when (category) {
  "serif" -> FontFamily.Serif
  "monospace" -> FontFamily.Monospace
  "handwriting" -> FontFamily.Cursive
  else -> FontFamily.SansSerif
}

/** Text drawn in one face of a Google family, loaded by the shared `WebFontLoader`; the category's system face meanwhile. */
@Composable
private fun FontFaceText(
  text: String,
  family: String?,
  style: TextStyle,
  modifier: Modifier = Modifier,
  category: String = "sans-serif",
  weight: Int = 400,
  italic: Boolean = false,
  maxLines: Int = Int.MAX_VALUE,
) {
  val loaded = rememberWebFontFamily(family, weight, italic, text)
  Text(
    text,
    modifier,
    style = style.copy(
      fontFamily = loaded ?: fallbackFamily(category),
      fontWeight = FontWeight(weight.coerceIn(1, 1000)),
      fontStyle = if (italic) FontStyle.Italic else FontStyle.Normal,
    ),
    maxLines = maxLines,
    overflow = TextOverflow.Ellipsis,
  )
}

/** A font's upright weights and italics from an uploaded family's faces (`customChoice`). */
internal fun customFontChoice(font: InstalledFont): ThemeFontChoice {
  val upright = font.faces.filter { it.style == "normal" }.map { it.weight }.distinct().sorted()
  val italics = font.faces.filter { it.style == "italic" }.map { it.weight }.distinct().sorted()
  return ThemeFontChoice(font.family.trim(), font.category ?: "sans-serif", upright.ifEmpty { listOf(400) }, italics, source = "custom")
}

private fun ThemeFontSelection.with(role: FontPickerRole, choice: ThemeFontChoice?) =
  if (role == FontPickerRole.BODY) copy(body = choice) else copy(heading = choice)

private fun ThemeFontSelection.of(role: FontPickerRole) = if (role == FontPickerRole.BODY) body else heading

/** The theme editor's font control: the body and heading fonts, each drawn in its face, and what they cost (`FontPicker`). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ThemeFontsControl(
  api: FontPickerApi,
  fontsApi: FontsApi,
  sample: SiteSample,
  canEdit: Boolean,
  fonts: ThemeFontSelection,
  onFonts: (ThemeFontSelection) -> Unit,
) {
  var browsing by remember { mutableStateOf<FontPickerRole?>(null) }
  val cost = rememberFontCost(api, fonts)
  Column(Modifier.fillMaxWidth().testTag("theme-fonts"), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.Center) {
      Text("Fonts", style = MaterialTheme.typography.titleSmall, modifier = Modifier.align(Alignment.CenterVertically))
      FontCostBadge(cost, ALL_FONTS_COST_HELP)
    }
    FontRoleCard(FontPickerRole.BODY, fonts.body, fonts.body, sample, canEdit, onChange = { browsing = FontPickerRole.BODY })
    FontRoleCard(
      FontPickerRole.HEADING, fonts.heading, fonts.body, sample, canEdit,
      onChange = { browsing = FontPickerRole.HEADING },
      onClear = if (fonts.heading == null) null else ({ onFonts(fonts.copy(heading = null)) }),
    )
  }
  browsing?.let { role ->
    FontBrowserSheet(role, api, fontsApi, sample, fonts, onApply = onFonts, onDismiss = { browsing = null })
  }
}

/** One role's card: what it draws in, in the site's words (`FontRoleCard`). */
@Composable
private fun FontRoleCard(
  role: FontPickerRole,
  choice: ThemeFontChoice?,
  bodyChoice: ThemeFontChoice?,
  sample: SiteSample,
  canEdit: Boolean,
  onChange: () -> Unit,
  onClear: (() -> Unit)? = null,
) {
  // What the role draws in: its own font, else the body's, else the base.
  val drawn = choice ?: if (role == FontPickerRole.HEADING) bodyChoice else null
  val weight = if (role == FontPickerRole.HEADING) drawn?.weights?.maxOrNull() ?: 700 else drawn?.weights?.minOrNull() ?: 400
  val title = choice?.family ?: if (role == FontPickerRole.BODY) "Theme default" else "Same as body text"
  val subheader = when {
    choice != null -> "${fontCategoryLabel(choice.category)} · ${fontChoiceStylesLabel(choice)}"
    role == FontPickerRole.HEADING && bodyChoice != null -> "${bodyChoice.family}, in each heading’s own weight"
    else -> "The visitor’s system font"
  }
  OutlinedCard(Modifier.fillMaxWidth().testTag("font-role-${role.key}")) {
    Column(Modifier.padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
          Text(role.label.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          Text(title, style = MaterialTheme.typography.titleMedium)
          Text(subheader, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (onClear != null) TextButton(onClick = onClear, enabled = canEdit) { Text("Use body font") }
        TextButton(
          onClick = onChange,
          enabled = canEdit,
          modifier = Modifier.testTag("font-change-${role.key}").semantics { contentDescription = "Change the ${role.label.lowercase()} font" },
        ) { Text("Change") }
      }
      FontFaceText(
        if (role == FontPickerRole.HEADING) sample.heading else sample.paragraph,
        family = drawn?.takeIf { it.source == "google" }?.family,
        style = if (role == FontPickerRole.HEADING) MaterialTheme.typography.headlineSmall else MaterialTheme.typography.bodyLarge,
        category = drawn?.category ?: "sans-serif",
        weight = weight,
      )
    }
  }
}

/** What the browser has open: the theme default, a Google family, or an uploaded font. */
private sealed interface FontTarget {
  data object Default : FontTarget
  data class Google(val family: GoogleFontFamily) : FontTarget
  data class Custom(val font: InstalledFont) : FontTarget
}

private fun stylesLabel(count: Int) = "$count ${if (count == 1) "style" else "styles"}"

/**
 * The whole Google Fonts catalog for one role, searched and narrowed by category, drawn in the site's own words, with the
 * site's uploaded fonts above it (`FontBrowserDialog`). A family opens its detail in its place, as the console's phone
 * dialog takes turns.
 */
@Composable
private fun FontBrowserSheet(
  role: FontPickerRole,
  api: FontPickerApi,
  fontsApi: FontsApi,
  sample: SiteSample,
  selection: ThemeFontSelection,
  onApply: (ThemeFontSelection) -> Unit,
  onDismiss: () -> Unit,
) {
  var catalog by remember { mutableStateOf<List<GoogleFontFamily>?>(null) }
  var catalogError by remember { mutableStateOf<String?>(null) }
  var attempt by remember { mutableStateOf(0) }
  var installed by remember { mutableStateOf<List<InstalledFont>>(emptyList()) }
  var search by remember { mutableStateOf("") }
  var category by remember { mutableStateOf("all") }
  var target by remember { mutableStateOf<FontTarget?>(null) }
  LaunchedEffect(attempt) {
    catalogError = null
    try {
      catalog = api.catalog()
    } catch (error: CancellationException) {
      throw error
    } catch (_: Exception) {
      catalogError = "The font list could not be loaded. Check your connection and try again."
    }
  }
  LaunchedEffect(Unit) {
    installed = try {
      fontsApi.installed()
    } catch (error: CancellationException) {
      throw error
    } catch (_: Exception) {
      emptyList()
    }
  }
  val current = selection.of(role)
  val apply = { next: ThemeFontSelection ->
    onApply(next)
    onDismiss()
  }
  PanelSheet(
    title = if (role == FontPickerRole.BODY) "Choose the font for body text" else "Choose the font for headings",
    onDismiss = onDismiss,
    scroll = target != null,
  ) {
    val open = target
    if (open != null) {
      Column(verticalArrangement = Arrangement.spacedBy(space(2f))) {
        TextButton(onClick = { target = null }, modifier = Modifier.testTag("font-back")) {
          Icon(AglynIcons.named("arrow_back"), contentDescription = null)
          Text("All fonts", Modifier.padding(start = space(1f)))
        }
        FontDetail(role, open, api, sample, selection, catalog.orEmpty(), apply)
      }
      return@PanelSheet
    }
    val filtering = search.isNotBlank() || category != "all"
    val words = search.trim().lowercase()
    val matchingCustom = if (category != "all") emptyList() else installed.filter { words.isEmpty() || it.family.lowercase().contains(words) }
    fun isSelected(family: String?) = if (family == null) current == null else current?.family.equals(family, ignoreCase = true)
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(space(1f))) {
      SearchField(search, { search = it }, "Inter, Lora, Playfair…", Modifier.fillMaxWidth().testTag("font-search"))
      ChoiceChipRow(listOf(ChipOption("all", "All")) + FONT_CATEGORY_LABELS.map { ChipOption(it.first, it.second) }, category, { category = it })
      val families = catalog
      val results = families?.let { searchFontFamilies(it, search, if (category == "all") "" else category) }.orEmpty()
      LazyColumn(Modifier.fillMaxSize().testTag("font-browser-list"), verticalArrangement = Arrangement.spacedBy(space(1f))) {
        if (!filtering) {
          item("default") {
            val bodyFont = if (role == FontPickerRole.HEADING) selection.body else null
            FontFamilyRow(
              label = if (role == FontPickerRole.BODY) "Theme default" else "Same as body text",
              detail = if (role == FontPickerRole.BODY) "The visitor’s system font · nothing to download" else "Headings use the body font",
              sample = sample.title,
              family = bodyFont?.takeIf { it.source == "google" }?.family,
              category = bodyFont?.category ?: "sans-serif",
              selected = isSelected(null),
              onSelect = { target = FontTarget.Default },
            )
          }
        }
        if (matchingCustom.isNotEmpty()) {
          item("custom-header") { Text("YOUR FONTS", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
          items(matchingCustom, key = { "custom-${it.family}" }) { font ->
            FontFamilyRow(
              label = font.family,
              detail = "${fontCategoryLabel(font.category ?: "sans-serif")} · uploaded",
              sample = sample.title,
              family = null,
              category = font.category ?: "sans-serif",
              selected = isSelected(font.family),
              onSelect = { target = FontTarget.Custom(font) },
            )
          }
        }
        when {
          catalogError != null -> item("error") {
            NoticeBanner(catalogError.orEmpty(), StatusTone.ERROR, action = { TextButton(onClick = { attempt++ }) { Text("Try again") } })
          }
          families == null -> item("loading") { SkeletonList(rows = 6) }
          results.isEmpty() -> item("empty") {
            EmptyState(
              "No fonts match",
              body = "Try another name, or another category.",
              icon = AglynIcons.named("text_fields"),
              action = { TextButton(onClick = { search = ""; category = "all" }) { Text("Show all fonts") } },
            )
          }
          else -> {
            item("summary") {
              val count = "${results.size} ${if (results.size == 1) "family" else "families"}"
              val matched = if (filtering) (if (results.size == 1) " matches" else " match") else ""
              Text(
                "Google Fonts · $count$matched, most popular first",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
              )
            }
            items(results, key = { it.family }) { family ->
              FontFamilyRow(
                label = family.family,
                detail = "${fontCategoryLabel(family.category)} · ${stylesLabel(family.weights.size + family.italics.size)}",
                sample = sample.title,
                family = family.family,
                category = family.category,
                selected = isSelected(family.family),
                onSelect = { target = FontTarget.Google(family) },
              )
            }
          }
        }
      }
    }
  }
}

/** One family in the browser: its name and the site's name drawn in it, loaded as the row comes into view (`FontFamilyCard`). */
@Composable
private fun FontFamilyRow(
  label: String,
  detail: String,
  sample: String,
  family: String?,
  category: String,
  selected: Boolean,
  onSelect: () -> Unit,
) {
  OutlinedCard(
    Modifier.fillMaxWidth().clickable(onClick = onSelect).testTag("font-row-$label").semantics {
      contentDescription = "$label, $detail"
      this.selected = selected
    },
    border = if (selected) androidx.compose.foundation.BorderStroke(space(0.25f), MaterialTheme.colorScheme.primary) else androidx.compose.material3.CardDefaults.outlinedCardBorder(),
  ) {
    Column(Modifier.padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
          Text(label, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
          Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        }
        if (selected) Icon(AglynIcons.named("check"), contentDescription = null, tint = MaterialTheme.colorScheme.primary)
      }
      FontFaceText(sample, family, MaterialTheme.typography.headlineSmall, category = category, maxLines = 1)
    }
  }
}

/**
 * One family chosen from the list: the site's words in it, the styles to load, what it costs and what pairs with it; or the
 * theme default (`FontDetail`, and the dialog's default card).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FontDetail(
  role: FontPickerRole,
  target: FontTarget,
  api: FontPickerApi,
  sample: SiteSample,
  selection: ThemeFontSelection,
  catalog: List<GoogleFontFamily>,
  apply: (ThemeFontSelection) -> Unit,
) {
  val other = if (role == FontPickerRole.BODY) FontPickerRole.HEADING else FontPickerRole.BODY
  if (target == FontTarget.Default) {
    OutlinedCard(Modifier.fillMaxWidth().testTag("font-detail-default")) {
      Column(Modifier.padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(2f))) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Column(Modifier.weight(1f)) {
            Text(if (role == FontPickerRole.BODY) "Theme default" else "Same as body text", style = MaterialTheme.typography.titleLarge)
            Text(
              if (role == FontPickerRole.BODY) "No font to download" else "One font for the whole site",
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }
          Button(onClick = { apply(selection.with(role, null)) }, modifier = Modifier.testTag("font-use")) {
            Text(if (role == FontPickerRole.BODY) "Use theme default" else "Use body font")
          }
        }
        Text(
          if (role == FontPickerRole.BODY) {
            "Text is drawn in the font each visitor’s device already has — San Francisco on Apple devices, Segoe UI on Windows, Roboto on Android. It costs nothing to download and appears at once."
          } else {
            "Headings are drawn in the body text’s font, in their own weights. Pick a font here to give them one of their own."
          },
          style = MaterialTheme.typography.bodyMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (role == FontPickerRole.BODY) FontCostBadge(FontCostState(FontCost.NONE, loading = false), "System fonts are already on the visitor’s device.")
      }
    }
    return
  }
  val google = (target as? FontTarget.Google)?.family
  val customOffered = (target as? FontTarget.Custom)?.font?.let(::customFontChoice)
  val current = selection.of(role)
  var choice by remember(target) {
    mutableStateOf(
      when (target) {
        is FontTarget.Google ->
          current?.takeIf { it.family.equals(target.family.family, ignoreCase = true) } ?: defaultFontChoice(target.family, role)
        is FontTarget.Custom -> customFontChoice(target.font)
        FontTarget.Default -> error("unreachable")
      },
    )
  }
  val cost = rememberFontCost(api, selection.with(role, choice))
  val offeredWeights = google?.weights ?: customOffered?.weights ?: choice.weights
  val offeredItalics = google?.italics ?: customOffered?.italics.orEmpty()
  val styles = offeredWeights.size + offeredItalics.size
  val subheader = listOfNotNull(
    fontCategoryLabel(choice.category),
    "$styles ${if (styles == 1) "style" else "styles"}",
    if (google?.axes?.any { it.tag == "wght" } == true) "Variable" else null,
    if (google == null) "Your font" else null,
  ).joinToString(" · ")
  val headingWeight = choice.weights.maxOrNull() ?: 700
  val bodyWeight = choice.weights.minOrNull() ?: 400
  // The preview's other line: body text under a heading font, in the body font; headings over a body font, in the theme's
  // heading font if it has one.
  val companion = if (role == FontPickerRole.HEADING) selection.body else selection.heading
  Column(verticalArrangement = Arrangement.spacedBy(space(2f))) {
    OutlinedCard(Modifier.fillMaxWidth().testTag("font-detail")) {
      Column(Modifier.padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(3f))) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Column(Modifier.weight(1f)) {
            Text(choice.family, style = MaterialTheme.typography.titleLarge)
            Text(subheader, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
          Button(onClick = { apply(selection.with(role, choice)) }, modifier = Modifier.testTag("font-use")) {
            Text(if (role == FontPickerRole.BODY) "Use for body text" else "Use for headings")
          }
        }
        Column(verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
          val headingText = if (role == FontPickerRole.HEADING) sample.heading else sample.title
          if (role == FontPickerRole.BODY && companion != null) {
            FontFaceText(
              headingText, companion.family.takeIf { companion.source == "google" }, MaterialTheme.typography.headlineMedium,
              category = companion.category, weight = companion.weights.maxOrNull() ?: 700,
            )
          } else {
            FontFaceText(headingText, google?.family, MaterialTheme.typography.headlineMedium, category = choice.category, weight = headingWeight)
          }
          if (role == FontPickerRole.HEADING && companion != null) {
            FontFaceText(
              sample.paragraph, companion.family.takeIf { companion.source == "google" }, MaterialTheme.typography.bodyLarge,
              category = companion.category, weight = companion.weights.minOrNull() ?: 400,
            )
          } else {
            FontFaceText(sample.paragraph, google?.family, MaterialTheme.typography.bodyLarge, category = choice.category, weight = bodyWeight)
          }
        }
        Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
          Text("Styles to load", style = MaterialTheme.typography.titleSmall)
          FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
            for (weight in offeredWeights) {
              val on = weight in choice.weights
              FilterChip(
                selected = on,
                onClick = {
                  // A font always loads at least one weight.
                  if (!(on && choice.weights.size == 1)) {
                    choice = choice.copy(weights = if (on) choice.weights - weight else (choice.weights + weight).sorted())
                  }
                },
                label = { Text(fontWeightLabel(weight)) },
                colors = aglynFilterChipColors(),
                modifier = Modifier.testTag("font-weight-$weight"),
              )
            }
            if (offeredItalics.isNotEmpty()) {
              if (role == FontPickerRole.BODY) {
                // The page loads body text's italic whatever the theme lists, so emphasis is a true italic: shown, not offered.
                WithTooltip("Body text always loads its italic, so emphasis in your text is a true italic.") {
                  FilterChip(
                    selected = true,
                    onClick = {},
                    label = { Text("Italic", fontStyle = FontStyle.Italic) },
                    colors = aglynFilterChipColors(),
                  )
                }
              } else {
                val italicOn = choice.italics.isNotEmpty()
                FilterChip(
                  selected = italicOn,
                  onClick = {
                    choice = if (italicOn) {
                      choice.copy(italics = emptyList())
                    } else {
                      val wanted = choice.weights.filter { it in offeredItalics }
                      choice.copy(italics = wanted.ifEmpty { listOf(offeredItalics.first()) })
                    }
                  },
                  label = { Text("Italic", fontStyle = FontStyle.Italic) },
                  colors = aglynFilterChipColors(),
                )
              }
            }
          }
          Text(
            "Your headings and text styles load the weights they use as well, matched to the nearest one this font has.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
          Text("Download size", style = MaterialTheme.typography.titleSmall, modifier = Modifier.align(Alignment.CenterVertically))
          Text("This font", style = MaterialTheme.typography.bodySmall, modifier = Modifier.align(Alignment.CenterVertically))
          val share = cost.cost?.share(choice.family)
          FontCostBadge(cost.copy(cost = cost.cost?.let { FontCost(share?.bytes ?: 0L, share?.files ?: 0, share?.complete ?: true) }), ONE_FONT_COST_HELP)
          val all = cost.cost
          if (all != null && all.families.size > 1) {
            Text("All your fonts", style = MaterialTheme.typography.bodySmall, modifier = Modifier.align(Alignment.CenterVertically))
            FontCostBadge(FontCostState(all, loading = false), ALL_FONTS_COST_HELP)
          }
        }
      }
    }
    val pairings = google?.let { suggestFontPairings(it, other, catalog) }.orEmpty()
    if (pairings.isNotEmpty()) {
      Text(if (role == FontPickerRole.BODY) "Headings that pair well" else "Body text that pairs well", style = MaterialTheme.typography.titleSmall)
      for (pairing in pairings) {
        PairingCard(pairing, sample, role) {
          val partner = defaultFontChoice(pairing.family, other)
          apply(if (role == FontPickerRole.BODY) ThemeFontSelection(choice, partner) else ThemeFontSelection(partner, choice))
        }
      }
    }
  }
}

/** A suggested partner, drawn in the role it would play (`PairingCard`). */
@Composable
private fun PairingCard(pairing: FontPairing, sample: SiteSample, role: FontPickerRole, onUse: () -> Unit) {
  // The suggestion plays the other role: headings for a body font, text for a heading font.
  val weight = if (role == FontPickerRole.BODY) {
    maxOf(pairing.family.weights.filter { it <= 700 }.maxOrNull() ?: 0, pairing.family.weights.firstOrNull() ?: 400)
  } else {
    400
  }
  OutlinedCard(Modifier.fillMaxWidth().testTag("font-pair-${pairing.family.family}")) {
    Column(Modifier.padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
          Text(pairing.family.family, style = MaterialTheme.typography.titleSmall)
          Text(pairing.reason, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        TextButton(onClick = onUse) { Text("Use pair") }
      }
      FontFaceText(
        sample.title, pairing.family.family, MaterialTheme.typography.titleLarge, category = pairing.family.category, weight = weight, maxLines = 1,
      )
    }
  }
}
