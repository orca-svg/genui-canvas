import { MessageProcessor } from "@a2ui/web_core/v0_9";
import { basicCatalog, type ReactComponentImplementation } from "@a2ui/react/v0_9";

/** MessageProcessor specialized to the React component implementation. */
export type A2uiProcessor = MessageProcessor<ReactComponentImplementation>;

/** The A2UI v0.9 message array shape the processor accepts. */
export type A2uiMessages = Parameters<A2uiProcessor["processMessages"]>[0];

/**
 * Build a MessageProcessor over the built-in primitive catalog and feed it a
 * batch of A2UI messages. Approach A: our domain look is composed from these
 * primitives by the server's expand.ts, so the renderer stays domain-agnostic.
 */
export function createProcessor(messages: A2uiMessages): A2uiProcessor {
  const processor = new MessageProcessor<ReactComponentImplementation>([basicCatalog]);
  processor.processMessages(messages);
  return processor;
}
