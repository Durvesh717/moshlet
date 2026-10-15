import { HostLink, type HostCheck } from "@corral/core";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, Check, Copy, KeyRound, ShieldCheck, X } from "lucide-react-native";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, BackHandler, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { devicePublicKey, SshConnection } from "../../modules/corral-native/ssh";
import { newHostId, saveHosts, type Host } from "../lib/hosts";
import { closeHost, openHost } from "../lib/session";
import { deviceIdentity } from "../lib/ssh";
import { toast, useApp } from "../lib/store";
import { C, F, R } from "../theme";
import { Chip, IconButton } from "../ui/kit";

type Step = "prepare" | "where" | "trust" | "signin" | "check";
const STEPS: { id: Step; label: string }[] = [
  { id: "prepare", label: "Prepare" },
  { id: "where", label: "Find" },
  { id: "trust", label: "Trust" },
  { id: "signin", label: "Sign in" },
  { id: "check", label: "Check" },
];

type Os = "arch" | "debian" | "macos";
const OS_LABEL: Record<Os, string> = { arch: "Arch", debian: "Debian / Ubuntu", macos: "macOS" };
const SSH_ON: Record<Os, string> = {
  arch: "sudo systemctl enable --now sshd",
  debian: "sudo apt install openssh-server",
  macos: "sudo systemsetup -setremotelogin on",
};
const MOSH_INSTALL: Record<Os, string> = { arch: "sudo pacman -S mosh", debian: "sudo apt install mosh", macos: "brew install mosh" };

/**
 * Adding a computer, one step at a time: get it ready, find it on Tailscale, trust its host key,
 * sign in once with the password to add this device's key, then check herdr and mosh are there.
 * With ?host=<id>, sets up a saved computer again (a new key, or a changed host key).
 */
