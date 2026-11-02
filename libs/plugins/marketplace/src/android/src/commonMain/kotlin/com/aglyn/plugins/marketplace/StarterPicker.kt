package com.aglyn.plugins.marketplace

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selectableGroup
import androidx.compose.ui.semantics.semantics
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.SiteStarterMode
import com.aglyn.core.SiteStarterSearch
import com.aglyn.core.SiteStarterSummary
import com.aglyn.core.siteStarterPriceLabel
import com.aglyn.pluginhost.LocalStarterPickerZone
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.StarterPickerZone
import com.aglyn.ui.ChoicePicture
import com.aglyn.ui.ChoiceRow
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import kotlinx.coroutines.CancellationException

/** Statuses that mean this workspace may not have starters offered here. */
private val REFUSED = setOf(401, 403, 503)

/**
 * The marketplace's starters in Create site (AGL-4049): the `hostStarterPicker` zone, drawn before the site exists. Lists what
 * the sheet asks for as rows of one choice: a picture, the name, who made it and its page count, and the price. Nothing is
 * picked when it opens; a person picks, and the pick goes to the sheet, which creates the site from it.
 *
 * `ready` tells the sheet whether a picker is on screen, and the first answer decides, as the console's shelf does: starters,
 * or a search that found none, say yes; a workspace refused the starters, a catalog with nothing in it or a first read that
 * failed say no, and the sheet offers its styles instead. Once shown, a later refusal hands back the same way, and a later
 * failure is said here with a way to ask again.
 *
 * What a pick needs next is the sheet's to say (`siteStarterPickNote`), at its foot, in view however long the list.
 * Figma: "Native App", `Sites · Choose your starter`.
 */
@Composable
internal fun StarterPickerWidget(context: NativePluginContext) {
  val zone = LocalStarterPickerZone.current ?: return
  var rows by remember { mutableStateOf(emptyList<SiteStarterSummary>()) }
  var failure by remember { mutableStateOf<String?>(null) }
  var loaded by remember { mutableStateOf(false) }
  var shown by remember { mutableStateOf(false) }
  var attempt by remember { mutableIntStateOf(0) }
  LaunchedEffect(zone.orgId, zone.mode, zone.search, attempt) {
    failure = null
    try {
      val query = StarterQuery.params(zone.orgId, zone.mode, zone.search).toMap()
      rows = StarterQuery.parseAnswer(context.api.request(SiteStarterSearch.PATH, query = query))
      loaded = true
      // The first answer is the only one that may decide there is nothing to show.
      if (shown || rows.isNotEmpty() || zone.search.isNotBlank()) {
        shown = true
        zone.ready(true)
      } else {
        zone.ready(false)
      }
    } catch (error: CancellationException) {
      throw error
    } catch (error: Exception) {
      if (!shown || (error as? ConsoleApiError)?.status in REFUSED) {
        shown = false
        zone.ready(false)
      } else {
        failure = error.message ?: "Starters could not be loaded"
      }
    }
  }
  Column(Modifier.fillMaxWidth().testTag("starter-list")) {
    failure?.let { message ->
      NoticeBanner(message, StatusTone.ERROR) { OutlinedButton(onClick = { attempt += 1 }) { Text("Try again") } }
      return@Column
    }
    when {
      !loaded -> SkeletonList(rows = 3)
      rows.isEmpty() -> NoticeBanner(emptyMessage(zone), StatusTone.INFO)
      else -> Column(
        Modifier.fillMaxWidth().semantics {
          selectableGroup()
          contentDescription = if (zone.mode == SiteStarterMode.AI) "AI starters" else "Starters"
        },
      ) {
        rows.forEachIndexed { index, row ->
          if (index > 0) HorizontalDivider()
          ChoiceRow(
            title = row.displayName.ifEmpty { "Untitled starter" },
            selected = zone.selected?.listingId == row.listingId,
            onSelect = { zone.onPick(row) },
            supporting = detail(row),
            picture = ChoicePicture(starterPicture(row, context.api.origin, 240)),
            badge = { PriceChip(row) },
            modifier = Modifier.testTag("starter-${row.listingId}"),
          )
        }
      }
    }
  }
}

/** Under the name: who made it and how many pages it creates, as one line. */
private fun detail(row: SiteStarterSummary): String =
  listOfNotNull(row.authorName.ifEmpty { null }?.let { "By $it" }, StarterQuery.pagesLabel(row.pages.toDouble())).joinToString(" · ")

/** The price, every row carrying one, "Free" included; one the workspace owns says so instead. */
@Composable
private fun PriceChip(row: SiteStarterSummary) = when {
  row.priceUsd <= 0 -> StatusChip("Free", StatusTone.SUCCESS)
  row.owned == true -> StatusChip("Owned", StatusTone.SUCCESS)
  else -> StatusChip(siteStarterPriceLabel(row.priceUsd), StatusTone.INFO)
}

private fun emptyMessage(zone: StarterPickerZone): String = when {
  zone.search.isNotBlank() -> "No starters match — try fewer words"
  zone.mode == SiteStarterMode.AI -> "No AI starters yet"
  else -> "No starters yet"
}
