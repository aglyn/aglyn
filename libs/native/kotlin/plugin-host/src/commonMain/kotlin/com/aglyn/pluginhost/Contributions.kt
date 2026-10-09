package com.aglyn.pluginhost

import androidx.compose.runtime.Composable
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FirestoreReader
import com.aglyn.core.FirestoreWriter
import com.aglyn.core.NoFirestoreWrites
import com.aglyn.core.KeyValueStore
import com.aglyn.hardware.NoPeripherals
import com.aglyn.hardware.Peripherals

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

/** Where a console path sits: under the picked site, under the workspace, or whole. */
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

  /**
   * Writes the console makes straight to Firestore (no route), made the same
   * way under the same security rules, as the signed-in person.
   */
  val writer: FirestoreWriter get() = NoFirestoreWrites

  /**
   * The device's register peripherals: printers, its own card reader and a
   * HID scanner. The POS shell binds them; elsewhere there are none.
   */
  val peripherals: Peripherals get() = NoPeripherals

  /**
   * Small per-install storage for state that belongs to this device, such as
   * a register's basket surviving a restart. A plugin keys its entries with
   * its own id (`<pluginId>.…`).
   */
  val deviceStore: KeyValueStore

  /**
   * The person's role on the picked site (`admin`, `editor`, `author` or
   * `viewer`), as their membership row names it; null without a site. A
   * screen reads it only to grey out what the rules would refuse.
   */
  val siteRole: String? get() = null

  /** The person's role in the picked workspace (`owner`, `admin`, `editor`, `viewer`). */
  val orgRole: String? get() = null

  /** Makes [hostId] the picked site, as the site switcher does. */
  fun selectSite(hostId: String) {}

  /**
   * The widgets other plugins put in a core page's named slot (`commerceSettings`,
   * `hostAnalytics`), in order. A screen that hosts a slot draws these; core
   * and the host never name the plugins that contribute.
   */
  fun slotWidgets(slot: String): List<NativeWidget> = emptyList()

  /** Opens a registered screen by id. */
  fun navigate(screenId: String, params: NativeParams = emptyMap())

  /** Leaves the current screen, as the back button does. */
  fun back() {}

  /**
   * Opens the Besigner, the apps' only web content, in the authenticated web
   * view inside the app. [path] must be a Besigner page ([BesignerPaths]):
   * any other console page is a native screen, so this refuses it and
   * returns false. [ConsoleScope.SITE] puts the picked site's prefix in front
   * (`/screens/{id}/versions/{v}/besigner`).
   */
  fun openBesigner(path: String, scope: ConsoleScope = ConsoleScope.SITE): Boolean
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
  /**
   * A declared screen whose native version has not landed on this platform:
   * the shell shows a native "coming to the app" state in place of [content],
   * never a console page.
   */
  val upcoming: Boolean = false,
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
  /**
   * A core page's slot it renders in instead of Home, the native twin of the
   * console's `PluginWidgetSlot` (`hostAnalytics` is the Analytics page's).
   */
  val slot: String? = null,
  val content: @Composable (context: NativePluginContext) -> Unit,
) : Contribution

class NativeQuickAction(
  override val pluginId: String,
  override val id: String,
  val title: String,
  val icon: String,
  val order: Int,
  val requiresSite: Boolean = false,
  /** The native screen it opens. */
  val screen: String,
  val params: NativeParams = emptyMap(),
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