export default function AddComputer() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ host?: string }>();
  const existing = useApp((s) => s.hosts.find((h) => h.id === params.host));

  const [step, setStep] = useState<Step>(existing ? "where" : "prepare");
  const [os, setOs] = useState<Os>("arch");
  const [address, setAddress] = useState(existing?.address ?? "");
  const [user, setUser] = useState(existing?.user ?? "");
  const [port, setPort] = useState(String(existing?.port ?? 22));
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conn, setConn] = useState<SshConnection | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(devicePublicKey());
  const [manualKey, setManualKey] = useState(false);
  const [check, setCheck] = useState<HostCheck | null>(null);
  const [name, setName] = useState(existing?.name ?? "");
  const [session, setSession] = useState(existing?.session ?? "");
  const scroll = useRef<ScrollView>(null);
  const userInput = useRef<TextInput>(null);
  const connRef = useRef<SshConnection | null>(null);
  connRef.current = conn;

  useEffect(() => () => connRef.current?.close(), []);

  const target = () => ({ address: address.trim(), user: user.trim(), port: Number(port) || 22 });

  const go = (next: Step) => {
    setError(null);
    setStep(next);
    scroll.current?.scrollTo({ y: 0, animated: false });
  };

  const back = () => {
    const i = STEPS.findIndex((s) => s.id === step);
    if (i <= 0 || (existing && step === "where")) {
      router.back();
      return;
    }
    // Stepping back past "trust" starts the connection over.
    if (step === "trust" || step === "signin" || step === "check") {
      conn?.close();
      setConn(null);
      go("where");
    } else go(STEPS[i - 1].id);
  };

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      back();
      return true;
    });
    return () => sub.remove();
  });

  const run = async (fn: () => Promise<void>) => {
    Keyboard.dismiss();
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Step 2: reach the computer (no login yet) to see its host key.
  const connect = () =>
    run(async () => {
      const t = target();
      if (!t.address || !t.user) throw new Error("Enter the computer's Tailscale name and your username on it.");
      conn?.close();
      const c = await SshConnection.open(t.address, t.port);
      setConn(c);
      go("trust");
    });

  // sshd drops a connection that hasn't signed in after a couple of minutes: reconnect, to the same host key.
  const live = async (): Promise<SshConnection> => {
    if (!conn) throw new Error("Connect first.");
    if (!conn.closed) return conn;
    const t = target();
    const c = await SshConnection.open(t.address, t.port, { hostKey: conn.hostKey, keyType: conn.keyType });
    setConn(c);
    return c;
  };

  // Step 3 → 4: trusted. This device's key may already be there (setting up again).
  const trusted = () =>
    run(async () => {
      if (!conn) return go("where");
      const id = await deviceIdentity();
      if (!id) throw new Error("Unlock to create this device's key.");
      setPublicKey(id.publicKey);
      const c = await live();
      if (await c.authKey(target().user)) await checkWith(c);
      else go("signin");
    });

  // Step 4: the password, once, to add the key; then sign in again with the key alone.
  const signInWithPassword = () =>
    run(async () => {
      if (!conn || !publicKey) return go("where");
      if (!password) throw new Error("Enter the password.");
      const c = await live();
      if (!(await c.authPassword(target().user, password))) throw new Error(`Wrong password for ${target().user}, or the computer doesn't allow password sign-in. You can add the key yourself instead (below).`);
      setPassword("");
      await new HostLink(c).installKey(publicKey);
      await withKey(c);
    });

  // Step 4, the other way: the user added the key themselves.
  const withKey = async (previous = conn) => {
    const t = target();
    previous?.close();
    const c = await SshConnection.open(t.address, t.port, previous ? { hostKey: previous.hostKey, keyType: previous.keyType } : undefined);
    setConn(c);
    if (!(await c.authKey(t.user))) {
      throw new Error(
        "The computer still doesn't accept this device's key. Check it's in ~/.ssh/authorized_keys, and that ~/.ssh is only writable by you (chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys).",
      );
    }
    await checkWith(c);
  };

  // Step 5: what's installed and running.
  const checkWith = async (c: SshConnection) => {
    const r = await new HostLink(c).check();
    setCheck(r);
    if (!name) setName(r.hostname || target().address.split(".")[0]);
    const running = r.sessions.filter((s) => s.running);
    if (!running.some((s) => s.name === session)) setSession((running.find((s) => s.default) ?? running[0])?.name ?? "");
    go("check");
  };

  const ready = !!check && !!check.mosh && !!check.herdr && check.bridge && check.sessions.some((s) => s.running);

  const finish = () =>
    run(async () => {
      if (!conn || !check) return;
      const t = target();
      const base = existing ?? { id: newHostId(), lastPane: {}, addedAt: Date.now() };
      const host: Host = {
        ...base,
        name: name.trim() || check.hostname || t.address,
        address: t.address,
        port: t.port,
        user: t.user,
        hostKey: conn.hostKey,
        keyType: conn.keyType,
        session: session || "default",
        lastUsedAt: Date.now(),
      };
      const others = useApp.getState().hosts.filter((h) => h.id !== host.id);
      const hosts = [...others, host];
      useApp.setState({ hosts });
      await saveHosts(hosts);
      conn.close();
      setConn(null);
      // Setting up a computer again replaces its session, connection and all.
      await closeHost();
      openHost(host);
      router.dismissTo("/workspace");
    });

  const copy = (text: string) => {
    void Clipboard.setStringAsync(text);
    toast("Copied");
  };

  const t = target();
  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding">
      <ScrollView
        ref={scroll}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24, paddingLeft: insets.left + 20, paddingRight: insets.right + 20 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <IconButton icon={ArrowLeft} label="Back" onPress={back} />
          <Text style={styles.headerTitle}>{existing ? `Set up ${existing.name} again` : "Add a computer"}</Text>
        </View>
        <Progress index={stepIndex} />

        {step === "prepare" && (
          <>
            <Text style={styles.title}>Get the computer ready</Text>
            <Text style={styles.body}>
              Corral signs in to the computer running herdr over SSH, like a terminal would, and runs your panes over mosh. Nothing of Corral's is installed there. Once per computer:
            </Text>
            <View style={styles.osRow}>
              {(Object.keys(OS_LABEL) as Os[]).map((o) => (
                <Chip key={o} label={OS_LABEL[o]} selected={os === o} onPress={() => setOs(o)} height={34} />
              ))}
            </View>
            <Item n={1} title="Tailscale on both">
              <Text style={styles.itemBody}>Sign this device and the computer in to the same Tailscale account.</Text>
            </Item>
            <Item n={2} title="SSH sign-in turned on">
              {os === "macos" ? (
                <Text style={styles.itemBody}>System Settings → General → Sharing → Remote Login, or:</Text>
              ) : (
                <Text style={styles.itemBody}>Start the SSH server:</Text>
              )}
              <Command text={SSH_ON[os]} onCopy={copy} />
            </Item>
            <Item n={3} title="mosh installed">
              <Text style={styles.itemBody}>Panes stream over mosh, so they survive bad networks and sleep.</Text>
              <Command text={MOSH_INSTALL[os]} onCopy={copy} />
            </Item>
            <Item n={4} title="herdr running">
              <Text style={styles.itemBody}>Start herdr there as usual. Corral shows its workspaces, tabs and agents.</Text>
            </Item>
            <Text style={styles.note}>Corral checks all of this in the last step and tells you what's missing.</Text>
            <Button label="Continue" onPress={() => go("where")} />
          </>
        )}

        {step === "where" && (
          <>
            <Text style={styles.title}>Find the computer</Text>
            <Text style={styles.body}>
              Its Tailscale name is in the Tailscale app on this device, or run <Text style={styles.code}>tailscale status</Text> on the computer.
            </Text>
            <Field label="Tailscale name or address">
              <TextInput
                value={address}
                onChangeText={setAddress}
                placeholder="my-laptop or 100.x.y.z"
                placeholderTextColor={C.idle}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType={Platform.OS === "android" ? "visible-password" : "url"}
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => userInput.current?.focus()}
                style={styles.input}
              />
            </Field>
            <Field label="Your username on it">
              <TextInput
                ref={userInput}
                value={user}
                onChangeText={setUser}
                placeholder="the name you sign in with"
                placeholderTextColor={C.idle}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType={Platform.OS === "android" ? "visible-password" : "default"}
                returnKeyType="go"
                onSubmitEditing={() => void connect()}
                style={styles.input}
              />
            </Field>
            <Field label="SSH port">
              <TextInput value={port} onChangeText={setPort} keyboardType="number-pad" returnKeyType="go" onSubmitEditing={() => void connect()} style={[styles.input, { width: 120 }]} />
            </Field>
            {error && <ErrorBox text={error} />}
            <Button label="Connect" busy={busy} onPress={() => void connect()} />
          </>
        )}

        {step === "trust" && conn && (
          <>
            <Text style={styles.title}>Is this your computer?</Text>
            <Text style={styles.body}>
              <Text style={styles.code}>{t.address}</Text> answered with this host key:
            </Text>
            <View style={styles.keyCard}>
              <ShieldCheck size={20} color={C.accent} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.keyType}>{conn.keyType}</Text>
                <Text style={styles.fingerprint} selectable>
                  {conn.hostKey}
                </Text>
              </View>
            </View>
            <Text style={styles.body}>To compare, run this on the computer:</Text>
            <Command text={`ssh-keygen -lf /etc/ssh/ssh_host_${keyFile(conn.keyType)}_key.pub`} onCopy={copy} />
            <Text style={styles.note}>Corral remembers this key and won't connect if it ever changes.</Text>
            {error && <ErrorBox text={error} />}
            <Button label="Trust and continue" busy={busy} onPress={() => void trusted()} />
          </>
        )}

        {step === "signin" && conn && (
          <>
            <Text style={styles.title}>Sign in once</Text>
            <Text style={styles.body}>
              Enter the password for <Text style={styles.code}>{t.user}</Text> on <Text style={styles.code}>{t.address}</Text>. Corral uses it once to add this device's
              key to <Text style={styles.code}>~/.ssh/authorized_keys</Text>, and signs in with the key from then on. The password isn't stored.
            </Text>
            <Field label="Password">
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={() => void signInWithPassword()}
                style={styles.input}
              />
            </Field>
            {error && <ErrorBox text={error} />}
            <Button label="Sign in and add the key" busy={busy && !manualKey} onPress={() => void signInWithPassword()} />

            <Pressable onPress={() => setManualKey(!manualKey)} style={styles.disclosure}>
              <KeyRound size={16} color={C.muted} />
              <Text style={styles.disclosureText}>{manualKey ? "Hide" : "No password sign-in? Add the key yourself"}</Text>
            </Pressable>
            {manualKey && publicKey && (
              <View style={styles.manual}>
                <Text style={styles.itemBody}>On the computer, as {t.user}, run:</Text>
                <Command text={`mkdir -p -m 700 ~/.ssh && echo '${publicKey}' >> ~/.ssh/authorized_keys`} onCopy={copy} />
                <Button label="I've added it" busy={busy} secondary onPress={() => void run(() => withKey())} />
              </View>
            )}
          </>
        )}

        {step === "check" && check && (
          <>
            <Text style={styles.title}>{ready ? "All set" : "Almost there"}</Text>
            <Text style={styles.body}>
              Signed in to <Text style={styles.code}>{check.hostname || t.address}</Text> as <Text style={styles.code}>{check.user || t.user}</Text> with this device's key.
            </Text>
            <CheckRow ok={!!check.mosh} label="mosh" detail={check.mosh ?? "not installed"}>
              {!check.mosh && <Command text={MOSH_INSTALL[os]} onCopy={copy} />}
            </CheckRow>
            <CheckRow ok={!!check.herdr && check.bridge} label="herdr" detail={check.herdr ? `${check.herdrVersion ?? "installed"}${check.bridge ? "" : ": needs a newer herdr"}` : "not found on PATH"} />
            <CheckRow
              ok={check.sessions.some((s) => s.running)}
              label="herdr running"
              detail={check.sessions.some((s) => s.running) ? `${check.sessions.filter((s) => s.running).length} running` : "no session running"}
            >
              {!!check.herdr && !check.sessions.some((s) => s.running) && <Text style={styles.itemBody}>Start herdr on the computer, then check again.</Text>}
            </CheckRow>

            {ready && (
              <>
                <Field label="herdr session">
                  <View style={styles.sessionList}>
                    {check.sessions.map((s) => (
                      <Chip key={s.name} label={s.default && s.name !== "default" ? `${s.name} (default)` : s.name} selected={session === s.name} disabled={!s.running} onPress={() => setSession(s.name)} height={36} />
                    ))}
                  </View>
                </Field>
                <Field label="Name in Corral">
                  <TextInput value={name} onChangeText={setName} autoCorrect={false} returnKeyType="done" style={[styles.input, { fontFamily: F.regular }]} />
                </Field>
              </>
            )}
            {error && <ErrorBox text={error} />}
            {ready ? (
              <Button label={`Open ${name.trim() || check.hostname}`} busy={busy} onPress={() => void finish()} />
            ) : (
              <Button label="Check again" busy={busy} onPress={() => void run(() => checkWith(conn!))} />
            )}
          </>
        )}
      </ScrollView>
      {/* Text scrolling up shouldn't run under the status bar. */}
      <View pointerEvents="none" style={[styles.statusShade, { height: insets.top }]} />
    </KeyboardAvoidingView>
  );
}

