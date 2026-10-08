package com.aglyn.shell

import com.aglyn.ui.ImageLoader
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.statement.readRawBytes
import io.ktor.http.isSuccess

/** Remote images (media thumbnails, a site's icon) over the app's HTTP client. */
class HttpImageLoader(private val http: HttpClient) : ImageLoader {
  override suspend fun load(url: String): ByteArray? {
    val response = http.get(url)
    return if (response.status.isSuccess()) response.readRawBytes() else null
  }
}
