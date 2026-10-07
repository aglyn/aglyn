package com.aglyn.desktop

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.toAwtImage
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.pressKey
import androidx.compose.ui.test.runDesktopComposeUiTest
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.unit.Density
import com.aglyn.hardware.HidBurstDetector
import com.aglyn.hardware.NetworkReceiptPrinter
import com.aglyn.hardware.StaticPeripherals
import com.aglyn.pluginhost.NativeApp
import com.aglyn.plugins.manifest.NativePlugins
import com.aglyn.shell.DesktopShell
import com.aglyn.shell.PosShell
import kotlinx.coroutines.runBlocking
import java.io.File
import java.net.ServerSocket
import javax.imageio.ImageIO
import kotlin.concurrent.thread

/**
 * A development tool, not a test: drives Aglyn POS on the JVM desktop the way
 * a cashier would (pick the store, ring up with taps and a keyboard-wedge
 * scan, take cash, print the receipt over TCP) against the emulator stack and
 * the console named by -Daglyn.*, and writes a PNG of each register screen in
 * light, dark and at text scale 2. A local socket stands in for the receipt
 * printer and keeps the ESC/POS bytes it was sent.
 *
 *   ./gradlew :desktop:posSnapshots -Paglyn.snapshotDir=/path -Paglyn.jvmArgs="-Daglyn.firebaseProjectId=…"
 */
@OptIn(ExperimentalTestApi::class)
fun main() {
  val dir = File(System.getProperty("aglyn.snapshotDir") ?: "build/pos-snapshots").apply { mkdirs() }
  val printed = File(dir, "pos-desktop-receipt.escpos.bin")
  val printer = ServerSocket(0)
  thread(isDaemon = true) {
    while (true) {
      val socket = printer.accept()
      socket.getInputStream().use { printed.writeBytes(it.readBytes()) }
    }
  }
  val services = DesktopShell.services(
    NativeApp.POS,
    DesktopShell.envFromSystem(),
    NativePlugins.entries,
    StaticPeripherals(printers = listOf(NetworkReceiptPrinter("Counter printer", "127.0.0.1", printer.localPort)), hidScanner = HidBurstDetector()),
  )
  runBlocking { services.auth.signInWithEmail(services.debugSignIn!!.first, services.debugSignIn!!.second) }

  var dark by mutableStateOf(false)
  var fontScale by mutableStateOf(1f)
  runDesktopComposeUiTest(2560, 1680) {
    setContent {
      CompositionLocalProvider(LocalDensity provides Density(2f, fontScale)) {
        PosShell(services, dark = dark)
      }
    }
    fun shot(name: String) {
      waitForIdle()
      Thread.sleep(600)
      waitForIdle()
      // The window and any dialog above it are separate roots: layer them as the screen shows them.
      val layers = onAllNodes(isRoot()).fetchSemanticsNodes().indices.map { onAllNodes(isRoot())[it].captureToImage().toAwtImage() }
      val frame = java.awt.image.BufferedImage(layers[0].getWidth(null), layers[0].getHeight(null), java.awt.image.BufferedImage.TYPE_INT_ARGB)
      frame.createGraphics().apply { layers.forEach { drawImage(it, 0, 0, null) }; dispose() }
      ImageIO.write(frame, "png", File(dir, "$name.png"))
      println("wrote $name.png")
    }
    if (waitFor(hasText("Choose the store"), 4_000)) click(hasText("Demo Site"))
    waitFor(hasText("Butter croissant"))
    shot("pos-desktop-register")
    fontScale = 2f
    shot("pos-desktop-register-fontscale2")
    fontScale = 1f

    click(hasText("Latte"))
    waitFor(hasText("Milk · Required"))
    shot("pos-desktop-item-sheet")
    click(hasText("Oat milk", substring = true))
    click(hasText("Large", substring = true))
    click(hasText("Add ·", substring = true))

    // A keyboard-wedge scanner: the croissant's barcode typed in a burst, then Enter.
    onAllNodes(isRoot())[0].performKeyInput {
      val digits = listOf(Key.Zero, Key.One, Key.Two, Key.Three, Key.Four, Key.Five, Key.Six, Key.Seven, Key.Eight, Key.Nine)
      for (digit in "0012345678905") pressKey(digits[digit - '0'])
      pressKey(Key.Enter)
    }
    waitFor(hasText("Butter croissant") and hasText("Butter croissant"))
    click(hasText("Drip coffee"))
    click(hasText("10% off"))
    shot("pos-desktop-basket")

    onAll(hasSetTextAction())[0].performTextInput("sour")
    waitFor(hasText("Sourdough loaf"))
    shot("pos-desktop-search")
    onAll(hasContentDescription("Clear search"))[0].performClick()

    click(hasText("Charge"))
    waitFor(hasText("Checkout"))
    click(hasText("18%", substring = true))
    shot("pos-desktop-checkout")
    click(hasText("Cash"))
    click(hasText("Exact", substring = true))
    shot("pos-desktop-cash")
    click(hasText("in cash", substring = true))
    waitFor(hasText("Paid"))
    waitFor(hasText("Order #", substring = true))
    shot("pos-desktop-receipt")
    click(hasText("Print"))
    waitFor(hasText("Tap a product to start a sale"), 8_000)
    repeat(50) { if (printed.length() == 0L) Thread.sleep(100) }
    println("printer received ${printed.length()} bytes")

    click(hasContentDescription("Card readers"))
    waitFor(hasText("Smart readers"))
    shot("pos-desktop-card-readers")
    click(hasContentDescription("Today's bookings"))
    waitFor(hasText("Take payment"))
    shot("pos-desktop-counter-bookings")
    // Bookings, then the readers: back twice to the register.
    click(hasContentDescription("Back"))
    click(hasContentDescription("Back"))

    dark = true
    waitFor(hasText("Butter croissant"))
    shot("pos-desktop-register-dark")
    click(hasContentDescription("Card readers"))
    waitFor(hasText("Smart readers"))
    shot("pos-desktop-card-readers-dark")
  }
  System.exit(0)
}

@OptIn(ExperimentalTestApi::class)
private fun ComposeUiTest.onAll(matcher: SemanticsMatcher) = onAllNodes(matcher)

@OptIn(ExperimentalTestApi::class)
private fun ComposeUiTest.waitFor(matcher: SemanticsMatcher, timeoutMs: Long = 20_000): Boolean = runCatching {
  waitUntil(timeoutMillis = timeoutMs) { onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty() }
}.isSuccess

@OptIn(ExperimentalTestApi::class)
private fun ComposeUiTest.click(matcher: SemanticsMatcher) {
  waitFor(matcher)
  // A click by semantics: a node in a dialog's own window takes no injected mouse input.
  onAllNodes(matcher and androidx.compose.ui.test.hasClickAction())[0].performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick)
  waitForIdle()
}
