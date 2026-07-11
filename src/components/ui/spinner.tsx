import { cn } from "@/lib/cn";

const sizes = {
  xs: "h-3.5 w-3.5 border-[1.5px]",
  sm: "h-4 w-4 border-2",
  md: "h-5 w-5 border-2",
  lg: "h-8 w-8 border-2",
} as const;

const variants = {
  default: "border-[#FF5924] border-t-transparent",
  muted: "border-[#B6B0A4] border-t-transparent",
  light: "border-white/30 border-t-white",
  ink: "border-[#1A1A1A] border-t-transparent",
} as const;

type SpinnerProps = Omit<React.ComponentProps<"div">, "children"> & {
  size?: keyof typeof sizes;
  variant?: keyof typeof variants;
};

export function Spinner({
  size = "sm",
  variant = "default",
  className,
  ...rest
}: SpinnerProps) {
  return (
    <div
      className={cn(
        "animate-spin rounded-full",
        sizes[size],
        variants[variant],
        className,
      )}
      {...rest}
    />
  );
}
