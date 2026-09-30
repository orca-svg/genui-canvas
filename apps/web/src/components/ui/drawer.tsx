import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Base UI Drawer with the app's tokens: a non-modal side panel or bottom sheet. */
export const Drawer = DrawerPrimitive.Root;
export const DrawerTrigger = DrawerPrimitive.Trigger;
export const DrawerClose = DrawerPrimitive.Close;
export const DrawerTitle = DrawerPrimitive.Title;
export const DrawerDescription = DrawerPrimitive.Description;

export function DrawerContent({ className, children, ...props }: ComponentProps<typeof DrawerPrimitive.Popup>) {
  return (
    <DrawerPrimitive.Portal>
      <DrawerPrimitive.Viewport className="drawer-viewport">
        <DrawerPrimitive.Popup className={cn("edge-drawer", className)} {...props}>
          <DrawerPrimitive.Content className="edge-drawer__content">{children}</DrawerPrimitive.Content>
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </DrawerPrimitive.Portal>
  );
}