/** ssh-keygen's file name for a host key type. */
const keyFile = (type: string): string => (type.includes("ed25519") ? "ed25519" : type.includes("ecdsa") ? "ecdsa" : "rsa");

function Progress({ index }: { index: number }) {
  return (
    <View style={styles.progress}>
      <View style={styles.progressBars}>
        {STEPS.map((s, i) => (
          <View key={s.id} style={[styles.progressBar, i <= index && styles.progressDone]} />
        ))}
      </View>
      <Text style={styles.progressText}>
        Step {index + 1} of {STEPS.length} · {STEPS[index].label}
      </Text>
    </View>
  );
}

function Item(props: { n: number; title: string; children: ReactNode }) {
  return (
    <View style={styles.item}>
      <View style={styles.itemNumber}>
        <Text style={styles.itemNumberText}>{props.n}</Text>
      </View>
      <View style={{ flex: 1, gap: 8 }}>
        <Text style={styles.itemTitle}>{props.title}</Text>
        {props.children}
      </View>
    </View>
  );
}

function CheckRow(props: { ok: boolean; label: string; detail: string; children?: ReactNode }) {
  return (
    <View style={styles.item}>
      <View style={[styles.checkIcon, { backgroundColor: props.ok ? C.doneBg : C.dangerBg }]}>{props.ok ? <Check size={16} color={C.done} /> : <X size={16} color={C.danger} />}</View>
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={styles.itemTitle}>{props.label}</Text>
        <Text style={styles.checkDetail} numberOfLines={2}>
          {props.detail}
        </Text>
        {props.children}
      </View>
    </View>
  );
}

