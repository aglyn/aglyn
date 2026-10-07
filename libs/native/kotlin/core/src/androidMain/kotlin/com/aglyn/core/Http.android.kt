package com.aglyn.core

import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp

actual fun defaultHttpClient(): HttpClient = HttpClient(OkHttp) { expectSuccess = false }
