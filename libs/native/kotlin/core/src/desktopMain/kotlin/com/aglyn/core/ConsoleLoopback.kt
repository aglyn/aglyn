package com.aglyn.core

import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import java.net.InetAddress
import java.net.InetSocketAddress

/**
 * The desktop's way back from the console (AGL-3816), as RFC 8252 asks of an installed app: a listener on the loopback
 * address on a port chosen for this sign-in, the console page opened in the system browser with that address as its return,
 * and the return URL answered once the page hands the code back. The code alone is useless: redeeming it takes the PKCE
 * verifier this process holds.
 */
class ConsoleLoopback(
  /** Opens a URL in the system browser. */
  private val openBrowser: (String) -> Unit,
  private val timeoutMillis: Long = 10 * 60 * 1000,
) : ConsoleHandoffTransport {
  override suspend fun run(page: (redirectUri: String) -> String): String {
    val result = CompletableDeferred<String>()
    val server = HttpServer.create(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0)
    server.createContext("/handoff") { exchange ->
      val body = PAGE.toByteArray()
      exchange.responseHeaders.add("Content-Type", "text/html; charset=utf-8")
      exchange.responseHeaders.add("Cache-Control", "no-store")
      exchange.sendResponseHeaders(200, body.size.toLong())
      exchange.responseBody.use { it.write(body) }
      val query = exchange.requestURI.rawQuery.orEmpty()
      if ("code=" in query) result.complete("${ConsoleHandoff.loopbackRedirectUri(server.address.port)}?$query")
    }
    server.start()
    try {
      openBrowser(page(ConsoleHandoff.loopbackRedirectUri(server.address.port)))
      return try {
        withTimeout(timeoutMillis) { result.await() }
      } catch (error: TimeoutCancellationException) {
        throw AuthError("Signing in in the browser timed out. Try again.", error)
      }
    } finally {
      server.stop(0)
    }
  }

  private companion object {
    const val PAGE = "<!doctype html><meta charset=utf-8><title>Signed in</title>" +
      "<body style=\"font-family:system-ui;margin:3rem\"><h1>You can close this window</h1><p>Return to the app to finish.</p>"
  }
}
