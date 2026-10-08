package com.aglyn.webview.webview2

import com.sun.jna.Callback
import com.sun.jna.CallbackReference
import com.sun.jna.Function
import com.sun.jna.Library
import com.sun.jna.Memory
import com.sun.jna.Native
import com.sun.jna.Pointer
import com.sun.jna.Structure
import com.sun.jna.WString
import com.sun.jna.ptr.PointerByReference
import java.util.Collections

/*
 * The slice of COM the WebView2 host needs, over plain JNA: calling a method
 * by its vtable slot, and handing WebView2 a callback object of our own. The
 * slots are the order of each interface's C vtable in the WebView2 SDK's
 * WebView2.h (Microsoft.Web.WebView2 1.0.4258.31); WebView2 only ever appends
 * to an interface, so a slot never moves.
 */

internal const val S_OK = 0
internal const val E_NOINTERFACE = 0x80004002.toInt()
internal const val E_FAIL = 0x80004005.toInt()

class ComException(val hresult: Int, call: String) : RuntimeException("$call failed (0x${hresult.toUInt().toString(16)})")

internal fun Int.check(call: String) {
  if (this < 0) throw ComException(this, call)
}

/** The 16 bytes of a GUID as `{8-4-4-4-12}` text names it, in memory order. */
fun guidBytes(text: String): ByteArray {
  val hex = text.trim('{', '}').split('-')
  require(hex.size == 5 && hex.map { it.length } == listOf(8, 4, 4, 4, 12)) { "not a GUID: $text" }
  fun le(value: String, bytes: Int) = ByteArray(bytes) { i -> (value.toLong(16) ushr (8 * i)).toByte() }
  val tail = (hex[3] + hex[4]).chunked(2).map { it.toInt(16).toByte() }
  return le(hex[0], 4) + le(hex[1], 2) + le(hex[2], 2) + tail.toByteArray()
}

internal val IID_IUNKNOWN = guidBytes("00000000-0000-0000-C000-000000000046")

/** An interface pointer we hold: calls by vtable slot, released once. */
internal class ComRef(val pointer: Pointer) {
  private fun function(slot: Int): Function =
    Function.getFunction(pointer.getPointer(0).getPointer(slot.toLong() * Native.POINTER_SIZE), Function.C_CONVENTION)

  fun call(slot: Int, vararg args: Any?): Int = function(slot).invokeInt(arrayOf<Any?>(pointer, *args))

  /** Calls a getter that answers an interface pointer. */
  fun get(slot: Int, name: String): ComRef {
    val out = PointerByReference()
    call(slot, out).check(name)
    return ComRef(out.value ?: throw ComException(E_FAIL, name))
  }

  /** Calls a getter that answers a CoTaskMem string, and frees it. */
  fun string(slot: Int, name: String): String? {
    val out = PointerByReference()
    call(slot, out).check(name)
    return out.value?.let { text -> text.getWideString(0).also { Ole32.INSTANCE.CoTaskMemFree(text) } }
  }

  fun queryInterface(iid: ByteArray): ComRef? {
    val out = PointerByReference()
    val guid = Memory(16).apply { write(0, iid, 0, 16) }
    return if (call(0, guid, out) == S_OK) out.value?.let(::ComRef) else null
  }

  fun release() {
    call(2)
  }
}

internal interface Ole32 : Library {
  fun CoInitializeEx(reserved: Pointer?, coInit: Int): Int
  fun CoTaskMemFree(memory: Pointer?)

  companion object {
    const val COINIT_APARTMENTTHREADED = 0x2
    val INSTANCE: Ole32 by lazy { Native.load("ole32", Ole32::class.java) }
  }
}

/** A Win32 RECT, passed by value to ICoreWebView2Controller::put_Bounds. */
@Structure.FieldOrder("left", "top", "right", "bottom")
class Rect(@JvmField var left: Int = 0, @JvmField var top: Int = 0, @JvmField var right: Int = 0, @JvmField var bottom: Int = 0) :
  Structure(), Structure.ByValue

/** WebView2's EventRegistrationToken: 8 bytes the add_ call fills and remove_ takes back. */
internal fun eventToken(): Memory = Memory(8).apply { setLong(0, 0) }

internal fun wide(text: String) = WString(text)

private interface QueryInterfaceFn : Callback { fun invoke(self: Pointer, riid: Pointer, out: Pointer): Int }
private interface RefCountFn : Callback { fun invoke(self: Pointer): Int }
private interface ResultInvokeFn : Callback { fun invoke(self: Pointer, hresult: Int, result: Pointer?): Int }
private interface EventInvokeFn : Callback { fun invoke(self: Pointer, sender: Pointer?, args: Pointer?): Int }

/** Keeps every callback object and its vtable alive as long as WebView2 may call it. */
private val alive: MutableSet<Any> = Collections.synchronizedSet(mutableSetOf())

/**
 * A COM object of our own, for one of WebView2's handler interfaces: its
 * vtable is QueryInterface, AddRef, Release and Invoke. WebView2 holds it
 * for the life of the view, so it lives as long as the process.
 */
private fun handlerObject(iid: ByteArray, invoke: Callback): Pointer {
  val self = Memory(Native.POINTER_SIZE.toLong())
  val queryInterface = object : QueryInterfaceFn {
    override fun invoke(self: Pointer, riid: Pointer, out: Pointer): Int {
      val asked = riid.getByteArray(0, 16)
      return if (asked.contentEquals(iid) || asked.contentEquals(IID_IUNKNOWN)) {
        out.setPointer(0, self)
        S_OK
      } else {
        out.setPointer(0, null)
        E_NOINTERFACE
      }
    }
  }
  val refCount = object : RefCountFn {
    override fun invoke(self: Pointer): Int = 1
  }
  val vtable = Memory(4L * Native.POINTER_SIZE)
  listOf(queryInterface, refCount, refCount, invoke).forEachIndexed { slot, callback ->
    vtable.setPointer(slot.toLong() * Native.POINTER_SIZE, CallbackReference.getFunctionPointer(callback))
  }
  self.setPointer(0, vtable)
  alive.addAll(listOf(self, vtable, queryInterface, refCount, invoke))
  return self
}

/** A completed-handler: Invoke(HRESULT, result). */
internal fun resultHandler(iid: String, onResult: (hresult: Int, result: Pointer?) -> Unit): Pointer =
  handlerObject(
    guidBytes(iid),
    object : ResultInvokeFn {
      override fun invoke(self: Pointer, hresult: Int, result: Pointer?): Int {
        runCatching { onResult(hresult, result) }
        return S_OK
      }
    },
  )

/** An event handler: Invoke(sender, args). */
internal fun eventHandler(iid: String, onEvent: (args: ComRef) -> Unit): Pointer =
  handlerObject(
    guidBytes(iid),
    object : EventInvokeFn {
      override fun invoke(self: Pointer, sender: Pointer?, args: Pointer?): Int {
        if (args != null) runCatching { onEvent(ComRef(args)) }
        return S_OK
      }
    },
  )
