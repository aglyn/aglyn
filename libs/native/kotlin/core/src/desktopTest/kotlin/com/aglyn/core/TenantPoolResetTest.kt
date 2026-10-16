package com.aglyn.core

import java.lang.reflect.Modifier
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * After signing out of a single sign-on account, the next sign-in starts on the project pool (AGL-3844).
 *
 * [FakeAuth] is shaped like the Firebase Android SDK's instance: the tenant sits in an obfuscated private field next to other
 * private strings, its setter refuses an empty value, and its getter reads the field. The slots are built by reflection the way
 * the Android binding builds them, so the field is found by its value, never by its name.
 */
class TenantPoolResetTest {
  @Suppress("unused")
  private class FakeAuth(language: String?, tenant: String?, private val lock: Any = Any()) {
    private var zzk: String? = language
    private var zzm: String? = tenant
    private var zzaa: String? = "aglyn-project"
    val tenantId: String? get() = zzm
    fun setTenantId(value: String) {
      require(value.isNotEmpty())
      zzm = value
    }
  }

  private fun slots(target: Any): List<InstanceSlot> =
    target.javaClass.declaredFields
      .filter { it.type == String::class.java && !Modifier.isStatic(it.modifiers) && !Modifier.isFinal(it.modifiers) }
      .map { field ->
        field.isAccessible = true
        object : InstanceSlot {
          override fun read(): Any? = field.get(target)
          override fun write(value: Any?) = field.set(target, value)
        }
      }

  private fun fields(target: Any): Map<String, Any?> =
    listOf("zzk", "zzm", "zzaa").associateWith { name ->
      target.javaClass.getDeclaredField(name).apply { isAccessible = true }.get(target)
    }

  @Test
  fun `clears the tenant an SSO hand-off left on the instance`() {
    val auth = FakeAuth(language = "en", tenant = "aglyn-org-y5v14")
    assertTrue(returnToProjectPool({ auth.tenantId }, slots(auth)))
    assertNull(auth.tenantId)
  }

  @Test
  fun `leaves every other field alone`() {
    val auth = FakeAuth(language = "en", tenant = "aglyn-org-y5v14")
    returnToProjectPool({ auth.tenantId }, slots(auth))
    assertEquals(mapOf("zzk" to "en", "zzm" to null, "zzaa" to "aglyn-project"), fields(auth))
  }

  @Test
  fun `is a no-op on the project pool`() {
    val auth = FakeAuth(language = "en", tenant = null)
    assertTrue(returnToProjectPool({ auth.tenantId }, slots(auth)))
    assertEquals(mapOf("zzk" to "en", "zzm" to null, "zzaa" to "aglyn-project"), fields(auth))
  }

  @Test
  fun `a later SSO sign-in can aim at a tenant again`() {
    val auth = FakeAuth(language = "en", tenant = "aglyn-org-1")
    returnToProjectPool({ auth.tenantId }, slots(auth))
    auth.setTenantId("aglyn-org-2")
    assertEquals("aglyn-org-2", auth.tenantId)
  }

  @Test
  fun `changes nothing when more than one field holds the tenant`() {
    // The language happens to equal the tenant: which field is the tenant is no longer knowable.
    val auth = FakeAuth(language = "same", tenant = "same")
    assertFalse(returnToProjectPool({ auth.tenantId }, slots(auth)))
    assertEquals("same", auth.tenantId)
    assertEquals(mapOf("zzk" to "same", "zzm" to "same", "zzaa" to "aglyn-project"), fields(auth))
  }

  @Test
  fun `changes nothing when no field holds the tenant`() {
    val auth = FakeAuth(language = "en", tenant = "aglyn-org-1")
    assertFalse(returnToProjectPool({ "a-tenant-kept-elsewhere" }, slots(auth)))
    assertEquals("aglyn-org-1", auth.tenantId)
  }

  @Test
  fun `restores the field when the instance still reports the tenant`() {
    val auth = FakeAuth(language = "en", tenant = "aglyn-org-1")
    // A getter that does not read the field it matched: clearing it did not move the instance.
    assertFalse(returnToProjectPool({ "aglyn-org-1" }, slots(auth)))
    assertEquals("aglyn-org-1", auth.tenantId)
  }
}
