import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delay={400} closeDelay={80}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

/** Wraps one trigger element; `label` is decorative help (the trigger keeps its own aria-label). */
export function Tooltip({ label, children, className }: { label: string; children: ReactElement; className?: string }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger render={children} />
      <TooltipPrimitive.Portal>
        {/* Above the card list drawer (z-index 50) and its handle (51). */}
        <TooltipPrimitive.Positioner sideOffset={6} className="z-[60]">
          <TooltipPrimitive.Popup className={cn("rounded-md bg-foreground px-2 py-1 text-xs text-background shadow", className)}>
            {label}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
