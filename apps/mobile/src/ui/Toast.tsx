import { useEffect, useState } from "react";
import { StyleSheet, Text } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "../lib/store";
import { C, F, R } from "../theme";

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
    <Animated.View key={shown.id} entering={FadeInUp} exiting={FadeOutUp} style={[styles.toast, { top: insets.top + 64 }]} pointerEvents="none">
      <Text style={styles.text}>{shown.text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: { position: "absolute", left: 16, right: 16, alignItems: "center" },
  text: {
    fontFamily: F.medium,
    fontSize: 14,
    color: C.text,
    backgroundColor: C.surface2,
    borderColor: C.line2,
    borderWidth: 1,
    borderRadius: R.lg,
    paddingHorizontal: 16,
    paddingVertical: 12,
    overflow: "hidden",
  },
});
