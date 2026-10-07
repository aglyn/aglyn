package com.aglyn.hardware

/** A receipt printer the register can send ESC/POS bytes to. */
interface ReceiptPrinter {
  val name: String
  suspend fun print(bytes: ByteArray)
}

/** The peripherals a register has; empty until a platform binds real ones. */
interface Peripherals {
  val printers: List<ReceiptPrinter>
}

object NoPeripherals : Peripherals {
  override val printers: List<ReceiptPrinter> = emptyList()
}
