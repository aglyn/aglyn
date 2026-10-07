package com.aglyn.core

import io.ktor.client.HttpClient
import io.ktor.client.engine.java.Java

actual fun defaultHttpClient(): HttpClient = HttpClient(Java) { expectSuccess = false }