function Command({ text, onCopy }: { text: string; onCopy: (t: string) => void }) {
  return (
    <Pressable onPress={() => onCopy(text)} style={({ pressed }) => [styles.command, pressed && { opacity: 0.7 }]} accessibilityLabel={`Copy ${text}`}>
      <Text style={styles.commandText} selectable>
        {text}
      </Text>
      <Copy size={15} color={C.muted} />
    </Pressable>
  );
}

function Field(props: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      {props.children}
    </View>
  );
}

function ErrorBox({ text }: { text: string }) {
  return <Text style={styles.error}>{text}</Text>;
}

function Button(props: { label: string; onPress: () => void; busy?: boolean; secondary?: boolean }) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.busy}
      style={({ pressed }) => [styles.button, props.secondary && styles.buttonSecondary, (pressed || props.busy) && { opacity: 0.8 }]}
    >
      {props.busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{props.label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.ground },
  statusShade: { position: "absolute", top: 0, left: 0, right: 0, backgroundColor: C.ground },
  content: { gap: 16 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerTitle: { fontFamily: F.medium, fontSize: 15, color: C.muted },
  progress: { gap: 8, marginTop: 4 },
  progressBars: { flexDirection: "row", gap: 6 },
  progressBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: C.line },
  progressDone: { backgroundColor: C.accent },
  progressText: { fontFamily: F.medium, fontSize: 12, letterSpacing: 0.6, color: C.faint, textTransform: "uppercase" },
  title: { fontFamily: F.bold, fontSize: 28, color: C.text, marginTop: 4 },
  body: { fontFamily: F.regular, fontSize: 15, lineHeight: 22, color: C.muted },
  code: { fontFamily: F.mono, color: C.accent },
  osRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  item: { flexDirection: "row", gap: 14, backgroundColor: C.surface, borderColor: C.line, borderWidth: 1, borderRadius: R.xl, padding: 16 },
  itemNumber: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.accentTint, alignItems: "center", justifyContent: "center" },
  itemNumberText: { fontFamily: F.semibold, fontSize: 14, color: C.accent },
  itemTitle: { fontFamily: F.semibold, fontSize: 16, color: C.text },
  itemBody: { fontFamily: F.regular, fontSize: 14, lineHeight: 20, color: C.muted },
  checkIcon: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  checkDetail: { fontFamily: F.mono, fontSize: 12, color: C.faint },
  command: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.terminal, borderColor: C.terminalLine, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 10 },
  commandText: { flex: 1, fontFamily: F.mono, fontSize: 13, lineHeight: 19, color: C.text },
  keyCard: { flexDirection: "row", gap: 12, alignItems: "flex-start", backgroundColor: C.surface, borderColor: C.line2, borderWidth: 1, borderRadius: R.xl, padding: 16 },
  keyType: { fontFamily: F.medium, fontSize: 12, letterSpacing: 0.6, color: C.faint, textTransform: "uppercase" },
  fingerprint: { fontFamily: F.mono, fontSize: 14, lineHeight: 21, color: C.text },
  field: { gap: 8 },
  label: { fontFamily: F.medium, fontSize: 13, color: C.muted },
  input: { height: 52, borderRadius: R.lg, borderWidth: 1, borderColor: C.line2, backgroundColor: C.surface, paddingHorizontal: 16, color: C.text, fontFamily: F.mono, fontSize: 16 },
  sessionList: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  disclosure: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 6 },
  disclosureText: { fontFamily: F.medium, fontSize: 14, color: C.muted },
  manual: { gap: 12, backgroundColor: C.surface, borderColor: C.line, borderWidth: 1, borderRadius: R.xl, padding: 16 },
  error: { fontFamily: F.regular, fontSize: 14, lineHeight: 20, color: C.danger, backgroundColor: C.dangerBg, borderColor: C.dangerLine, borderWidth: 1, borderRadius: R.lg, padding: 12 },
  button: { height: 54, borderRadius: R.xl, backgroundColor: C.accentStrong, alignItems: "center", justifyContent: "center", marginTop: 4 },
  buttonSecondary: { backgroundColor: C.surface2, borderColor: C.line2, borderWidth: 1 },
  buttonText: { fontFamily: F.semibold, fontSize: 17, color: "#fff" },
  note: { fontFamily: F.regular, fontSize: 13, lineHeight: 19, color: C.faint },
});
