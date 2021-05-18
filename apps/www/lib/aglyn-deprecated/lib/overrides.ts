export { }

declare global {
  interface Array<T> {
    remove(elem: T): Array<T>
  }
}

if (!Array.prototype.remove) {
  Array.prototype.remove = function <T>(this: T[], elem: T): T[] {
    return this.filter(e => e !== elem)
  }
}
