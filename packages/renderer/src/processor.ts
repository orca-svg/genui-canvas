import { MessageProcessor } from "@a2ui/web_core/v0_9";
import { basicCatalog, type ReactComponentImplementation } from "@a2ui/react/v0_9";

/** MessageProcessor specialized to the React component implementation. */
export type A2uiProcessor = MessageProcessor<ReactComponentImplementation>;

/** The A2UI v0.9 message array shape the processor accepts. */
export type A2uiMessages = Parameters<A2uiProcessor["processMessages"]>[0];

/** An action raised by a server-composed Button, as delivered by A2UI. */
export interface CanvasActionEvent {
  name: string;
  surfaceId: string;
  sourceComponentId: string;
  context: Record<string, unknown>;
}
export type CanvasActionHandler = (action: CanvasActionEvent) => void;

/**
 * Build a MessageProcessor over the built-in primitive catalog and feed it a
 * batch of A2UI messages. The optional handler receives every user action from
 * every surface; the shell validates it against its own action contract.
 */
export function createProcessor(messages: A2uiMessages, onAction?: CanvasActionHandler): A2uiProcessor {
  const processor = new MessageProcessor<ReactComponentImplementation>(
    [basicCatalog],
    onAction
      ? (action) => {
          onAction({
            name: action.name,
            surfaceId: action.surfaceId,
            sourceComponentId: action.sourceComponentId,
            context: { ...action.context },
          });
        }
      : undefined,
  );
  processor.processMessages(messages);
  return processor;
}
