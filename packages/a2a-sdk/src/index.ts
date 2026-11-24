import { JsonRpcA2AAdapter } from "./adapters/jsonrpc";
import { MockA2AAdapter } from "./adapters/mock-a2a";
import { A2ARegistry } from "./registry";

export * from "./types";
export * from "./registry";
export * from "./call";
export * from "./adapters/jsonrpc";
export * from "./adapters/mock-a2a";

/**
 * The A2A client adapters every runtime starts with: the JSON-RPC binding over HTTP(S), and the in-process mock agent
 * (`mock-a2a://…`) samples and tests use. New transports are registered here.
 */
export function createDefaultA2ARegistry(): A2ARegistry {
  return new A2ARegistry().register(new JsonRpcA2AAdapter()).register(new MockA2AAdapter());
}
