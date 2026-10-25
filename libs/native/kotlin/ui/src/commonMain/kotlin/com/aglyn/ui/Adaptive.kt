package com.aglyn.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.PermanentDrawerSheet
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.layout.layout
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.VerticalDivider
import androidx.compose.foundation.layout.height
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.runtime.getValue
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.backhandler.BackHandler
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.NavigationDrawerItemDefaults
import androidx.compose.material3.NavigationRailItemDefaults
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfo
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteType
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.platform.testTag

/**
 * The narrowest pane that holds a list beside its detail (a 320dp list and a 400dp detail). Narrower, as on a
 * 7-inch tablet held upright or a medium window beside the drawer, the list fills the pane and the detail opens
 * over it, as on a phone, instead of squeezing the list to a column of clipped words.
 */
val TwoPaneMinWidth: Dp = 720.dp

/** The window's width class, by the Material breakpoints (600 / 840 / 1200 dp). */
enum class WidthClass { COMPACT, MEDIUM, EXPANDED, LARGE }

@Composable
fun currentWidthClass(): WidthClass {
  val size = currentWindowAdaptiveInfo().windowSizeClass
  return when {
    size.isWidthAtLeastBreakpoint(1200) -> WidthClass.LARGE
    size.isWidthAtLeastBreakpoint(840) -> WidthClass.EXPANDED
    size.isWidthAtLeastBreakpoint(600) -> WidthClass.MEDIUM
    else -> WidthClass.COMPACT
  }
}

/** [section] titles the group a destination opens in the permanent drawer (null continues the previous group). */
data class NavDestination(val key: String, val label: String, val icon: ImageVector, val section: String? = null)

/**
 * The app's top-level navigation: a bottom bar on phones, a rail on medium
 * windows, and a permanent labelled drawer (header, sections, footer) from
 * expanded (840dp) upward.
 */
