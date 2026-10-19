package com.aglyn.core

import io.ktor.client.HttpClient
import io.ktor.client.engine.java.Java

/**
 * The desktop's HTTP client (the JDK's). HTTP/1.1: with HTTP/2 the JDK asks a plain-http server to upgrade to h2c on every
 * request, and Node's server (the console in development, and any http origin) answers that by closing the connection,
 * so every console call and every image failed with "header parser received no bytes" on a local stack. Production is
 * https either way.
 */
actual fun defaultHttpClient(): HttpClient = HttpClient(Java) {
  expectSuccess = false
  engine { protocolVersion = java.net.http.HttpClient.Version.HTTP_1_1 }
}
