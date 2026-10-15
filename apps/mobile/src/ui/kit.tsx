import type { AgentStatus } from "@corral/core";
import type { LucideIcon } from "lucide-react-native";
import { useEffect, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { useColors } from "@/lib/colors";
import { cn } from "@/lib/utils";

type Tone = "default" | "brand" | "warning" | "muted";

const TONE: Record<Tone, { box: string; text: string }> = {
  default: { box: "bg-secondary border-border-strong", text: "text-foreground" },
  brand: { box: "bg-card border-brand", text: "text-brand" },
  warning: { box: "bg-card border-warning", text: "text-warning" },
  muted: { box: "bg-card border-border", text: "text-muted-foreground" },
};

/** A pill: one of a set of choices (`selected`), an action, or a status to tap. */
export function Chip(props: {
  label: string;
  onPress: () => void;
  icon?: LucideIcon;
  leading?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  tone?: Tone;
  height?: number;
  className?: string;
}) {
  const h = props.height ?? 40;
  const tone = TONE[props.tone ?? "default"];
  const box = props.selected ? "bg-accent border-brand" : props.disabled ? "bg-card border-border" : tone.box;
  const text = props.disabled ? "text-idle" : props.selected ? "text-foreground" : tone.text;
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      className={cn("flex-row items-center gap-1.5 border px-3.5 active:opacity-75", box, props.className)}
      style={{ height: h, borderRadius: h / 2 }}
    >
      {props.icon && <Icon as={props.icon} size={15} className={text} />}
      {props.leading}
      <Text numberOfLines={1} className={cn("font-medium text-[13px]", text)}>
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
  className?: string;
  iconClassName?: string;
}) {
  const s = props.size ?? 40;
  return (
    <Button
      variant="outline"
      size="icon"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      hitSlop={6}
      className={cn("rounded-md border-border bg-card shadow-none active:opacity-70", props.active && "bg-accent border-brand", props.className)}
      style={{ width: s, height: s }}
    >
      <Icon as={props.icon} size={Math.round(s * 0.42)} className={cn("text-muted-foreground", props.iconClassName, props.active && "text-brand")} />
    </Button>
  );
}

export function KeyCap(props: { onPress: () => void; children: ReactNode; active?: boolean; primary?: boolean; flex?: number; label?: string }) {
  return (
    <Pressable
      accessibilityLabel={props.label}
      onPress={props.onPress}
      className={cn(
        "h-10 items-center justify-center rounded-md border border-transparent active:opacity-60",
        props.active ? "bg-accent border-brand" : props.primary ? "bg-primary" : "bg-secondary",
      )}
      style={{ flex: props.flex ?? 1 }}
    >
      {props.children}
    </Pressable>
  );
}

export function KeyLabel({ text, active }: { text: string; active?: boolean }) {
  return <Text className={cn("font-mono", text.length === 1 ? "text-[15px]" : "text-xs", active ? "text-brand" : "text-foreground")}>{text}</Text>;
}

/** Agent status at a glance: amber triangle (needs you), spinning ring (working), green dot (done), hollow ring (idle). */
export function StatusGlyph({ status, size = 14 }: { status: AgentStatus; size?: number }) {
  const c = useColors();
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
        <Path d={`M${s / 2} ${s * 0.06} L${s * 0.97} ${s * 0.9} L${s * 0.03} ${s * 0.9} Z`} fill={c.warning} />
      </Svg>
    );
  }
  if (status === "working") {
    const w = s * 0.17;
    const r = s / 2 - w / 2;
    const len = 2 * Math.PI * r;
    return (
      <View style={{ width: s, height: s }}>
        <Svg width={s} height={s} style={StyleSheet.absoluteFill}>
          <Circle cx={s / 2} cy={s / 2} r={r} stroke={c.borderStrong} strokeWidth={w} fill="none" />
        </Svg>
        <Animated.View style={[StyleSheet.absoluteFill, rotate]}>
          <Svg width={s} height={s}>
            <Circle cx={s / 2} cy={s / 2} r={r} stroke={c.brand} strokeWidth={w} fill="none" strokeLinecap="round" strokeDasharray={`${len * 0.28} ${len}`} />
          </Svg>
        </Animated.View>
      </View>
    );
  }
  if (status === "done") {
    return (
      <Svg width={s} height={s}>
        <Circle cx={s / 2} cy={s / 2} r={s / 2} fill={c.success} />
      </Svg>
    );
  }
  return (
    <Svg width={s} height={s}>
      <Circle cx={s / 2} cy={s / 2} r={s / 2 - s * 0.1} stroke={c.idle} strokeWidth={s * 0.17} fill="none" />
    </Svg>
  );
}

export const statusLabel = (s: AgentStatus): string => ({ blocked: "needs you", working: "working", done: "done", idle: "idle", unknown: "" })[s];

export function SectionLabel({ children, right }: { children: string; right?: ReactNode }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="font-semibold text-xs uppercase tracking-[1.4px] text-muted-foreground">{children}</Text>
      {right}
    </View>
  );
}
