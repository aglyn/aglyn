package com.aglyn.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.ui.draw.alpha
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/**
 * The ☆ for the place on screen, which the shell binds: a screen with a title row draws it beside its title (and claims
 * it, so the shell does not draw it again).
 */
@Stable
class PageStarSlot(val star: @Composable () -> Unit) {
  var claimed by mutableStateOf(false)
}

val LocalPageStar = staticCompositionLocalOf<PageStarSlot?> { null }

/**
 * The breadcrumbs for the place on screen, which the shell binds. A list beside its detail (Figma Orders 13:483 / 13:2167)
 * draws them atop the detail column and claims them, so the list column starts with its own title row.
 */
@Stable
class PageCrumbsSlot {
  var crumbs: @Composable () -> Unit by mutableStateOf({})
  var claimed by mutableStateOf(false)
}

val LocalPageCrumbs = staticCompositionLocalOf<PageCrumbsSlot?> { null }

/**
 * The area's section chips (Orders / Returns / …), which the shell offers to the screen. A list beside its detail on a
 * tablet or desktop takes them into its list column under its head ([ListColumnSections], AGL-4012, as Apple's
 * AglynListColumnHeader); unclaimed, the shell draws them across the content.
 */
@Stable
class PageSectionsSlot {
  var sections: @Composable () -> Unit by mutableStateOf({})
  private var claims by mutableStateOf(0)
  val claimed: Boolean get() = claims > 0
  fun claim() { claims++ }
  fun release() { claims = (claims - 1).coerceAtLeast(0) }
}

val LocalPageSections = staticCompositionLocalOf<PageSectionsSlot?> { null }

/** In a list column beside its detail: the area's section chips, taken from the shell (nothing elsewhere). */
@Composable
fun ListColumnSections() {
  if (LocalListColumn.current == null) return
  val slot = LocalPageSections.current ?: return
  DisposableEffect(slot) {
    slot.claim()
    onDispose { slot.release() }
  }
  slot.sections()
}

/** One filter choice in a list's Filter menu: a group heading's options, one picked per group. */
data class FilterChoice(val group: String, val key: String, val label: String)

/**
 * A desktop (Compact) button as Figma's Button, Density = Compact draws it: radius 6, semibold. Regular is 28 tall with a
 * 14 icon and 13/18 text, padding 10, gap 6 (the list toolbar's Filter, a list column's action); [tall] is 36 with a 16
 * icon and 14/20 text, padding 14, gap 8 (a full-width title row's primary). [filled] takes the accent; otherwise the
 * surface with the strong border.
 */
