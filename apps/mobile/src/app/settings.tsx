import { useFonts } from "expo-font";
import { useRouter } from "expo-router";
import { ArrowLeft, BellRing, Minus, Plus } from "lucide-react-native";
import { Pressable, ScrollView, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScopedTheme, useUniwind } from "uniwind";
import { Icon } from "@/components/ui/icon";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Text } from "@/components/ui/text";
import { useColors } from "@/lib/colors";
import { cn } from "@/lib/utils";
import { alertsSupported, setAlerts } from "../lib/alerts";
import { setFontSize, setTerminalFont, setTheme, THEMES, type ThemeId } from "../lib/appearance";
import { useApp } from "../lib/store";
import { FONT_SIZE, TERMINAL_FONTS, type TerminalFont } from "../theme";
import { IconButton, SectionLabel } from "../ui/kit";

const FONTS = Object.keys(TERMINAL_FONTS) as TerminalFont[];
/** Each terminal font's regular weight, loaded for the app's own text here so the choices preview themselves. */
const previewFamily = (font: TerminalFont) => `Term-${font.replace(/ /g, "")}`;
const PREVIEW_FILES = Object.fromEntries(FONTS.map((f) => [previewFamily(f), TERMINAL_FONTS[f][0]]));

export default function Settings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [previews] = useFonts(PREVIEW_FILES);
  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerClassName="gap-3.5"
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24, paddingLeft: insets.left + 20, paddingRight: insets.right + 20 }}
      >
        <View className="mb-3 flex-row items-center gap-3">
          <IconButton icon={ArrowLeft} label="Back" onPress={() => router.back()} />
          <Text className="font-bold text-[22px]">Settings</Text>
        </View>

        <SectionLabel>Notifications</SectionLabel>
        <Alerts />

        <View className="mt-5 gap-3.5">
          <SectionLabel>Theme</SectionLabel>
          <ThemePicker />
        </View>

        <View className="mt-5 gap-3.5">
          <SectionLabel>Terminal text size</SectionLabel>
          <FontSize previews={previews} />
        </View>

        <View className="mt-5 gap-3.5">
          <SectionLabel>Terminal font</SectionLabel>
          <FontPicker previews={previews} />
        </View>
      </ScrollView>
      {/* Text scrolling up shouldn't run under the status bar. */}
      <View pointerEvents="none" className="absolute left-0 right-0 top-0 bg-background" style={{ height: insets.top }} />
    </View>
  );
}

function Alerts() {
  const on = useApp((s) => s.alerts);
  const c = useColors();
  return (
    <Pressable
      disabled={!alertsSupported}
      onPress={() => void setAlerts(!on)}
      className="flex-row items-center gap-3.5 rounded-xl border border-border-strong bg-card p-4 active:opacity-80"
    >
      <View className="size-10 items-center justify-center rounded-lg bg-secondary">
        <Icon as={BellRing} size={20} className={on ? "text-brand" : "text-muted-foreground"} />
      </View>
      <View className="flex-1 gap-1">
        <Text className="font-medium text-[15px]">Approval alerts</Text>
        <Text className="text-[13px] leading-[18px] text-muted-foreground">
          {alertsSupported ? "Get notified when an agent needs you, even with the phone locked." : "On Android for now."}
        </Text>
      </View>
      <Switch
        value={on}
        disabled={!alertsSupported}
        onValueChange={(v) => void setAlerts(v)}
        trackColor={{ false: c.borderStrong, true: c.brand }}
        thumbColor={c.foreground}
        accessibilityLabel="Approval alerts"
      />
    </Pressable>
  );
}

