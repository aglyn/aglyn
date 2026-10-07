package com.aglyn.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.backhandler.BackHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aglyn.core.AuthState
import com.aglyn.core.WorkspaceSite
import com.aglyn.core.WorkspaceState
import com.aglyn.pluginhost.ConsoleScope
import com.aglyn.pluginhost.NativeApp
import com.aglyn.pluginhost.PosPlacement
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.AglynLogo
import com.aglyn.ui.AglynTheme
import com.aglyn.ui.EmptyState
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.space
import kotlinx.coroutines.launch

/** Roles that may ring up a sale; the routes hold the rest (`managePos`, the `pos` entitlement). */
fun sitesThatCanSell(sites: List<WorkspaceSite>): List<WorkspaceSite> =
  sites.filter { it.role == "admin" || it.role == "editor" }

internal fun posStoreKey(uid: String) = "aglyn.pos.store.$uid"

/**
 * The "Aglyn POS" app: sign-in, the store this device sells for (remembered
 * per person), then the register. The register is the POS-placement screens
 * plugins contribute (`apps` names POS); the shell names none of them.
 */
@Composable
fun PosShell(services: ShellServices, autoSignIn: Boolean = false) {
  AglynTheme {
    val auth by services.auth.state.collectAsState()
    when (val state = auth) {
      AuthState.Restoring -> Loading()
      AuthState.SignedOut -> SignInScreen(services, autoSignIn)
      is AuthState.SignedIn -> PosSignedIn(services, state.user.uid)
    }
  }
}

