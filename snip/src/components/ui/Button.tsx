import { motion, type HTMLMotionProps } from "motion/react";
import { forwardRef, type ReactNode } from "react";

type Variant = "standard" | "accent" | "subtle";

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: Variant;
  icon?: ReactNode;
  iconAfter?: ReactNode;
  size?: "md" | "lg";
  children?: ReactNode;
}

const base =
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[4px] select-none outline-none " +
  "transition-[background-color,color,border-color] duration-[83ms] ease-linear disabled:pointer-events-none";

const variants: Record<Variant, string> = {
  standard: "btn-standard",
  accent: "btn-accent",
  subtle: "btn-subtle",
};

/** Botón de Fluent con micro-feedback al presionar (scale 0.97). */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "standard", icon, iconAfter, size = "md", className = "", children, ...rest },
  ref,
) {
  const sizing = size === "lg" ? "h-10 px-5 t-body-strong" : "h-8 px-3 t-body";
  return (
    <motion.button
      ref={ref}
      type="button"
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 700, damping: 40 }}
      className={`${base} ${variants[variant]} ${sizing} ${className}`}
      {...rest}
    >
      {icon && <span className="flex shrink-0 items-center text-[16px] leading-none">{icon}</span>}
      {children}
      {iconAfter && <span className="flex shrink-0 items-center text-[12px] leading-none">{iconAfter}</span>}
    </motion.button>
  );
});

export interface IconButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  label: string;
  children: ReactNode;
  active?: boolean;
  size?: number;
}

/** Botón de ícono "subtle" (sin fondo hasta el hover), con tooltip nativo accesible. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, children, active, size = 32, className = "", ...rest },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={active}
      whileTap={{ scale: 0.92 }}
      transition={{ type: "spring", stiffness: 700, damping: 35 }}
      style={{ width: size, height: size }}
      className={`btn-subtle relative inline-flex items-center justify-center rounded-[4px] text-[20px] leading-none outline-none disabled:pointer-events-none ${
        active ? "is-active" : ""
      } ${className}`}
      {...rest}
    >
      {children}
    </motion.button>
  );
});