@Composable
fun AglynNavigationSuite(
  destinations: List<NavDestination>,
  selected: String,
  onSelect: (String) -> Unit,
  modifier: Modifier = Modifier,
  /** Pinned at the top of the permanent drawer (EXPANDED and wider), above the rows. */
  drawerHeader: @Composable () -> Unit = {},
  /** Shown at the foot of the permanent drawer: the workspace and site, opening the switcher. */
  drawerFooter: @Composable () -> Unit = {},
  content: @Composable () -> Unit,
) {
  val widthClass = currentWidthClass()
  val colors = MaterialTheme.colorScheme
  if (widthClass == WidthClass.EXPANDED || widthClass == WidthClass.LARGE) {
    Row(modifier.fillMaxSize().testTag("nav-drawer")) {
      PermanentDrawerSheet(Modifier.width(280.dp), drawerContainerColor = colors.surfaceContainerLow) {
        Column(Modifier.fillMaxHeight()) {
          // The lockup is pinned at the top above a divider and the rows scroll in the space below it, so no row ever
          // passes under it; the switcher stays put at the foot the same way.
          drawerHeader()
          HorizontalDivider()
          Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            Column(Modifier.padding(horizontal = 12.dp).padding(bottom = 12.dp)) {
              for (destination in destinations) {
                destination.section?.let {
                  if (it.isEmpty()) {
                    HorizontalDivider(Modifier.padding(horizontal = 16.dp, vertical = 12.dp))
                  } else {
                    Text(
                      it,
                      Modifier.padding(start = 16.dp, top = 20.dp, bottom = 8.dp).semantics { heading() },
                      style = MaterialTheme.typography.titleSmall,
                      color = colors.onSurfaceVariant,
                      maxLines = 1,
                      overflow = TextOverflow.Ellipsis,
                    )
                  }
                }
                val isSelected = destination.key == selected
                NavigationDrawerItem(
                  modifier = Modifier.height(56.dp).testTag("nav-${destination.key}"),
                  selected = isSelected,
                  onClick = { onSelect(destination.key) },
                  icon = { Icon(destination.icon, contentDescription = null) },
                  label = {
                    Text(
                      destination.label,
                      maxLines = 1,
                      overflow = TextOverflow.Ellipsis,
                      fontWeight = if (isSelected) FontWeight.SemiBold else null,
                    )
                  },
                  colors = NavigationDrawerItemDefaults.colors(
                    unselectedContainerColor = Color.Transparent,
                    selectedContainerColor = colors.primaryContainer,
                    selectedIconColor = colors.onPrimaryContainer,
                    selectedTextColor = colors.onPrimaryContainer,
                    unselectedIconColor = colors.onSurfaceVariant,
                    unselectedTextColor = colors.onSurface,
                  ),
                )
              }
            }
          }
          HorizontalDivider()
          drawerFooter()
        }
      }
      Box(Modifier.weight(1f).fillMaxHeight()) { content() }
    }
    return
  }
  val layout = if (widthClass == WidthClass.COMPACT) NavigationSuiteType.NavigationBar else NavigationSuiteType.NavigationRail
  // Selection reads in the brand primary, as the console's own navigation does.
  val itemColors = NavigationSuiteDefaults.itemColors(
    navigationBarItemColors = NavigationBarItemDefaults.colors(
      indicatorColor = colors.primaryContainer,
      selectedIconColor = colors.onPrimaryContainer,
      selectedTextColor = colors.onPrimaryContainer,
    ),
    navigationRailItemColors = NavigationRailItemDefaults.colors(
      indicatorColor = colors.primaryContainer,
      selectedIconColor = colors.onPrimaryContainer,
      selectedTextColor = colors.onPrimaryContainer,
    ),
    navigationDrawerItemColors = NavigationDrawerItemDefaults.colors(
      selectedContainerColor = colors.primaryContainer,
      selectedIconColor = colors.onPrimaryContainer,
      selectedTextColor = colors.onPrimaryContainer,
    ),
  )
  NavigationSuiteScaffold(
    modifier = modifier,
    layoutType = layout,
    navigationSuiteItems = {
      for (destination in destinations) {
        item(
          modifier = Modifier.testTag("nav-${destination.key}"),
          selected = destination.key == selected,
          onClick = { onSelect(destination.key) },
          icon = { Icon(destination.icon, contentDescription = null) },
          label = { Text(destination.label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
          colors = itemColors,
        )
      }
    },
    content = content,
  )
}

/**
 * What a list-detail's detail may do to its own selection, from inside it
 * ([LocalListDetailSelection]): the detail of a deleted item closes itself, so
 * a phone returns to the list instead of standing on "This … is gone".
 */
@Stable
class ListDetailSelection internal constructor(private val clear: () -> Unit, private val onRemoved: () -> Unit) {
  /** Clears the selection: a phone shows the list again, a wide window its empty detail. */
  fun close() = clear()

  /** The selected item is gone: the selection clears and the list is told, so a list read once reloads without it. */
  fun removed() {
    clear()
    onRemoved()
  }
}

/** The nearest [AglynListDetail]'s selection; null outside one (a detail opened as a screen of its own). */
val LocalListDetailSelection = compositionLocalOf<ListDetailSelection?> { null }

/**
 * Closes the detail once the item it shows, having been there, is no longer
 * (deleted here, or elsewhere while it was open): [present] is whether it is
 * there, null while that is still loading. An item that was never there (a
 * link to a deleted one) keeps its "gone" detail rather than closing at once.
 */
@Composable
fun CloseWhenGone(present: Boolean?) {
  val selection = LocalListDetailSelection.current ?: return
  var seen by remember { mutableStateOf(false) }
  LaunchedEffect(present) {
    when (present) {
      true -> seen = true
      false -> if (seen) selection.removed()
      null -> Unit
    }
  }
}

/**
 * A list beside its selected item's detail when the pane is at least
 * [TwoPaneMinWidth] wide, and list then detail (back returns to the list)
 * when it is narrower, as on phones. Keys are strings so
 * the selection survives configuration changes, and the list keeps its scroll
 * position and filters while a phone shows the detail.
 *
 * [detailBanner] is what the screen reports in its list column (an action's
 * error or notice): a phone, which hides the list behind the detail, shows it
 * above the detail too. [onItemRemoved] runs when the detail closes itself
 * because its item is gone ([CloseWhenGone], [ListDetailSelection.removed]).
 *
 * Built on the window size class rather than ListDetailPaneScaffold: the
 * JVM desktop build of material3-adaptive 1.3.0 does not ship the navigable
 * scaffold, and one implementation serves both targets.
 */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun AglynListDetail(
  modifier: Modifier = Modifier,
  /** The item picked on arrival, as when a link or a notification names one. */
  initialSelected: String? = null,
  onItemRemoved: () -> Unit = {},
  detailBanner: @Composable () -> Unit = {},
  list: @Composable (selected: String?, onSelect: (String) -> Unit) -> Unit,
  detail: @Composable (selected: String?) -> Unit,
) {
  val selection = rememberSaveable(initialSelected) { mutableStateOf(initialSelected) }
  var selected by selection
  val removed by rememberUpdatedState(onItemRemoved)
  val handle = remember(selection) { ListDetailSelection(clear = { selection.value = null }, onRemoved = { removed() }) }
  val panes = rememberSaveableStateHolder()
  CompositionLocalProvider(LocalListDetailSelection provides handle) {
    BoxWithConstraints(modifier.fillMaxSize()) {
      if (maxWidth >= TwoPaneMinWidth) {
        // The shell's breadcrumbs head the detail column, as Figma draws a list beside its detail.
        val crumbs = LocalPageCrumbs.current
        if (crumbs != null) {
          androidx.compose.runtime.DisposableEffect(crumbs) {
            crumbs.claimed = true
            onDispose { crumbs.claimed = false }
          }
        }
        // One edge E per column. A list pane and a detail pane each pad their own content by 16 (DetailPanePadding), so
        // the column adds the rest; the list's own rows read the 16 that is left (LocalContentInset).
        val edge = contentInset()
        val extra = (edge - DetailPanePadding).coerceAtLeast(0.dp)
        // Inside the shell's content area the outer edges are already brought in; only the edges at the divider are left.
        val body = LocalBodyInset.current != null
        Row(Modifier.fillMaxSize()) {
          // The list column's content sits on E as before; a selectable row reaches back over the column's own inset (and
          // the shell's) so its selection fills the column's whole width, edge to hairline (AGL-4012, ListColumnBleed).
          val bleed = ListColumnBleed(start = if (body) LocalBodyInset.current ?: 0.dp else extra, end = extra)
          Box(Modifier.weight(0.4f).fillMaxHeight().testTag("list-column").padding(start = if (body) 0.dp else extra, end = extra)) {
            CompositionLocalProvider(LocalContentInset provides DetailPanePadding, LocalListColumn provides bleed) {
              panes.SaveableStateProvider("list") { list(selected) { selected = it } }
            }
          }
          VerticalDivider()
          Column(Modifier.weight(0.6f).fillMaxHeight().padding(start = if (body) extra else 0.dp)) {
            crumbs?.crumbs?.invoke()
            AnimatedContent(
              selected,
              modifier = Modifier.weight(1f).fillMaxWidth().padding(horizontal = if (body) 0.dp else extra),
              transitionSpec = { fadeIn() togetherWith fadeOut() },
            ) { key ->
              CompositionLocalProvider(LocalContentInset provides null, LocalDetailPane provides true) { panes.SaveableStateProvider("detail:$key") { detail(key) } }
            }
          }
        }
      } else {
        BackHandler(enabled = selected != null) { selected = null }
        AnimatedContent(
          selected,
          modifier = Modifier.fillMaxSize(),
          transitionSpec = {
            val forward = targetState != null
            (slideInHorizontally { if (forward) it / 4 else -it / 4 } + fadeIn()) togetherWith
              (slideOutHorizontally { if (forward) -it / 4 else it / 4 } + fadeOut())
          },
        ) { key ->
          val edge = contentInset()
          val extra = if (LocalBodyInset.current != null) 0.dp else (edge - DetailPanePadding).coerceAtLeast(0.dp)
          if (key == null) {
            Box(Modifier.fillMaxSize().padding(horizontal = extra)) {
              CompositionLocalProvider(LocalContentInset provides DetailPanePadding) { panes.SaveableStateProvider("list") { list(null) { selected = it } } }
            }
          } else {
            panes.SaveableStateProvider("detail:$key") {
              Column(Modifier.fillMaxSize()) {
                Column(Modifier.padding(horizontal = extra + DetailPanePadding).testTag("list-detail-banner"), verticalArrangement = Arrangement.spacedBy(space(1f))) { detailBanner() }
                Box(Modifier.weight(1f).fillMaxWidth().padding(horizontal = extra)) {
                  CompositionLocalProvider(LocalDetailPane provides true) { detail(key) }
                }
              }
            }
          }
        }
      }
    }
  }
}

/**
 * The one content inset E (Zach 2026-10-19, and Apple's AglynContentInsets): in every column, list and detail alike, the
 * crumbs, the title, the search and Filter row, list rows' leading icons, section heads and cards start E in from the
 * column's edges; a row's trailing ends at width − E, and separators run exactly from E to width − E. 32 on the desktop
 * (Compact), 24 on a tablet (Touch), 16 on a phone.
 */
@Composable
fun contentInset(): Dp = when {
  LocalShellMetrics.current.compact -> 32.dp
  currentWidthClass() == WidthClass.COMPACT -> 16.dp
  else -> 24.dp
}

/**
 * Set by a column that lays out a full-bleed list (a list pane, a list screen's body): the inset its rows put their
 * leading and trailing edges on. Null inside a pane that pads its own content, where a row keeps its own small inset.
 */
val LocalContentInset = androidx.compose.runtime.compositionLocalOf<Dp?> { null }

/** How far a list column's rows reach past its content on each side to meet the column's edges. */
data class ListColumnBleed(val start: Dp, val end: Dp)

/**
 * Set inside a tablet or desktop list column beside its detail: its rows select with the square fill across the column's
 * whole width, reaching past the column's inset by this much. Null elsewhere.
 */
val LocalListColumn = androidx.compose.runtime.compositionLocalOf<ListColumnBleed?> { null }

/** Lays this out wider by [start] and [end], reaching over its parent's insets on both sides (a full-width row). */
internal fun Modifier.bleed(start: Dp, end: Dp): Modifier = if (start <= 0.dp && end <= 0.dp) this else layout { measurable, constraints ->
  val lead = start.roundToPx()
  val trail = end.roundToPx()
  val placeable = measurable.measure(
    constraints.copy(
      minWidth = constraints.minWidth + lead + trail,
      maxWidth = if (constraints.hasBoundedWidth) constraints.maxWidth + lead + trail else constraints.maxWidth,
    ),
  )
  layout(placeable.width - lead - trail, placeable.height) { placeable.placeRelative(-lead, 0) }
}

/** What a detail pane pads its own content by (`space(2f)`); the two-pane column adds E minus this. */
val DetailPanePadding: Dp = 16.dp

/**
 * Set by the shell around a screen: how far it has already brought the screen in from the content area's edges (E − 16),
 * so a screen that pads its content by 16 (LocalContentInset) lands on E. Null outside the shell's content area.
 */
val LocalBodyInset = androidx.compose.runtime.compositionLocalOf<Dp?> { null }

/** True inside a list-detail's detail pane, whose column already brings its content to E. */
val LocalDetailPane = androidx.compose.runtime.compositionLocalOf { false }

/** A screen's horizontal padding: E for a screen of its own, 16 in a detail pane (its column adds the rest). */
@Composable
fun paneInset(): Dp = if (LocalDetailPane.current) DetailPanePadding else LocalContentInset.current ?: contentInset()

/** A padded pane's horizontal padding: E, the column's content inset. */
@Composable
fun Modifier.contentEdges(vertical: Dp = 0.dp): Modifier = padding(horizontal = contentInset(), vertical = vertical)
