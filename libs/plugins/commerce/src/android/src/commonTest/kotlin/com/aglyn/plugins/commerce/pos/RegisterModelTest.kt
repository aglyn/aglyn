package com.aglyn.plugins.commerce.pos

import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestorePage
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.InMemoryKeyValueStore
import com.aglyn.core.Live
import com.aglyn.hardware.CardReaderSession
import com.aglyn.hardware.CardReaderSessionSource
import com.aglyn.hardware.NoPeripherals
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

private object EmptyReader : FirestoreReader {
  override suspend fun get(path: String): FirestoreDoc? = null
  override suspend fun page(query: FirestoreQuery) = FirestorePage(emptyList(), null)
  override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = emptyFlow()
  override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = emptyFlow()
}

@OptIn(ExperimentalCoroutinesApi::class)
class RegisterModelTest {
  private fun model(api: ScriptedSaleApi, scope: CoroutineScope) = RegisterModel(
    hostId = "h1",
    firestore = EmptyReader,
    api = api,
    terminal = CardReaderSessionSource { error("no card reader in this test") },
    deviceStore = InMemoryKeyValueStore(),
    peripherals = NoPeripherals,
    scope = scope,
    reconnectMs = 1_000,
  )

  @Test
  fun aRegisterWhoseFirstReadWasLostAsksAgainAndComesBackOnline() = runTest {
    val api = ScriptedSaleApi()
    api.answer("context", lost())
    val register = model(api, backgroundScope)
    register.start()
    testScheduler.runCurrent()
    assertFalse(register.online, "the lost first read marks the register offline")
    assertEquals(1, api.contextCalls)

    testScheduler.advanceTimeBy(1_100)
    testScheduler.runCurrent()
    assertTrue(register.online, "the next beat reaches the console and the banner clears")
    assertEquals(2, api.contextCalls)
    assertTrue(register.context != null)

    // An online register does not keep asking.
    testScheduler.advanceTimeBy(5_000)
    testScheduler.runCurrent()
    assertEquals(2, api.contextCalls)
  }

  @Test
  fun retryAsksAtOnceWithoutWaitingForTheBeat() = runTest {
    val api = ScriptedSaleApi()
    api.answer("context", lost())
    val register = model(api, backgroundScope)
    register.start()
    testScheduler.runCurrent()
    assertFalse(register.online)

    register.reconnect()
    testScheduler.runCurrent()
    assertTrue(register.online)
    assertEquals(2, api.contextCalls)
  }

  @Test
  fun aRefusalIsNotAnOutage() = runTest {
    val api = ScriptedSaleApi()
    api.answer("context", refused("Forbidden", 403))
    val register = model(api, backgroundScope)
    register.start()
    testScheduler.runCurrent()
    assertTrue(register.online, "the console answered, so the register is not offline")
  }
}