/** Each choice is drawn in its own theme, so it previews itself. */
function ThemePicker() {
  const { theme } = useUniwind();
  return (
    <RadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemeId)} className="gap-2.5">
      {THEMES.map((t) => {
        const selected = theme === t.id;
        return (
          <ScopedTheme key={t.id} theme={t.id}>
            <Pressable
              onPress={() => setTheme(t.id)}
              accessibilityLabel={`${t.label} theme`}
              className={cn("flex-row items-center gap-3.5 rounded-xl border-2 bg-background p-3 active:opacity-80", selected ? "border-brand" : "border-border-strong")}
            >
              <RadioGroupItem value={t.id} aria-label={t.label} className="size-5 border-border-strong" />
              <View className="flex-1 gap-0.5">
                <Text className="font-medium text-[15px]">{t.label}</Text>
                <Text className="text-xs text-muted-foreground">{t.note}</Text>
              </View>
              <View className="h-9 w-24 flex-row items-end gap-1 rounded-md bg-terminal p-1.5">
                <View className="h-2 flex-1 rounded-sm bg-primary" />
                <View className="size-2 rounded-sm bg-success" />
                <View className="size-2 rounded-sm bg-warning" />
              </View>
            </Pressable>
          </ScopedTheme>
        );
      })}
    </RadioGroup>
  );
}

/** Steps a point at a time (pinching the terminal sets half points), over a few lines in the chosen font. */
function FontSize({ previews }: { previews: boolean }) {
  const size = useApp((s) => s.fontSize);
  const font = useApp((s) => s.termFont);
  const style = { fontFamily: previews ? previewFamily(font) : undefined, fontSize: size, lineHeight: Math.round(size * 1.45) };
  return (
    <View className="gap-3 rounded-xl border border-border-strong bg-card p-3">
      <View className="flex-row items-center gap-3">
        <IconButton icon={Minus} label="Smaller" onPress={() => setFontSize(Math.ceil(size) - 1)} />
        <View className="flex-1 items-center">
          <Text className="font-semibold text-lg">{size} pt</Text>
          <Text className="text-xs text-muted-foreground">or pinch the terminal</Text>
        </View>
        <IconButton icon={Plus} label="Larger" onPress={() => setFontSize(Math.floor(size) + 1)} />
      </View>
      <View className="overflow-hidden rounded-lg bg-terminal px-3 py-2.5">
        <Text numberOfLines={1} style={style}>
          <Text className="text-term-6" style={style}>~/api-server</Text>
          <Text className="text-term-fg" style={style}> on </Text>
          <Text className="text-term-5" style={style}>main</Text>
        </Text>
        <Text numberOfLines={1} className="text-term-fg" style={style}>
          ❯ npm test
        </Text>
        <Text numberOfLines={1} style={style}>
          <Text className="text-term-2" style={style}>✓ 21 passed</Text>
          <Text className="text-term-3" style={style}>  1 warning</Text>
        </Text>
      </View>
      <Text className="text-center text-xs text-faint">
        {FONT_SIZE.min} to {FONT_SIZE.max} pt
      </Text>
    </View>
  );
}

function FontPicker({ previews }: { previews: boolean }) {
  const font = useApp((s) => s.termFont);
  return (
    <RadioGroup value={font} onValueChange={(v) => setTerminalFont(v as TerminalFont)} className="gap-2.5">
      {FONTS.map((f) => {
        const selected = font === f;
        return (
          <Pressable
            key={f}
            onPress={() => setTerminalFont(f)}
            accessibilityLabel={`${f} font`}
            className={cn("flex-row items-center gap-3.5 rounded-xl border-2 bg-card p-3 active:opacity-80", selected ? "border-brand" : "border-border-strong")}
          >
            <RadioGroupItem value={f} aria-label={f} className="size-5 border-border-strong" />
            <View className="flex-1 gap-1">
              <Text className="font-medium text-[15px]">{f}</Text>
              {/* Nothing a font would join into a ligature: the terminal draws characters one by one. */}
              <Text numberOfLines={1} className="text-[15px] text-muted-foreground" style={previews ? { fontFamily: previewFamily(f) } : undefined}>
                {"$ git log  il1 O0 {} []"}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </RadioGroup>
  );
}
