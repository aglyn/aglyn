package com.aglyn.core

import com.google.firebase.auth.FirebaseAuth
import java.lang.reflect.Field
import java.lang.reflect.Modifier

/**
 * Aims this instance back at the project pool once nobody is signed in to the tenant it was aimed at (AGL-3844); see
 * [returnToProjectPool]. The Android SDK offers no public way back (`setTenantId` refuses an empty value).
 */
internal fun FirebaseAuth.returnToProjectPool(): Boolean =
  returnToProjectPool(currentTenant = { tenantId }, slots = stringSlots(this, FirebaseAuth::class.java))

/** Every non-static, non-final `String` field [owner] declares, read and written on [target]. */
internal fun stringSlots(target: Any, owner: Class<*>): List<InstanceSlot> =
  owner.declaredFields
    .filter { it.type == String::class.java && !Modifier.isStatic(it.modifiers) && !Modifier.isFinal(it.modifiers) }
    .mapNotNull { field -> runCatching { field.isAccessible = true }.getOrNull()?.let { FieldSlot(target, field) } }

private class FieldSlot(private val target: Any, private val field: Field) : InstanceSlot {
  override fun read(): Any? = field.get(target)
  override fun write(value: Any?) = field.set(target, value)
}
