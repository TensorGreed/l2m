import type { A2AClientAdapter } from "./types";

/** The adapters remote agents are called through, picked by card URL (first registered first). */
export class A2ARegistry {
  private readonly adapters: A2AClientAdapter[] = [];

  register(adapter: A2AClientAdapter): this {
    if (this.adapters.some((entry) => entry.id === adapter.id)) {
      throw new Error(`An A2A adapter with id '${adapter.id}' is already registered.`);
    }
    this.adapters.push(adapter);
    return this;
  }

  get(id: string): A2AClientAdapter | undefined {
    return this.adapters.find((adapter) => adapter.id === id);
  }

  list(): string[] {
    return this.adapters.map((adapter) => adapter.id);
  }

  /** The adapter that calls agents at `cardUrl`, or undefined when none does. */
  resolve(cardUrl: string): A2AClientAdapter | undefined {
    return this.adapters.find((adapter) => adapter.handles(cardUrl));
  }
}
