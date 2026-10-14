import { AGENT_PORT, AgentConnection, AgentError, type PairResult } from "@corral/core";
import * as Device from "expo-device";
import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { agentUrl, saveHosts, saveToken, type Host } from "../lib/hosts";
import { openHost } from "../lib/session";
import { useApp } from "../lib/store";
import { C, F, R } from "../theme";
import { IconButton } from "../ui/kit";

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export default function Pair() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [port, setPort] = useState(String(AGENT_PORT));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formatted = (raw: string) => {
    const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
  };

  const submit = async () => {
    const addr = address.trim();
    if (!addr || code.replace("-", "").length !== 8) {
      setError("Enter the computer's Tailscale address and the 8-character code.");
      return;
    }
    setBusy(true);
    setError(null);
    const target = { address: addr, port: Number(port) || AGENT_PORT };
    let conn: AgentConnection | null = null;
    try {
      conn = await AgentConnection.open(agentUrl(target));
      const deviceName = Device.deviceName ?? Device.modelName ?? "phone";
      const r = await conn.call<PairResult>("pair", { code, deviceName });
      const host: Host = {
        id: newId(),
        name: r.host.name,
        address: target.address,
        port: target.port,
        deviceId: r.deviceId,
        session: "default",
        lastPane: {},
        addedAt: Date.now(),
        lastUsedAt: Date.now(),
      };
      await saveToken(host.id, r.token);
      const hosts = [...useApp.getState().hosts, host];
      useApp.setState({ hosts });
      await saveHosts(hosts);
      openHost(host);
      router.replace("/workspace");
    } catch (e) {
      setError(
        e instanceof AgentError && e.code === "unreachable"
          ? `Couldn't reach corral-agent at ${agentUrl(target)}. Is it running, and is this device on Tailscale?`
          : (e as Error).message,
      );
    } finally {
      conn?.close();
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <IconButton icon={ArrowLeft} label="Back" onPress={() => router.back()} />
        <Text style={styles.title}>Add a computer</Text>
        <Text style={styles.body}>
          On the computer running herdr, run <Text style={styles.code}>corral-agent pair</Text>. It shows the address to use and a one-time code.
        </Text>

        <View style={styles.field}>
          <Text style={styles.label}>Tailscale address</Text>
          <TextInput
            value={address}
            onChangeText={setAddress}
            placeholder="100.x.y.z or name.tailnet.ts.net"
            placeholderTextColor={C.idle}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType={Platform.OS === "android" ? "visible-password" : "url"}
            style={styles.input}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Pairing code</Text>
          <TextInput
            value={code}
            onChangeText={(t) => setCode(formatted(t))}
            placeholder="XXXX-XXXX"
            placeholderTextColor={C.idle}
            autoCapitalize="characters"
            autoCorrect={false}
            style={[styles.input, styles.codeInput]}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Port</Text>
          <TextInput value={port} onChangeText={setPort} keyboardType="number-pad" style={[styles.input, { width: 120 }]} />
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable onPress={() => void submit()} disabled={busy} style={({ pressed }) => [styles.button, (pressed || busy) && { opacity: 0.8 }]}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Pair</Text>}
        </Pressable>
        <Text style={styles.note}>
          Only devices signed in to the same Tailscale account as the computer can connect, and the code works once.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.ground },
  content: { paddingHorizontal: 20, gap: 16 },
  title: { fontFamily: F.bold, fontSize: 28, color: C.text, marginTop: 8 },
  body: { fontFamily: F.regular, fontSize: 15, lineHeight: 22, color: C.muted },
  code: { fontFamily: F.mono, color: C.accent },
  field: { gap: 8 },
  label: { fontFamily: F.medium, fontSize: 13, color: C.muted },
  input: {
    height: 52,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: C.line2,
    backgroundColor: C.surface,
    paddingHorizontal: 16,
    color: C.text,
    fontFamily: F.mono,
    fontSize: 16,
  },
  codeInput: { fontSize: 22, letterSpacing: 4, textAlign: "center" },
  error: { fontFamily: F.regular, fontSize: 14, lineHeight: 20, color: C.danger, backgroundColor: C.dangerBg, borderColor: C.dangerLine, borderWidth: 1, borderRadius: R.lg, padding: 12 },
  button: { height: 54, borderRadius: R.xl, backgroundColor: C.accentStrong, alignItems: "center", justifyContent: "center", marginTop: 4 },
  buttonText: { fontFamily: F.semibold, fontSize: 17, color: "#fff" },
  note: { fontFamily: F.regular, fontSize: 13, lineHeight: 19, color: C.faint, textAlign: "center" },
});
