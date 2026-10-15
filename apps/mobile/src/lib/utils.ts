import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Weights pick a font file here (see global.css), so a weight and a family overwrite each other.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: { "font-family": [{ font: ["sans", "mono", "mono-bold"] }] },
    conflictingClassGroups: { "font-family": ["font-weight"], "font-weight": ["font-family"] },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
