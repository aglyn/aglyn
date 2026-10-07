package com.aglyn.hardware

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket

/**
 * A network receipt printer on its raw port (TCP 9100, "JetDirect"): the
 * bytes go straight to the socket, and the printer prints as they arrive.
 */
class NetworkReceiptPrinter(
  override val name: String,
  val host: String,
  val port: Int = DEFAULT_PORT,
  private val timeoutMs: Int = 5_000,
) : ReceiptPrinter {
  override val transport = PrinterTransport.NETWORK

  override suspend fun print(bytes: ByteArray): Unit = withContext(Dispatchers.IO) {
    try {
      Socket().use { socket ->
        socket.connect(InetSocketAddress(host, port), timeoutMs)
        socket.soTimeout = timeoutMs
        socket.getOutputStream().apply {
          write(bytes)
          flush()
        }
      }
    } catch (error: IOException) {
      throw PrinterUnavailable("$name did not answer at $host:$port. Check that it is on and on this network.")
    }
  }

  companion object {
    const val DEFAULT_PORT = 9100
  }
}
