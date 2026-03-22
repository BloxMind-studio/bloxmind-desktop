import { vi } from "vitest";

export class LazyStore {
  private data = new Map<string, unknown>();

  get = vi.fn(async <T>(key: string): Promise<T | undefined> => {
    return this.data.get(key) as T | undefined;
  });

  set = vi.fn(async (key: string, value: unknown): Promise<void> => {
    this.data.set(key, value);
  });

  delete = vi.fn(async (key: string): Promise<boolean> => {
    return this.data.delete(key);
  });
}
