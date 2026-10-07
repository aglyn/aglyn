package com.aglyn.pluginhost

import androidx.compose.runtime.Composable
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FirestoreReader

/** Route parameters, as navigation and deep links carry them. */
typealias NativeParams = Map<String, String>

/** The apps a contribution appears in. The POS shell shows only `POS` ones. */
enum class NativeApp { AGLYN, POS }

/** Where a POS contribution sits in the register. */
enum class PosPlacement { REGISTER, TENDER, PERIPHERAL, MENU }

enum class WidgetSize { HALF, FULL }

/** The five contribution kinds, by the names `plugins.config.json` declares them under. */
enum class ContributionKind(val wire: String) {
  SCREENS("screens"),
  TABS("tabs"),
  WIDGETS("widgets"),
  QUICK_ACTIONS("quickActions"),
  DEEP_LINKS("deepLinks"),
}

enum class ConsoleScope { SITE, ORG, ABSOLUTE }

/**
 * What a plugin's screen, widget or action is given: the workspace and site
 * the person picked, a reader under the console's rules, the console API, and
 * navigation. `hostId` is null until a site is picked; a contribution that
 * needs one says `requiresSite`.
 */
interface NativePluginContext {
  val uid: String
  val orgId: String?
  val hostId: String?
  /** The console's URL slugs for the same pick (`/{orgSlug}/hosts/{hostSlug}`). */
  val orgSlug: String?
  val hostSlug: String?
  val firestore: FirestoreReader
  val api: ConsoleApiClient

  /** Opens a registered screen by id. */
  fun navigate(screenId: String, params: NativeParams = emptyMap())

  /**
   * Opens a console path in the authenticated console view (the long tail).
   * [ConsoleScope.SITE] and [ConsoleScope.ORG] put the picked site's or
   * workspace's prefix in front, so a plugin names its own page (`/redirects`).
   */
  fun openConsolePath(path: String, scope: ConsoleScope = ConsoleScope.ABSOLUTE)
}

/** How a screen lays out on wide windows. */
enum class ScreenLayout {
  /** One pane at every size. */
  SINGLE,
  /** A list beside the selected item's detail on medium and expanded widths. */
  LIST_DETAIL,
}

sealed interface Contribution {
  val pluginId: String
  val id: String
  val apps: Set<NativeApp>
}

class NativeScreen(
  override val pluginId: String,
  override val id: String,
  val title: String,
  val requiresSite: Boolean = false,
  override val apps: Set<NativeApp> = setOf(NativeApp.AGLYN),
  val icon: String? = null,
  val layout: ScreenLayout = ScreenLayout.SINGLE,
  val placement: PosPlacement? = null,
  val content: @Composable (context: NativePluginContext, params: NativeParams) -> Unit,
) : Contribution

class NativeTab(
  override val pluginId: String,
  override val id: String,
  val title: String,
  /** A Material Symbols name, e.g. `alt_route`. */
  val icon: String,
  val screen: String,
  /** Lower first. The shell's own Home is 0 and Settings is 1000. */
  val order: Int,
  override val apps: Set<NativeApp> = setOf(NativeApp.AGLYN),
) : Contribution

class NativeWidget(
  override val pluginId: String,
  override val id: String,
  val title: String,
  val order: Int,
  val size: WidgetSize = WidgetSize.FULL,
  val requiresSite: Boolean = false,
  override val apps: Set<NativeApp> = setOf(NativeApp.AGLYN),
  val content: @Composable (context: NativePluginContext) -> Unit,
) : Contribution

class NativeQuickAction(
  override val pluginId: String,
  override val id: String,
  val title: String,
  val icon: String,
  val order: Int,
  val requiresSite: Boolean = false,
  /** Opens this screen... */
  val screen: String? = null,
  val params: NativeParams = emptyMap(),
  /** ...or this console path. Exactly one of the two. */
  val consolePath: String? = null,
  override val apps: Set<NativeApp> = setOf(NativeApp.AGLYN),
) : Contribution

class NativeDeepLink(
  override val pluginId: String,
  override val id: String,
  /** A console path pattern, e.g. `/redirects/:redirectId`, after the org/site prefix. */
  val path: String,
  val screen: String,
) : Contribution {
  override val apps: Set<NativeApp> = NativeApp.entries.toSet()
}

/**
 * A plugin's declaration as `plugins.config.json` states it: the ids it
 * registers, keyed by kind as the config names it (`screens`, `quickActions`…).
 */
typealias ContributionDeclaration = Map<String, List<String>>

/** One row of the generated native plugin manifest. */
class NativePluginManifestEntry(
  val id: String,
  val contributes: ContributionDeclaration,
  val register: (NativePluginRegistrar) -> Unit,
)
