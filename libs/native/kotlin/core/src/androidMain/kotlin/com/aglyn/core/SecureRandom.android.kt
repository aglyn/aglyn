package com.aglyn.core

private val generator = java.security.SecureRandom()

actual fun secureRandomBytes(count: Int): ByteArray = ByteArray(count).also(generator::nextBytes)
