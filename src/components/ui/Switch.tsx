import * as SwitchPrimitive from "@radix-ui/react-switch";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { cn } from "@/utils/cn";

export const Switch = forwardRef<
  ElementRef<typeof SwitchPrimitive.Root>,
  ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-5 w-8 shrink-0 cursor-pointer items-center rounded-full border border-line-strong bg-muted p-[2px] transition-colors duration-100",
      "hover:border-ink-faint",
      "data-[state=checked]:border-brand data-[state=checked]:bg-brand",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none block size-3.5 rounded-full bg-ink-faint transition-transform duration-100",
        "data-[state=checked]:translate-x-3 data-[state=checked]:bg-brand-contrast",
      )}
    />
  </SwitchPrimitive.Root>
));

Switch.displayName = "Switch";
