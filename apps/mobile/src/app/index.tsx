import { useRouter } from "expo-router";
import { ChevronRight, Monitor, Plus, Trash2 } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { deleteToken, saveHosts, type Host } from "../lib/hosts";
import { openHost } from "../lib/session";
import { toast, useApp } from "../lib/store";
import { unlock } from "../lib/unlock";
import { C, F, R } from "../theme";
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
      message: "This device will need a new pairing code to connect again.",
      action: "Forget",
      danger: true,
    });
    if (!ok) return;
    const list = useApp.getState().hosts.filter((h) => h.id !== host.id);
    useApp.setState({ hosts: list });
    await saveHosts(list);
    await deleteToken(host.id);
    toast(`Forgot ${host.name}`);
  };

  const sorted = [...hosts].sort((a, b) => (b.lastUsedAt ?? b.addedAt) - (a.lastUsedAt ?? a.addedAt));

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24, paddingLeft: insets.left + 20, paddingRight: insets.right + 20 }]}>
      <View style={styles.brand}>
        <Logo size={56} />
        <View>
          <Text style={styles.title}>Corral</Text>
          <Text style={styles.subtitle}>your coding agents, in your pocket</Text>
        </View>
      </View>

      <SectionLabel>Computers</SectionLabel>
      {sorted.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No computers yet</Text>
          <Text style={styles.emptyBody}>
            Install corral-agent on the computer running herdr, run <Text style={styles.code}>corral-agent pair</Text>, then add it here with the code it shows.
          </Text>
        </View>
      ) : (
        sorted.map((h) => (
          <Pressable key={h.id} onPress={() => void open(h)} onLongPress={() => void forget(h)} style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}>
            <View style={styles.cardIcon}>
              <Monitor size={22} color={C.accent} />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={styles.cardTitle}>{h.name}</Text>
              <Text style={styles.cardSub} numberOfLines={1}>
                {h.address} · {h.session}
              </Text>
            </View>
            <ChevronRight size={20} color={C.faint} />
          </Pressable>
        ))
      )}

      <Pressable onPress={() => router.push("/pair")} style={({ pressed }) => [styles.add, pressed && { opacity: 0.8 }]}>
        <Plus size={20} color={C.text} />
        <Text style={styles.addText}>Add a computer</Text>
      </Pressable>
      {sorted.length > 0 && (
        <View style={styles.hint}>
          <Trash2 size={13} color={C.faint} />
          <Text style={styles.hintText}>Long-press a computer to forget it.</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.ground },
  content: { gap: 14 },
  brand: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 18 },
  title: { fontFamily: F.bold, fontSize: 30, color: C.text },
  subtitle: { fontFamily: F.regular, fontSize: 15, color: C.muted },
  empty: { backgroundColor: C.surface, borderColor: C.line, borderWidth: 1, borderRadius: R.xl, padding: 20, gap: 8 },
  emptyTitle: { fontFamily: F.semibold, fontSize: 17, color: C.text },
  emptyBody: { fontFamily: F.regular, fontSize: 15, lineHeight: 22, color: C.muted },
  code: { fontFamily: F.mono, color: C.accent },
  card: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: C.surface, borderColor: C.line2, borderWidth: 1, borderRadius: R.xl, padding: 16 },
  cardIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: C.surface2, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontFamily: F.semibold, fontSize: 18, color: C.text },
  cardSub: { fontFamily: F.mono, fontSize: 12, color: C.faint },
  add: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, height: 56, borderRadius: R.xl, borderWidth: 1, borderColor: C.line2, borderStyle: "dashed" },
  addText: { fontFamily: F.medium, fontSize: 16, color: C.text },
  hint: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  hintText: { fontFamily: F.regular, fontSize: 13, color: C.faint },
});
