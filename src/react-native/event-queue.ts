/**
 * Buffers device-side events until the DevTools panel connects, then
 * forwards them in order. Lets the hook capture traffic from the first
 * render even when DevTools is opened much later.
 */
export class EventQueue<TEventMap extends Record<string, unknown>> {
  private queue: Array<{ type: keyof TEventMap; payload: TEventMap[keyof TEventMap] }> = [];
  private sink: (<K extends keyof TEventMap>(type: K, payload: TEventMap[K]) => void) | null =
    null;

  constructor(private readonly maxSize = 1000) {}

  connect(sink: <K extends keyof TEventMap>(type: K, payload: TEventMap[K]) => void): void {
    this.sink = sink;
    const pending = this.queue;
    this.queue = [];
    for (const message of pending) {
      sink(message.type, message.payload);
    }
  }

  disconnect(): void {
    this.sink = null;
  }

  isConnected(): boolean {
    return this.sink !== null;
  }

  send<K extends keyof TEventMap>(type: K, payload: TEventMap[K]): void {
    if (this.sink) {
      this.sink(type, payload);
      return;
    }
    if (this.queue.length >= this.maxSize) {
      this.queue.shift();
    }
    this.queue.push({ type, payload });
  }

  clear(): void {
    this.queue = [];
  }

  size(): number {
    return this.queue.length;
  }
}
