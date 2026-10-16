import type { AgentStatus } from "@moshlet/core";
import type { LucideIcon } from "lucide-react-native";
import { useEffect, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useColors } from "@/lib/colors";
import { cn } from "@/lib/utils";

type Tone = "default" | "brand" | "warning" | "muted";

const TONE: Record<Tone, { box: string; text: string }> = {
  default: { box: "bg-secondary border-border-strong", text: "text-foreground" },
  brand: { box: "bg-card border-brand", text: "text-brand" },
  warning: { box: "bg-card border-warning", text: "text-warning" },
  muted: { box: "bg-card border-border", text: "text-muted-foreground" },
};

/** A small rounded action: Live, Needs approval, Try again. */
export function Pill(props: { label: string; onPress: () => void; icon?: LucideIcon; leading?: ReactNode; tone?: Tone; height?: number; className?: string }) {
  const h = props.height ?? 40;
  const tone = TONE[props.tone ?? "default"];
  return (
    <Button
      variant="outline"
      onPress={props.onPress}
      className={cn("gap-1.5 rounded-full border px-3.5 shadow-none active:opacity-75", tone.box, props.className)}
      style={{ height: h }}
    >
      {props.icon && <Icon as={props.icon} size={15} className={tone.text} />}
      {props.leading}
      <Text numberOfLines={1} className={cn("font-medium text-[13px]", tone.text)}>
        {props.label}
      </Text>
    </Button>
  );
}

/** One of a few choices, as pills that wrap. */
export function Choices<T extends string>(props: { value: T; options: { value: T; label: string; disabled?: boolean }[]; onChange(value: T): void; height?: number }) {
  const h = props.height ?? 36;
  return (
    <ToggleGroup type="single" value={props.value} onValueChange={(v) => v && props.onChange(v as T)} className="flex-row flex-wrap gap-2">
      {props.options.map((o) => {
        const selected = o.value === props.value;
        return (
          <ToggleGroupItem
            key={o.value}
            value={o.value}
            disabled={o.disabled}
            aria-label={o.label}
            className={cn(
              "rounded-full border px-3.5 opacity-100",
              selected ? "border-brand bg-accent" : o.disabled ? "border-border bg-card" : "border-border-strong bg-secondary",
            )}
            style={{ height: h }}
          >
            <Text numberOfLines={1} className={cn("font-medium text-[13px]", o.disabled ? "text-idle" : "text-foreground")}>
              {o.label}
            </Text>
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
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
    <Button
      variant={props.primary ? "default" : "secondary"}
      accessibilityLabel={props.label}
      onPress={props.onPress}
      className={cn("h-10 rounded-md border border-transparent px-0 shadow-none active:opacity-60", props.active && "border-brand bg-accent")}
      style={{ flex: props.flex ?? 1 }}
    >
      {props.children}
    </Button>
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
