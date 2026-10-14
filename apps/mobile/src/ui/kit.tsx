import type { AgentStatus } from "@corral/core";
import type { LucideIcon } from "lucide-react-native";
import { useEffect, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import { C, F, R } from "../theme";

export function Chip(props: {
  label: string;
  onPress: () => void;
  leading?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  color?: string;
  background?: string;
  border?: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const h = props.height ?? 40;
  const selected = !!props.selected;
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      style={({ pressed }) => [
        styles.chip,
        {
          height: h,
          borderRadius: h / 2,
          backgroundColor: selected ? C.accentTint : props.disabled ? C.surface : (props.background ?? C.surface2),
          borderColor: selected ? C.accent : props.disabled ? C.line : (props.border ?? C.line2),
          opacity: pressed ? 0.75 : 1,
        },
        props.style,
      ]}
    >
      {props.leading}
      <Text numberOfLines={1} style={[styles.chipText, { color: props.disabled ? C.idle : (props.color ?? C.text) }]}>
        {props.label}
      </Text>
    </Pressable>
  );
}

export function IconButton(props: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  size?: number;
  active?: boolean;
  tint?: string;
  background?: string;
  border?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const s = props.size ?? 40;
  const Icon = props.icon;
  return (
    <Pressable
      accessibilityLabel={props.label}
      onPress={props.onPress}
      hitSlop={6}
      style={({ pressed }) => [
        {
          width: s,
          height: s,
          borderRadius: R.md,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          backgroundColor: props.active ? C.accentTint : (props.background ?? C.surface),
          borderColor: props.active ? C.accent : (props.border ?? C.line),
          opacity: pressed ? 0.7 : 1,
        },
        props.style,
      ]}
    >
      <Icon size={Math.round(s * 0.42)} color={props.active ? C.accent : (props.tint ?? C.muted)} strokeWidth={2} />
    </Pressable>
  );
}

export function KeyCap(props: { onPress: () => void; children: ReactNode; active?: boolean; color?: string; flex?: number; label?: string }) {
  return (
    <Pressable
      accessibilityLabel={props.label}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.key,
        {
          flex: props.flex ?? 1,
          backgroundColor: props.active ? C.accentTint : (props.color ?? C.surface2),
          borderColor: props.active ? C.accent : "transparent",
          opacity: pressed ? 0.6 : 1,
        },
      ]}
    >
      {props.children}
    </Pressable>
  );
}

export function KeyLabel({ text, active }: { text: string; active?: boolean }) {
  return <Text style={[styles.keyText, { fontSize: text.length === 1 ? 15 : 12, color: active ? C.accent : C.text }]}>{text}</Text>;
}

/** Agent status at a glance: amber triangle (needs you), spinning ring (working), green dot (done), hollow ring (idle). */
export function StatusGlyph({ status, size = 14 }: { status: AgentStatus; size?: number }) {
  const spin = useSharedValue(0);
  useEffect(() => {
    if (status !== "working") return;
    spin.value = withRepeat(withTiming(360, { duration: 1100, easing: Easing.linear }), -1);
    return () => cancelAnimation(spin);
  }, [status, spin]);
  const rotate = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value}deg` }] }));
  const s = size;
  if (status === "blocked") {
    return (
      <Svg width={s} height={s}>
        <Path d={`M${s / 2} ${s * 0.06} L${s * 0.97} ${s * 0.9} L${s * 0.03} ${s * 0.9} Z`} fill={C.blocked} />
      </Svg>
    );
  }
  if (status === "working") {
    const w = s * 0.17;
    const r = s / 2 - w / 2;
    const c = 2 * Math.PI * r;
    return (
      <View style={{ width: s, height: s }}>
        <Svg width={s} height={s} style={StyleSheet.absoluteFill}>
          <Circle cx={s / 2} cy={s / 2} r={r} stroke={C.line2} strokeWidth={w} fill="none" />
        </Svg>
        <Animated.View style={[StyleSheet.absoluteFill, rotate]}>
          <Svg width={s} height={s}>
            <Circle cx={s / 2} cy={s / 2} r={r} stroke={C.accent} strokeWidth={w} fill="none" strokeLinecap="round" strokeDasharray={`${c * 0.28} ${c}`} />
          </Svg>
        </Animated.View>
      </View>
    );
  }
  if (status === "done") {
    return (
      <Svg width={s} height={s}>
        <Circle cx={s / 2} cy={s / 2} r={s / 2} fill={C.done} />
      </Svg>
    );
  }
  return (
    <Svg width={s} height={s}>
      <Circle cx={s / 2} cy={s / 2} r={s / 2 - s * 0.1} stroke={C.idle} strokeWidth={s * 0.17} fill="none" />
    </Svg>
  );
}

export const statusLabel = (s: AgentStatus): string =>
  ({ blocked: "needs you", working: "working", done: "done", idle: "idle", unknown: "" })[s];

export function SectionLabel({ children, right }: { children: string; right?: ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.section}>{children}</Text>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, borderWidth: 1 },
  chipText: { fontFamily: F.medium, fontSize: 13 },
  key: { height: 40, borderRadius: R.md, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  keyText: { fontFamily: F.mono },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  section: { fontFamily: F.semibold, fontSize: 12, letterSpacing: 1.4, color: C.muted, textTransform: "uppercase" },
});
