package com.aglyn.desktop

import androidx.compose.runtime.Composable
import androidx.compose.ui.ImageComposeScene
import androidx.compose.ui.unit.Density
import androidx.compose.ui.use
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlin.system.exitProcess

/** The argument `:desktop:launchCheck` passes to the packaged launcher. */
const val LAUNCH_CHECK_ARG = "--launch-check"

/**
 * Proves the PACKAGED app starts: run inside the bundled jlink runtime, with
 * the services already built by `main` (the HTTP client, auth, the plugin
 * manifest), it renders the shell offscreen for a couple of seconds and exits
 * 0. Anything the runtime lacks (a JDK module, a native library) throws on the
 * way and exits 1, which fails the Gradle task before a package is made.
 * Offscreen, so the check opens no window.
 */
fun launchCheck(app: String, content: @Composable () -> Unit): Nothing {
  val ok = try {
    runBlocking {
      withContext(Dispatchers.Main) {
        ImageComposeScene(640, 480, Density(1f), coroutineContext = coroutineContext) { content() }.use { scene ->
          val start = System.nanoTime()
          while (System.nanoTime() - start < 2_000_000_000L) {
            scene.render(System.nanoTime() - start)
            delay(100)
          }
        }
      }
    }
    true
  } catch (t: Throwable) {
    System.err.println("$app launch check failed:")
    t.printStackTrace()
    false
  }
  println(if (ok) "$app launch check: started" else "$app launch check: FAILED")
  System.out.flush()
  exitProcess(if (ok) 0 else 1)
}