@Composable
private fun PosSignedIn(services: ShellServices, uid: String) {
  androidx.compose.runtime.LaunchedEffect(uid) { services.push.register(uid) }
  val workspace by services.workspace.state.collectAsState()
  var confirmed by remember(uid) { mutableStateOf(services.prefs.get(posStoreKey(uid))) }
  val scope = rememberCoroutineScope()
  val site = workspace.site
  val sellable = site != null && sitesThatCanSell(listOf(site)).isNotEmpty()

  when {
    !workspace.ready -> Loading()
    site == null || !sellable || confirmed != site.id -> StorePicker(
      services,
      workspace,
      onChosen = { chosen ->
        services.workspace.selectSite(chosen.id)
        services.prefs.set(posStoreKey(uid), chosen.id)
        confirmed = chosen.id
      },
      onSignOut = { scope.launch { services.signOut() } },
    )
    else -> Till(services, uid, workspace) {
      services.prefs.set(posStoreKey(uid), null)
      confirmed = null
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun StorePicker(
  services: ShellServices,
  workspace: WorkspaceState,
  onChosen: (WorkspaceSite) -> Unit,
  onSignOut: () -> Unit,
) {
  val sellable = sitesThatCanSell(workspace.sites)
  Scaffold(
    containerColor = MaterialTheme.colorScheme.background,
    topBar = {
      TopAppBar(
        title = { AglynLogo(Modifier.height(28.dp), contentDescription = "${services.config.brandName} POS") },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
      )
    },
  ) { padding ->
    Box(Modifier.padding(padding).fillMaxSize(), contentAlignment = Alignment.TopCenter) {
      Column(Modifier.widthIn(max = 640.dp).fillMaxWidth()) {
        Column(Modifier.padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
          Text("Choose the store", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
          Text(
            "This device rings up sales for the store you pick here.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
          workspace.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
        if (workspace.orgs.size > 1) {
          Row(
            Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = space(2f)),
            horizontalArrangement = Arrangement.spacedBy(space(1f)),
          ) {
            for (org in workspace.orgs) {
              FilterChip(
                selected = org.id == workspace.org?.id,
                onClick = { services.workspace.selectOrg(org.id) },
                label = { Text(org.name) },
              )
            }
          }
        }
        if (!workspace.ready) {
          SkeletonList(rows = 3)
        } else if (sellable.isEmpty()) {
          EmptyState(
            "No store you can sell on",
            body = "Ask the workspace owner for the Admin or Editor role on a site with Point of sale.",
            icon = AglynIcons.named("storefront"),
            action = { OutlinedButton(onClick = onSignOut) { Text("Sign out") } },
          )
        } else {
          LazyColumn {
            items(sellable, key = { it.id }) { store ->
              AglynListItem(
                title = store.name,
                supporting = store.subdomain.ifEmpty { null },
                icon = AglynIcons.named("storefront"),
                selected = store.id == workspace.site?.id,
                trailing = { Icon(AglynIcons.named("chevron_right"), null) },
                onClick = { onChosen(store) },
                modifier = Modifier.testTag("store-${store.id}"),
              )
            }
          }
        }
      }
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalComposeUiApi::class)
@Composable
private fun Till(services: ShellServices, uid: String, workspace: WorkspaceState, onSwitchStore: () -> Unit) {
  val navigator = remember { ShellNavigator() }
  val version by services.registry.version.collectAsState()
  val register = remember(version) {
    services.registry.screens(NativeApp.POS).firstOrNull { it.placement == PosPlacement.REGISTER }
  }
  // Screens a plugin puts in the register's menu (counter bookings, readers…).
  val menu = remember(version) {
    services.registry.screens(NativeApp.POS).filter { it.placement == PosPlacement.MENU }
  }
  val context = ShellPluginContext(uid, workspace, services, navigator, emptySet())
  val scope = rememberCoroutineScope()
  BackHandler(enabled = navigator.stack.isNotEmpty()) { navigator.back() }
  val route = navigator.current
  Scaffold(
    containerColor = MaterialTheme.colorScheme.background,
    topBar = {
      TopAppBar(
        title = {
          Column {
            Text(workspace.site?.name ?: "", style = MaterialTheme.typography.titleLarge)
            Text(
              when (route) {
                is Route.Console -> "Console"
                is Route.Screen -> services.registry.screen(route.screenId)?.title ?: "Register"
                else -> "Register"
              },
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }
        },
        navigationIcon = {
          if (route != null) {
            IconButton(onClick = { navigator.back() }) { Icon(AglynIcons.named("arrow_back"), contentDescription = "Back") }
          }
        },
        actions = {
          for (screen in menu) {
            val open = (route as? Route.Screen)?.screenId == screen.id
            IconButton(
              onClick = { if (open) navigator.back() else navigator.push(Route.Screen(screen.id)) },
              modifier = Modifier.testTag("pos-menu-${screen.id}"),
            ) {
              Icon(
                AglynIcons.named(screen.icon),
                contentDescription = screen.title,
                tint = if (open) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
              )
            }
          }
          IconButton(onClick = onSwitchStore, modifier = Modifier.testTag("switch-store")) {
            Icon(AglynIcons.named("storefront"), contentDescription = "Switch store")
          }
          IconButton(onClick = { scope.launch { services.signOut() } }) {
            Icon(AglynIcons.named("logout"), contentDescription = "Sign out")
          }
        },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
      )
    },
  ) { padding ->
    Box(Modifier.padding(padding).fillMaxSize()) {
      when {
        route is Route.Console -> services.console(route.path) { navigator.back() }
        route is Route.Screen -> PluginScreenHost(services, context, route.screenId, route.params, true) { navigator.back() }
        register != null -> register.content(context, emptyMap())
        else -> EmptyState(
          "The register opens here",
          body = "Ring up sales in the console's register on this device until the native register is installed.",
          icon = AglynIcons.named("point_of_sale"),
          action = {
            OutlinedButton(onClick = { context.openConsolePath("/pos", ConsoleScope.SITE) }, Modifier.testTag("open-console-register")) {
              Text("Open the register")
            }
          },
          modifier = Modifier.testTag("register-placeholder"),
        )
      }
    }
  }
}
