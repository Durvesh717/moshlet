import { useEffect } from "react";

let open = 0;

/**
 * Menus and dialogs over the terminal take touches through React Native, the terminal through the
 * gesture handler, which still sees them: so while one is open the terminal ignores touches that
 * start then (tapping outside a menu closes it without also opening the keyboard).
 */
export function useOverTerminal(isOpen: boolean): void {
  useEffect(() => {
    if (!isOpen) return;
    open++;
    return () => {
      open--;
    };
  }, [isOpen]);
}

export const overTerminal = (): boolean => open > 0;
