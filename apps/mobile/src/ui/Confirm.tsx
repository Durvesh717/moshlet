import { useRef } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Text } from "@/components/ui/text";
import { create } from "zustand";
import { useOverTerminal } from "../lib/overlay";

type Question = { title: string; message: string; action: string; danger?: boolean };
type Asked = Question & { resolve(ok: boolean): void };

const useConfirm = create<{ asked: Asked | null }>(() => ({ asked: null }));

/** Asks a yes/no question in the app's own dialog; resolves true when the action is chosen. */
export function confirm(q: Question): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirm.getState().asked?.resolve(false);
    useConfirm.setState({ asked: { ...q, resolve } });
  });
}

function answer(ok: boolean) {
  const asked = useConfirm.getState().asked;
  useConfirm.setState({ asked: null });
  asked?.resolve(ok);
}

/** Mounted once at the root. */
export function ConfirmDialog() {
  const asked = useConfirm((s) => s.asked);
  useOverTerminal(!!asked);
  // Keep the last question on screen while the dialog fades out.
  const last = useRef<Question | null>(null);
  if (asked) last.current = asked;
  const q = asked ?? last.current;
  if (!q) return null;
  return (
    <AlertDialog open={!!asked} onOpenChange={(open) => !open && answer(false)}>
      <AlertDialogContent className="w-full max-w-[420px] gap-2 self-center rounded-xl border-border-strong bg-card p-[22px]">
        <AlertDialogHeader className="gap-2">
          <AlertDialogTitle className="text-left text-[19px]">{q.title}</AlertDialogTitle>
          <AlertDialogDescription className="text-left text-[15px] leading-[21px]">{q.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-3.5 flex-row gap-2.5">
          <AlertDialogCancel onPress={() => answer(false)} className="h-12 flex-1 rounded-lg border-border-strong bg-secondary">
            <Text className="font-semibold text-[15px]">Cancel</Text>
          </AlertDialogCancel>
          <AlertDialogAction
            onPress={() => answer(true)}
            className={q.danger ? "h-12 flex-1 rounded-lg border border-destructive-border bg-destructive-muted" : "h-12 flex-1 rounded-lg"}
          >
            <Text className={q.danger ? "font-semibold text-[15px] text-destructive" : "font-semibold text-[15px] text-primary-foreground"}>{q.action}</Text>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
