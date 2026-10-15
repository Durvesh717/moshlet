import { useRouter } from "expo-router";
import { Check, ChevronRight, Monitor, Plus, Trash2 } from "lucide-react-native";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScopedTheme, useUniwind } from "uniwind";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { setTheme, THEMES } from "../lib/appearance";
import { hostLabel, saveHosts, type Host } from "../lib/hosts";
import { openHost } from "../lib/session";
import { toast, useApp } from "../lib/store";
import { unlock } from "../lib/unlock";
import { confirm } from "../ui/Confirm";
import { SectionLabel } from "../ui/kit";
import { Logo } from "../ui/Logo";

export default function Hosts() {
  const hosts = useApp((s) => s.hosts);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const open = async (host: Host) => {
    if (!(await unlock(`Open ${host.name}`))) return;
    const updated = { ...host, lastUsedAt: Date.now() };
    const list = useApp.getState().hosts.map((h) => (h.id === host.id ? updated : h));
    useApp.setState({ hosts: list });
    void saveHosts(list);
    openHost(updated);
    router.push("/workspace");
  };

  const forget = async (host: Host) => {
    const ok = await confirm({
      title: `Forget ${host.name}?`,
      message: `Corral removes it from this device. To also revoke this device's key, delete the line ending in "corral@" from the authorized keys of ${host.user} on ${host.name}.`,
      action: "Forget",
      danger: true,
    });
    if (!ok) return;
    const list = useApp.getState().hosts.filter((h) => h.id !== host.id);
    useApp.setState({ hosts: list });
    await saveHosts(list);
    toast(`Forgot ${host.name}`);
  };

  const sorted = [...hosts].sort((a, b) => (b.lastUsedAt ?? b.addedAt) - (a.lastUsedAt ?? a.addedAt));

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-3.5"
      contentContainerStyle={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24, paddingLeft: insets.left + 20, paddingRight: insets.right + 20 }}
    >
      <View className="mb-[18px] flex-row items-center gap-4">
        <Logo size={56} />
        <View>
          <Text className="font-bold text-[30px]">Corral</Text>
          <Text className="text-[15px] text-muted-foreground">your coding agents, in your pocket</Text>
        </View>
      </View>

      <SectionLabel>Computers</SectionLabel>
      {sorted.length === 0 ? (
        <Card className="gap-2 rounded-xl border-border bg-card p-5 py-5">
          <CardHeader className="gap-2 px-0">
            <CardTitle className="font-semibold text-[17px]">No computers yet</CardTitle>
            <CardDescription className="text-[15px] leading-[22px]">
              Corral signs in to the computer running herdr over SSH and streams its panes over mosh. Nothing to install there: setup takes five short steps.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        sorted.map((h) => (
          <Pressable
            key={h.id}
            onPress={() => void open(h)}
            onLongPress={() => void forget(h)}
            className="flex-row items-center gap-3.5 rounded-xl border border-border-strong bg-card p-4 active:opacity-80"
          >
            <View className="size-11 items-center justify-center rounded-xl bg-secondary">
              <Icon as={Monitor} size={22} className="text-brand" />
            </View>
            <View className="flex-1 gap-[3px]">
              <Text className="font-semibold text-lg">{h.name}</Text>
              <Text className="font-mono text-xs text-faint" numberOfLines={1}>
                {hostLabel(h)} · {h.session}
              </Text>
            </View>
            <Icon as={ChevronRight} size={20} className="text-faint" />
          </Pressable>
        ))
      )}

      <Button variant="outline" onPress={() => router.push("/add")} className="h-14 rounded-xl border-dashed border-border-strong bg-transparent active:opacity-80">
        <Icon as={Plus} size={20} className="text-foreground" />
        <Text className="font-medium text-base text-foreground">Add a computer</Text>
      </Button>
      {sorted.length > 0 && (
        <View className="flex-row items-center justify-center gap-1.5">
          <Icon as={Trash2} size={13} className="text-faint" />
          <Text className="text-[13px] text-faint">Long-press a computer to forget it.</Text>
        </View>
      )}

      <View className="mt-4 gap-3.5">
        <SectionLabel>Theme</SectionLabel>
        <ThemePicker />
      </View>
    </ScrollView>
  );
}

/** Each choice is drawn in its own theme, so it previews itself. */
function ThemePicker() {
  const { theme } = useUniwind();
  return (
    <View className="flex-row gap-2.5">
      {THEMES.map((t) => {
        const selected = theme === t.id;
        return (
          <ScopedTheme key={t.id} theme={t.id}>
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${t.label} theme`}
              onPress={() => setTheme(t.id)}
              className={cn("flex-1 gap-2.5 rounded-xl bg-background p-3 active:opacity-80", selected ? "border-2 border-brand" : "border border-border-strong")}
            >
              <View className="h-9 flex-row items-end gap-1 rounded-md bg-terminal p-1.5">
                <View className="h-2 flex-1 rounded-sm bg-primary" />
                <View className="h-2 w-2 rounded-sm bg-success" />
                <View className="h-2 w-2 rounded-sm bg-warning" />
              </View>
              <View className="flex-row items-center justify-between">
                <Text className="font-medium text-[13px]">{t.label}</Text>
                {selected && <Icon as={Check} size={14} className="text-brand" />}
              </View>
            </Pressable>
          </ScopedTheme>
        );
      })}
    </View>
  );
}
