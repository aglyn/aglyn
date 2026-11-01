package com.aglyn.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** One choice in an [OptionCardList]: a picture of it, its title, and a line under that. */
data class OptionCardItem(
  val id: String,
  val title: String,
  val description: String,
  val imageUrl: String?,
  /** What the picture shows, for a reader who cannot see it. */
  val imageDescription: String? = null,
)

/** The narrowest a card is drawn: as many as fit take the width, two on a phone (Figma Option card). */
internal val OptionCardMinWidth = 150.dp

/** Between two cards, across and down. */
internal val OptionCardGap = 12.dp

/** How many cards fit across [width], with a gap between each; always at least one. */
internal fun optionCardColumns(width: Dp): Int =
  ((width + OptionCardGap) / (OptionCardMinWidth + OptionCardGap)).toInt().coerceAtLeast(1)

/**
 * A grid of cards to pick one from, under a [header] of its own that scrolls with it: a radio group drawn as cards, each
 * with a picture, a title and a line under it. Nothing is picked until a card is. It scrolls on its own and loads only the
 * pictures in view, so it goes in a [PanelSheet] with `scroll = false`. The console's `OptionCardGrid`; the Apple kit's
 * `AglynOptionCardGrid`.
 */
@Composable
fun OptionCardList(
  label: String,
  options: List<OptionCardItem>,
  selected: String?,
  onSelect: (String) -> Unit,
  modifier: Modifier = Modifier,
  state: LazyListState = rememberLazyListState(),
  header: @Composable ColumnScope.() -> Unit = {},
) {
  BoxWithConstraints(modifier.fillMaxSize()) {
    val inset = space(2f)
    val columns = optionCardColumns(maxWidth - inset * 2)
    val rows = remember(options, columns) { options.chunked(columns) }
    LazyColumn(
      Modifier.fillMaxSize().testTag("option-card-list"),
      state = state,
      contentPadding = PaddingValues(inset),
      verticalArrangement = Arrangement.spacedBy(OptionCardGap),
    ) {
      item(key = "header") {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(space(1.5f)), content = header)
      }
      items(rows, key = { row -> row.first().id }) { row ->
        // Every card in a row is as tall as the tallest: their words differ in length.
        Row(
          Modifier.fillMaxWidth().height(IntrinsicSize.Min).selectableGroup().semantics { contentDescription = label },
          horizontalArrangement = Arrangement.spacedBy(OptionCardGap),
        ) {
          row.forEach { option ->
            OptionCard(option, option.id == selected, { onSelect(option.id) }, Modifier.weight(1f).fillMaxHeight())
          }
          // A last row that falls short keeps its cards the width of the rest.
          repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
        }
      }
    }
  }
}

/**
 * One card of an [OptionCardList]: a surface outlined as strongly as a field, its picture square so the grid never shifts
 * while it loads. Once picked it is outlined 2 dp in the primary color and carries a check in a disc at its top corner.
 */
@Composable
internal fun OptionCard(option: OptionCardItem, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
  val colors = MaterialTheme.colorScheme
  val shape = MaterialTheme.shapes.medium
  Box(
    modifier
      .clip(shape)
      .background(colors.surface)
      .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
      .border(if (selected) 2.dp else 1.dp, if (selected) colors.primary else colors.outline, shape)
      .testTag("option-card-${option.id}"),
  ) {
    Column {
      RemoteImage(option.imageUrl, option.imageDescription, Modifier.fillMaxWidth().aspectRatio(1f))
      HorizontalDivider()
      Column(
        Modifier.fillMaxWidth().padding(start = space(1.5f), top = space(1.25f), end = space(1.5f), bottom = space(1.5f)),
        verticalArrangement = Arrangement.spacedBy(2.dp),
      ) {
        Text(option.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = colors.onSurface)
        Text(option.description, style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant)
      }
    }
    if (selected) {
      Icon(
        AglynIcons.named("check_circle"),
        contentDescription = null,
        tint = colors.primary,
        modifier = Modifier.align(Alignment.TopEnd).padding(space(1f)).size(24.dp).background(colors.surface, CircleShape),
      )
    }
  }
}
