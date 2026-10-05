/** Splits a byte stream's text into lines (CRLF or LF); flush() emits the tail. */
export class LineSplitter {
  private buf = ''

  constructor(private readonly onLine: (l: string) => void) {}

  push(chunk: string): void {
    this.buf += chunk
    let i: number
    while ((i = this.buf.indexOf('\n')) !== -1) {
      this.onLine(this.buf.slice(0, i).replace(/\r$/, ''))
      this.buf = this.buf.slice(i + 1)
    }
  }

  flush(): void {
    if (this.buf) this.onLine(this.buf.replace(/\r$/, ''))
    this.buf = ''
  }
}
