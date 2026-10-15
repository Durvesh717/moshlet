import { useMemo } from "react";
import { useCSSVariable } from "uniwind";

const VARS = {
  background: "--color-background",
  card: "--color-card",
  foreground: "--color-foreground",
  mutedForeground: "--color-muted-foreground",
  primaryForeground: "--color-primary-foreground",
  brand: "--color-brand",
  faint: "--color-faint",
  idle: "--color-idle",
  borderStrong: "--color-border-strong",
  warning: "--color-warning",
  success: "--color-success",
  destructive: "--color-destructive",
} as const;

type Name = keyof typeof VARS;
const NAMES = Object.keys(VARS) as Name[];
const LIST = NAMES.map((n) => VARS[n]);

/**
 * The theme's colors as plain strings, for props that take a color rather than a class (SVG fills,
 * spinners). Follows theme changes.
 */
export function useColors(): Record<Name, string> {
  const values = useCSSVariable(LIST) as (string | number | undefined)[];
  const key = values.join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => Object.fromEntries(NAMES.map((n, i) => [n, String(values[i] ?? "#888888")])) as Record<Name, string>, [key]);
}
