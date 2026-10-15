import { useEffect, useState } from "react";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { useApp } from "../lib/store";

/** One short message at a time, near the top. */
export function Toast() {
  const toast = useApp((s) => s.toast);
  const insets = useSafeAreaInsets();
  const [shown, setShown] = useState<{ id: number; text: string } | null>(null);
  useEffect(() => {
    if (!toast) return;
    setShown(toast);
    const t = setTimeout(() => setShown((cur) => (cur?.id === toast.id ? null : cur)), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  if (!shown) return null;
  return (
    <Animated.View
      key={shown.id}
      entering={FadeInUp}
      exiting={FadeOutUp}
      style={{ position: "absolute", left: 16, right: 16, alignItems: "center", top: insets.top + 64 }}
      pointerEvents="none"
    >
      <Text className="overflow-hidden rounded-lg border border-border-strong bg-secondary px-4 py-3 font-medium text-sm">{shown.text}</Text>
    </Animated.View>
  );
}
