package com.aglyn.shell

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.runDesktopComposeUiTest
import com.aglyn.pluginhost.NativeApp
import com.aglyn.pluginhost.NativePluginRegistry
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.AglynTheme
import com.aglyn.ui.CloseWhenGone
import com.aglyn.ui.ListHeader
import com.aglyn.ui.LocalListDetailSelection
import androidx.compose.ui.test.performScrollToNode
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** The phone list-detail after a delete, its banners and its saved panes (AGL-3851 D1, D3, D6, D7). */
@OptIn(ExperimentalTestApi::class)
class ListDetailUiTest {
  @Test
  fun aDeletedItemClosesItsDetailAndTellsTheList() = runDesktopComposeUiTest(width = 400, height = 800) {
    val rows = mutableStateListOf("a", "b")
    var removed = 0
    var notice by mutableStateOf<String?>(null)
    setContent {
      AglynTheme(dark = false) {
        AglynListDetail(
          onItemRemoved = { removed++ },
          detailBanner = { notice?.let { Text(it, Modifier.testTag("banner")) } },
          list = { _, onSelect ->
            Column(Modifier.testTag("list")) { rows.forEach { id -> Button(onClick = { onSelect(id) }, Modifier.testTag("row-$id")) { Text(id) } } }
          },
          detail = { selected ->
            CloseWhenGone(selected?.let { it in rows })
            if (selected in rows) {
              Button(onClick = { notice = "Deleted $selected"; rows.remove(selected) }, Modifier.testTag("delete")) { Text("Delete") }
            } else {
              Text("This item is gone", Modifier.testTag("gone"))
            }
          },
        )
      }
    }
    onNodeWithTag("row-a").performClick()
    waitForIdle()
    onNodeWithTag("delete").assertIsDisplayed()
    // An action's notice shows above the detail on a phone, where the list is hidden.
    notice = "Saved"
    waitForIdle()
    onNodeWithTag("banner").assertIsDisplayed()
    onNodeWithTag("delete").performClick()
    waitForIdle()
    // Back on the list, without the deleted row, and the list was told to reload.
    onNodeWithTag("list").assertIsDisplayed()
    assertEquals(0, onAllNodesWithTagCount("row-a"))
    assertEquals(1, removed)
  }

  @Test
  fun aLinkToAnItemThatWasNeverThereKeepsItsGoneDetail() = runDesktopComposeUiTest(width = 400, height = 800) {
    var removed = 0
    setContent {
      AglynTheme(dark = false) {
        AglynListDetail(
          initialSelected = "missing",
          onItemRemoved = { removed++ },
          list = { _, _ -> Text("list", Modifier.testTag("list")) },
          detail = { selected ->
            CloseWhenGone(selected?.let { false })
            Text("This item is gone", Modifier.testTag("gone"))
          },
        )
      }
    }
    waitForIdle()
    onNodeWithTag("gone").assertIsDisplayed()
    assertEquals(0, removed)
  }

  @Test
  fun theListKeepsItsScrollWhileThePhoneShowsADetail() = runDesktopComposeUiTest(width = 400, height = 600) {
    val ids = (1..60).map { "r$it" }
    setContent {
      AglynTheme(dark = false) {
        AglynListDetail(
          list = { _, onSelect ->
            val state = rememberLazyListState()
            LazyColumn(Modifier.testTag("list"), state = state) {
              items(ids, key = { it }) { id -> Button(onClick = { onSelect(id) }, Modifier.testTag("row-$id")) { Text(id) } }
            }
          },
          detail = { selected ->
            val selection = LocalListDetailSelection.current
            Button(onClick = { selection?.close() }, Modifier.testTag("detail")) { Text("Detail $selected") }
          },
        )
      }
    }
    onNodeWithTag("list").performScrollToNode(androidx.compose.ui.test.hasTestTag("row-r50"))
    onNodeWithTag("row-r50").performClick()
    waitForIdle()
    onNodeWithTag("detail").assertIsDisplayed()
    // Back to the list: it returns where it was.
    onNodeWithTag("detail").performClick()
    waitForIdle()
    onNodeWithTag("row-r50").assertIsDisplayed()
  }

  @Test
  fun aListHeaderTitleIsNotSqueezedByItsActions() = runDesktopComposeUiTest(width = 360, height = 400) {
    setContent {
      AglynTheme(dark = false) {
        ListHeader("Saved templates", Modifier.testTag("header")) {
          Button(onClick = {}) { Text("From a template") }
          Button(onClick = {}) { Text("New template") }
        }
      }
    }
    onNodeWithText("Saved templates").assertIsDisplayed()
    val title = onNodeWithText("Saved templates").fetchSemanticsNode()
    val layouts = mutableListOf<androidx.compose.ui.text.TextLayoutResult>()
    title.config[androidx.compose.ui.semantics.SemanticsActions.GetTextLayoutResult].action?.invoke(layouts)
    assertFalse(layouts.first().hasVisualOverflow, "the title is cut short")
  }

  @Test
  fun eachStackEntryHasItsOwnStateKeyAndAPoppedOneIsDropped() {
    val navigator = ShellNavigator()
    navigator.select(ShellNavigator.screenKey("site.sites"))
    navigator.push(Route.Screen("site.content", mapOf("host" to "h1")))
    val keys = navigator.keys
    assertEquals(2, keys.size)
    assertFalse(ShellNavigator.isPushedKey(keys[0]))
    assertTrue(ShellNavigator.isPushedKey(keys[1]))
    assertEquals(keys[1], navigator.currentKey)
    navigator.back()
    assertEquals(keys[0], navigator.currentKey)
    // Two destinations never share a key, so one never shows the state of the one before it (Deals after Contacts).
    navigator.select(ShellNavigator.screenKey("crm.deals"))
    assertTrue(navigator.currentKey != keys[0])
  }

  @Test
  fun appsListTabsThenParamlessActionsOnePerScreen() {
    val registry = NativePluginRegistry()
    val r = registry.registrarFor("commerce")
    r.screen("commerce.orders", title = "Orders") { _, _ -> }
    r.screen("commerce.products", title = "Products") { _, _ -> }
    r.screen("commerce.product", title = "Product") { _, _ -> }
    r.tab("commerce.orders-tab", title = "Orders", icon = "receipt", screen = "commerce.orders", order = 100)
    r.tab("commerce.products-tab", title = "Products", icon = "inventory", screen = "commerce.products", order = 110)
    r.quickAction("commerce.orders-to-ship", "Ship orders", "local_shipping", 100, screen = "commerce.orders")
    r.quickAction("commerce.new-product", "New product", "add", 110, screen = "commerce.product", params = mapOf("new" to "1"))
    val places = shellPlaces(registry, NativeApp.AGLYN)
    assertEquals(listOf("commerce.orders-tab", "commerce.products-tab"), places.map { it.id })
  }
}

@OptIn(ExperimentalTestApi::class)
private fun androidx.compose.ui.test.ComposeUiTest.onAllNodesWithTagCount(tag: String): Int =
  onAllNodes(androidx.compose.ui.test.hasTestTag(tag)).fetchSemanticsNodes().size
