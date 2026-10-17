import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScopedTheme, useUniwind } from "uniwind";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { setTheme, THEMES, type ThemeId } from "../lib/appearance";
import { IconButton, SectionLabel } from "../ui/kit";

export default function Settings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
        <SectionLabel>Theme</SectionLabel>
        <ThemePicker />
      </ScrollView>
      {/* Text scrolling up shouldn't run under the status bar. */}
      <View pointerEvents="none" className="absolute left-0 right-0 top-0 bg-background" style={{ height: insets.top }} />
    </View>
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
