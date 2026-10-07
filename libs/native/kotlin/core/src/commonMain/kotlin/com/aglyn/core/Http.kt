package com.aglyn.core

import io.ktor.client.HttpClient

/** The platform's HTTP client: OkHttp on Android, the JDK client on desktop. */
expect fun defaultHttpClient(): HttpClient
