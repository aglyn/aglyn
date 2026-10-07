package com.aglyn.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.getValue
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

data class NavDestination(val key: String, val label: String, val icon: ImageVector)

/**
 * The app's top-level navigation: a bottom bar on phones, a rail on tablets
 * and small desktop windows, and a permanent drawer on large windows.
 */
@Composable
fun AglynNavigationSuite(
  destinations: List<NavDestination>,
  selected: String,
  onSelect: (String) -> Unit,
  modifier: Modifier = Modifier,
  content: @Composable () -> Unit,
) {
  val layout = when (currentWidthClass()) {
    WidthClass.COMPACT -> NavigationSuiteType.NavigationBar
    WidthClass.MEDIUM, WidthClass.EXPANDED -> NavigationSuiteType.NavigationRail
    WidthClass.LARGE -> NavigationSuiteType.NavigationDrawer
  }
  val colors = MaterialTheme.colorScheme
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
 * A list beside its selected item's detail on medium and wider windows, and
 * list then detail (back returns to the list) on phones. Keys are strings so
 * the selection survives configuration changes.
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
  list: @Composable (selected: String?, onSelect: (String) -> Unit) -> Unit,
  detail: @Composable (selected: String?) -> Unit,
) {
  var selected by rememberSaveable(initialSelected) { mutableStateOf(initialSelected) }
  val wide = currentWidthClass() != WidthClass.COMPACT
  if (wide) {
    Row(modifier.fillMaxSize()) {
      Box(Modifier.weight(0.4f).fillMaxHeight()) { list(selected) { selected = it } }
      VerticalDivider()
      Box(Modifier.weight(0.6f).fillMaxHeight()) {
        AnimatedContent(selected, transitionSpec = { fadeIn() togetherWith fadeOut() }) { key -> detail(key) }
      }
    }
  } else {
    BackHandler(enabled = selected != null) { selected = null }
    AnimatedContent(
      selected,
      modifier = modifier.fillMaxSize(),
      transitionSpec = {
        val forward = targetState != null
        (slideInHorizontally { if (forward) it / 4 else -it / 4 } + fadeIn()) togetherWith
          (slideOutHorizontally { if (forward) -it / 4 else it / 4 } + fadeOut())
      },
    ) { key ->
      if (key == null) list(null) { selected = it } else detail(key)
    }
  }
}
