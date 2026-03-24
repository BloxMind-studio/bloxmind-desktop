export class LazyStore {
  private data: Record<string, unknown> = {};
  async get<T>(key: string): Promise<T | undefined> {
    return this.data[key] as T | undefined;
  }
  async set(key: string, value: unknown): Promise<void> {
    this.data[key] = value;
  }
}
