import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/utils/cn";

const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] border font-medium transition-[background-color,border-color,color,box-shadow] duration-100 disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "border-transparent bg-brand text-brand-contrast hover:bg-brand-strong active:bg-brand-strong",
        secondary:
          "border-line bg-surface text-ink shadow-[0_1px_1px_rgb(var(--shadow-color)/0.03)] hover:border-line-strong hover:bg-muted",
        ghost:
          "border-transparent bg-transparent text-ink-muted hover:bg-muted hover:text-ink",
        outline:
          "border-line bg-transparent text-ink hover:border-line-strong hover:bg-muted",
        danger:
          "border-danger/20 bg-danger-soft text-danger hover:border-danger/35",
        link: "border-transparent bg-transparent p-0 text-ink underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-7 px-2.5 text-xs [&_svg]:size-3.5",
        md: "h-8 px-3 text-[12.5px] [&_svg]:size-3.5",
        lg: "h-9 px-3.5 text-[13px] [&_svg]:size-4",
        icon: "size-8 p-0 [&_svg]:size-4",
        iconSm: "size-7 rounded-md p-0 [&_svg]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, type = "button", ...props },
    ref,
  ) => {
    const Component = asChild ? Slot : "button";
    return (
      <Component
        ref={ref}
        type={asChild ? undefined : type}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
