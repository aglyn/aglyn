package com.aglyn.core

import com.sun.jna.Library
import com.sun.jna.Memory
import com.sun.jna.Native
import com.sun.jna.Pointer
import com.sun.jna.Structure
import com.sun.jna.WString
import com.sun.jna.ptr.PointerByReference

/**
 * Where the desktop app keeps a secret between launches (the session's
 * refresh token). Windows keeps it in Credential Manager; elsewhere (a macOS
 * or Linux development run) it lives in memory for the process only.
 */
interface CredentialStore {
  fun read(key: String): String?
  fun write(key: String, secret: String)
  fun delete(key: String)
}

/** A store that forgets on exit. */
class InMemoryCredentialStore : CredentialStore {
  private val secrets = java.util.concurrent.ConcurrentHashMap<String, String>()
  override fun read(key: String): String? = secrets[key]
  override fun write(key: String, secret: String) {
    secrets[key] = secret
  }
  override fun delete(key: String) {
    secrets.remove(key)
  }
}

object CredentialStores {
  /**
   * Windows Credential Manager on Windows; in memory anywhere else, or when
   * Credential Manager cannot be loaded.
   */
  fun forOs(
    osName: String = System.getProperty("os.name").orEmpty(),
    windows: () -> CredentialStore = ::WindowsCredentialStore,
  ): CredentialStore {
    if (!osName.startsWith("Windows", ignoreCase = true)) return InMemoryCredentialStore()
    return runCatching(windows).getOrElse {
      System.err.println("Aglyn: Credential Manager is unavailable (${it.message}); the session is kept in memory")
      InMemoryCredentialStore()
    }
  }
}

/**
 * Windows Credential Manager through Advapi32 (`CredWriteW`, `CredReadW`,
 * `CredDeleteW`, `CredFree`): a generic credential per key, persisted for the
 * signed-in Windows user on this computer (`CRED_PERSIST_LOCAL_MACHINE`, not
 * `CRED_PERSIST_ENTERPRISE`, so it does not roam with a domain profile).
 */
class WindowsCredentialStore : CredentialStore {
  private val advapi: CredApi = Native.load("Advapi32", CredApi::class.java)

  override fun read(key: String): String? {
    val out = PointerByReference()
    if (!advapi.CredReadW(WString(key), CRED_TYPE_GENERIC, 0, out)) return null
    val pointer = out.value ?: return null
    return try {
      val credential = Credential(pointer).apply { read() }
      val blob = credential.CredentialBlob ?: return null
      String(blob.getByteArray(0, credential.CredentialBlobSize), Charsets.UTF_8)
    } finally {
      advapi.CredFree(pointer)
    }
  }

  override fun write(key: String, secret: String) {
    val bytes = secret.toByteArray(Charsets.UTF_8)
    require(bytes.size <= CRED_MAX_CREDENTIAL_BLOB_SIZE) { "The secret is longer than Credential Manager holds." }
    val blob = Memory(bytes.size.toLong().coerceAtLeast(1)).apply { write(0, bytes, 0, bytes.size) }
    val credential = Credential().apply {
      Type = CRED_TYPE_GENERIC
      TargetName = WString(key)
      CredentialBlobSize = bytes.size
      CredentialBlob = blob
      Persist = CRED_PERSIST_LOCAL_MACHINE
      UserName = WString("Aglyn")
    }
    credential.write()
    check(advapi.CredWriteW(credential, 0)) { "CredWriteW failed: ${Native.getLastError()}" }
    blob.clear()
  }

  override fun delete(key: String) {
    advapi.CredDeleteW(WString(key), CRED_TYPE_GENERIC, 0)
  }

  @Suppress("FunctionName")
  private interface CredApi : Library {
    fun CredReadW(target: WString, type: Int, flags: Int, credential: PointerByReference): Boolean
    fun CredWriteW(credential: Credential, flags: Int): Boolean
    fun CredDeleteW(target: WString, type: Int, flags: Int): Boolean
    fun CredFree(buffer: Pointer)
  }

  /** `CREDENTIALW`; `LastWritten` (a FILETIME) is its two DWORD halves. */
  @Suppress("PropertyName")
  @Structure.FieldOrder(
    "Flags", "Type", "TargetName", "Comment", "LastWrittenLow", "LastWrittenHigh", "CredentialBlobSize",
    "CredentialBlob", "Persist", "AttributeCount", "Attributes", "TargetAlias", "UserName",
  )
  class Credential() : Structure() {
    constructor(pointer: Pointer) : this() {
      useMemory(pointer)
    }

    @JvmField var Flags: Int = 0
    @JvmField var Type: Int = 0
    @JvmField var TargetName: WString? = null
    @JvmField var Comment: WString? = null
    @JvmField var LastWrittenLow: Int = 0
    @JvmField var LastWrittenHigh: Int = 0
    @JvmField var CredentialBlobSize: Int = 0
    @JvmField var CredentialBlob: Pointer? = null
    @JvmField var Persist: Int = 0
    @JvmField var AttributeCount: Int = 0
    @JvmField var Attributes: Pointer? = null
    @JvmField var TargetAlias: WString? = null
    @JvmField var UserName: WString? = null
  }

  private companion object {
    const val CRED_TYPE_GENERIC = 1
    /** This Windows user on this computer, across logons. */
    const val CRED_PERSIST_LOCAL_MACHINE = 2
    const val CRED_MAX_CREDENTIAL_BLOB_SIZE = 5 * 512
  }
}