@Composable
fun CompactButton(
  label: String,
  icon: String?,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  enabled: Boolean = true,
  filled: Boolean = false,
  tall: Boolean = false,
) {
  val metrics = LocalShellMetrics.current
  val shape = androidx.compose.foundation.shape.RoundedCornerShape(metrics.controlRadius)
  val scheme = MaterialTheme.colorScheme
  val ink = if (filled) scheme.onPrimary else scheme.onSurface
  Row(
    modifier
      .heightIn(min = if (tall) 36.dp else 28.dp)
      .alpha(if (enabled) 1f else 0.38f)
      .clip(shape)
      .background(if (filled) scheme.primary else scheme.surface)
      .then(if (filled) Modifier else Modifier.border(1.dp, scheme.outline, shape))
      .clickable(enabled = enabled, role = androidx.compose.ui.semantics.Role.Button, onClick = onClick)
      .padding(horizontal = if (tall) 14.dp else 10.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(if (tall) 8.dp else 6.dp),
  ) {
    if (icon != null) Icon(AglynIcons.named(icon), contentDescription = null, modifier = Modifier.size(if (tall) 16.dp else 14.dp), tint = ink)
    Text(
      label,
      color = ink,
      fontSize = if (tall) 14.sp else 13.sp,
      lineHeight = if (tall) 20.sp else 18.sp,
      fontWeight = FontWeight.SemiBold,
      maxLines = 1,
    )
  }
}

/**
 * A list column's action beside its heading (New page, New form…): on the desktop the Compact 28 button, as Figma's
 * list column draws it (Orders 13:483); elsewhere the filled button with its icon.
 */
@Composable
fun ListHeaderAction(label: String, icon: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
  if (LocalShellMetrics.current.compact || currentWidthClass() != WidthClass.COMPACT) {
    CompactButton(label, icon, onClick, modifier, enabled = enabled)
  } else {
    Button(onClick = onClick, enabled = enabled, modifier = modifier) {
      Icon(AglynIcons.named(icon), contentDescription = null)
      Text(label, Modifier.padding(start = space(1f)))
    }
  }
}

/**
 * A content head's measures on the desktop and tablet (Figma Mac Sites 13:3 / iPad 13:1880, Orders 13:483; Apple's
 * AglynHeadMetrics): 24 above the breadcrumbs (16 tall), 16 between them and the title row, the title row as tall as the
 * filled 36 button with the button centered on it, 16 to the list toolbar and 16 from it to the list. A list beside its
 * detail heads its own column without breadcrumbs: 20 above its 28 title row, 12 to the toolbar and 12 to the rows.
 */
object HeadMetrics {
  val top = 24.dp
  val crumbs = 16.dp
  val gap = 16.dp
  val titleRow = 36.dp
  val listColumnTop = 20.dp
  val listColumnTitleRow = 28.dp
  val listColumnGap = 12.dp
}

/** The primary action of a list screen: its one filled button. */
data class PrimaryAction(val id: String, val label: String, val icon: String = "add", val enabled: Boolean = true, val run: () -> Unit)

/**
 * The shared list screen (Figma Mac Sites 13:3, Orders 13:483): the title row with ☆ and ONE filled primary button (any
 * other action in ⋯), then the list toolbar (a search field and ONE Filter button), the active filters as chips only
 * once one is set, then the list.
 */
@Composable
fun ListScreenScaffold(
  title: String,
  query: String,
  onQuery: (String) -> Unit,
  placeholder: String,
  modifier: Modifier = Modifier,
  tag: String = "list",
  primary: PrimaryAction? = null,
  more: List<MenuAction> = emptyList(),
  filters: List<FilterChoice> = emptyList(),
  /** The picked key per group; a group whose pick is its first option counts as not filtering. */
  picked: Map<String, String> = emptyMap(),
  onPick: (FilterChoice) -> Unit = {},
  /**
   * The list sits in a list column beside its detail (Orders): on the desktop its title row is Figma 13:483's, 28 tall
   * with a Compact 28 action. Otherwise (Sites, Figma 13:3) the primary is the filled 36 button.
   */
  inListColumn: Boolean = false,
  content: @Composable ColumnScope.() -> Unit,
) {
  val star = LocalPageStar.current
  if (star != null) {
    DisposableEffect(star) {
      star.claimed = true
      onDispose { star.claimed = false }
    }
  }
  val metrics = LocalShellMetrics.current
  // The desktop and the tablet head a list as Figma does (Mac 13:483, iPad 13:2167): 28 controls, the 22/28 title.
  val compactHead = metrics.compact || currentWidthClass() != WidthClass.COMPACT
  val groups = filters.groupBy { it.group }
  val active = groups.mapNotNull { (group, options) -> options.firstOrNull { it.key == picked[group] }?.takeIf { it != options.first() } }
  // E, or what is left of it inside a list pane that already brings its content in (LocalContentInset).
  val edge = LocalContentInset.current ?: contentInset()
  Column(modifier.fillMaxSize().testTag("$tag-screen")) {
    // The head's rhythm (HeadMetrics) on the desktop and tablet; a phone keeps its own.
    val headTop = when { !compactHead -> space(1f); inListColumn -> HeadMetrics.listColumnTop; else -> HeadMetrics.gap }
    val headGap = when { !compactHead -> space(1.5f); inListColumn -> HeadMetrics.listColumnGap; else -> HeadMetrics.gap }
    val toolbarGap = when { !compactHead -> space(1f); inListColumn -> HeadMetrics.listColumnGap; else -> HeadMetrics.gap }
    val titleRow = when { !compactHead -> 0.dp; inListColumn -> HeadMetrics.listColumnTitleRow; else -> HeadMetrics.titleRow }
    Row(
      Modifier.fillMaxWidth().padding(start = edge, end = edge, top = headTop, bottom = headGap).heightIn(min = titleRow).testTag("$tag-title-row"),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(space(1f)),
    ) {
      Text(
        title,
        // Figma's list title: 22/28 bold on the desktop.
        style = if (compactHead) MaterialTheme.typography.headlineSmall.copy(fontSize = ListColumnTitle.size, lineHeight = ListColumnTitle.line) else MaterialTheme.typography.headlineSmall,
        fontWeight = FontWeight.Bold,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.semantics { heading() },
      )
      star?.star?.invoke()
      Box(Modifier.weight(1f))
      if (more.isNotEmpty() && !compactHead) OverflowMenu(more, contentDescription = "More actions")
      primary?.let { action ->
        if (compactHead) {
          CompactButton(action.label, action.icon, action.run, Modifier.testTag(action.id), enabled = action.enabled, filled = !inListColumn, tall = !inListColumn)
        } else {
          Button(onClick = action.run, enabled = action.enabled, shape = controlShape(), modifier = Modifier.testTag(action.id)) {
            Icon(AglynIcons.named(action.icon), contentDescription = null, Modifier.size(18.dp))
            Text(action.label, Modifier.padding(start = space(1f)), maxLines = 1)
          }
        }
      }
      if (more.isNotEmpty() && compactHead) OverflowMenu(more, contentDescription = "More actions", boxed = true)
    }
    // A list beside its detail heads its own column: the area's section chips under the head, then the toolbar.
    ListColumnSections()
    Row(
      Modifier.fillMaxWidth().padding(horizontal = edge).padding(bottom = toolbarGap).testTag("$tag-toolbar"),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(space(1f)),
    ) {
      SearchField(query, onQuery, placeholder = placeholder, modifier = Modifier.weight(1f))
      if (groups.isNotEmpty()) {
        var open by remember { mutableStateOf(false) }
        Box {
          val filterLabel = if (active.isEmpty()) "Filter" else "Filter · ${active.size}"
          val filterTag = Modifier.testTag("$tag-filter").semantics { contentDescription = if (active.isEmpty()) "Filter" else "Filter, ${active.size} set" }
          if (compactHead) {
            // Figma's list toolbar Button: 28, the surface with the strong border.
            CompactButton(filterLabel, "filter_list", { open = true }, filterTag)
          } else {
            OutlinedButton(onClick = { open = true }, shape = controlShape(), modifier = filterTag) {
              Icon(AglynIcons.named("filter_list"), contentDescription = null, Modifier.size(18.dp))
              Text(filterLabel, Modifier.padding(start = space(0.75f)))
            }
          }
          DropdownMenu(open, onDismissRequest = { open = false }, modifier = Modifier.testTag("$tag-filter-menu")) {
            groups.entries.forEachIndexed { index, (group, options) ->
              if (index > 0) HorizontalDivider()
              Text(group, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
              for (option in options) {
                DropdownMenuItem(
                  text = { Text(option.label) },
                  trailingIcon = { if (picked[group] == option.key || (picked[group] == null && option == options.first())) Icon(AglynIcons.named("check"), null) },
                  onClick = { open = false; onPick(option) },
                  modifier = Modifier.testTag("$tag-filter-${option.key}"),
                )
              }
            }
          }
        }
      }
    }
    // The filters in force, each with × to clear it back to its group's first option.
    if (active.isNotEmpty()) {
      Row(Modifier.fillMaxWidth().padding(horizontal = edge).padding(bottom = space(1f)), horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        for (choice in active) {
          InputChip(
            selected = true,
            onClick = { groups[choice.group]?.firstOrNull()?.let(onPick) },
            label = { Text(choice.label) },
            trailingIcon = { Icon(AglynIcons.named("close"), "Clear ${choice.label}", Modifier.size(14.dp)) },
            shape = if (metrics.compact) androidx.compose.foundation.shape.RoundedCornerShape(metrics.controlRadius) else MaterialTheme.shapes.small,
            modifier = Modifier.testTag("$tag-active-${choice.key}"),
          )
        }
      }
    }
    androidx.compose.runtime.CompositionLocalProvider(LocalContentInset provides edge) { content() }
  }
}


/** Which Figma list row a [ScaffoldListRow] is: List/Order row (Regular 64, Phone 68) or List/Site row (62). */
enum class ScaffoldRowKind { ORDER, SITE }

/**
 * A row of the shared list scaffold, Figma-exact (List/Order row 11:329, Phone 11:357; List/Site row 11:370): a 32 tile
 * (radius 8), a one-line title over a one-line detail, and a trailing column (a figure over a status), on a radius-8 fill
 * when selected. Regular: 64 tall, padding 12 / 10, gap 12, 14 over 12 (the site row: 62, 16 / 12, gap 14). Phone: 68,
 * 16 / 12, 17 over 13, the figure 15.
 */
@Composable
fun ScaffoldListRow(
  title: String,
  detail: String?,
  kind: ScaffoldRowKind,
  modifier: Modifier = Modifier,
  selected: Boolean = false,
  leading: @Composable () -> Unit,
  figure: String? = null,
  status: (@Composable () -> Unit)? = null,
  onClick: () -> Unit,
) {
  val phone = currentWidthClass() == WidthClass.COMPACT
  val site = kind == ScaffoldRowKind.SITE
  val height = when { phone -> 68.dp; site -> 62.dp; else -> 64.dp }
  val padH = if (phone || site) 16.dp else 12.dp
  val padV = if (phone || site) 12.dp else 10.dp
  val gap = if (site) 14.dp else 12.dp
  val shape = androidx.compose.foundation.shape.RoundedCornerShape(8.dp)
  val inset = LocalContentInset.current ?: contentInset()
  // The tile and the trailing figure sit on the column's content inset E. In a list column beside its detail the
  // selection is square and the column's whole width (AGL-4012); elsewhere its fill reaches a little past them.
  val square = squareListSelection()
  val outer = if (square) 0.dp else (inset - padH).coerceAtLeast(0.dp)
  val interaction = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }
  Row(
    modifier.fillMaxWidth()
      .then(
        if (square) Modifier.squareRowBox().squareRowGround(selected, interaction)
        else Modifier.padding(horizontal = outer, vertical = 1.dp).clip(shape).background(if (selected) shellColors.selected else Color.Transparent),
      )
      .clickable(interactionSource = interaction, indication = if (square) null else androidx.compose.material3.ripple(), onClick = onClick)
      .heightIn(min = height)
      .then(if (square) Modifier.padding(squareRowPadding(inset)) else Modifier.padding(horizontal = padH))
      .padding(vertical = padV)
      .semantics(mergeDescendants = true) { if (selected) this.selected = true },
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(gap),
  ) {
    leading()
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      // Figma's line heights (14/18 over 12/16; the phone's 17/22 over 13/18), so the row keeps its 64 (68 on a phone).
      Text(title, fontSize = if (phone) 17.sp else 14.sp, lineHeight = if (phone) 22.sp else 18.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface, maxLines = 1, overflow = TextOverflow.Ellipsis)
      detail?.let { Text(it, fontSize = if (phone) 13.sp else 12.sp, lineHeight = if (phone) 18.sp else 16.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis) }
    }
    if (figure != null || status != null) {
      Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        figure?.let { Text(it, fontSize = if (phone) 15.sp else 14.sp, lineHeight = if (phone) 20.sp else 18.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurface, maxLines = 1) }
        status?.invoke()
      }
    }
  }
}

/** The scaffold row's leading tile: 32, radius 8, an icon on the soft fill (or a picture in its place). */
@Composable
fun ScaffoldRowTile(icon: String, imageUrl: String? = null, darkImageUrl: String? = null) {
  BrandPicture(imageUrl, darkImageUrl, 32.dp, androidx.compose.foundation.shape.RoundedCornerShape(8.dp)) {
    // A soft ink wash, so the tile reads on the page ground in light and dark alike (Figma's List row tile).
    Box(Modifier.size(32.dp).clip(androidx.compose.foundation.shape.RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.07f)), contentAlignment = Alignment.Center) {
      Icon(AglynIcons.named(icon), null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}
