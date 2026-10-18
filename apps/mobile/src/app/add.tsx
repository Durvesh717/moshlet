import { authorizedKeyLine, HostLink, type HostCheck } from "@moshlet/core";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, Check, CircleAlert, Copy, KeyRound, ShieldCheck, X } from "lucide-react-native";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, BackHandler, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, type TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { devicePublicKey, SshConnection } from "../../modules/moshlet-native/ssh";
import { newHostId, saveHosts, type Host } from "../lib/hosts";
import { closeHost, openHost } from "../lib/session";
import { deviceIdentity, hostKeyCommand } from "../lib/ssh";
import { toast, useApp } from "../lib/store";
import { Choices, IconButton } from "../ui/kit";

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

  // The handler always runs the latest back() (it reads the current step), without resubscribing on every render.
  const backRef = useRef(back);
  backRef.current = back;
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      backRef.current();
      return true;
    });
    return () => sub.remove();
  }, []);

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
      // Setting up a computer again replaces its session, connection and all. It opens again right
      // away, so the unlocked device key stays.
      await closeHost(false);
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
    <KeyboardAvoidingView className="flex-1 bg-background" behavior="padding">
      <ScrollView
        ref={scroll}
        contentContainerClassName="gap-4"
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24, paddingLeft: insets.left + 20, paddingRight: insets.right + 20 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-row items-center gap-3">
          <IconButton icon={ArrowLeft} label="Back" onPress={back} />
          <Text className="font-medium text-[15px] text-muted-foreground">{existing ? `Set up ${existing.name} again` : "Add a computer"}</Text>
        </View>
        <Progress index={stepIndex} />

        {step === "prepare" && (
          <>
            <Title>Get the computer ready</Title>
            <Body>
              Moshlet signs in to the computer running herdr over SSH, like a terminal would, and runs your panes over mosh. Nothing of Moshlet's is installed there. Once per computer:
            </Body>
            <Choices<Os> value={os} onChange={setOs} height={34} options={(Object.keys(OS_LABEL) as Os[]).map((o) => ({ value: o, label: OS_LABEL[o] }))} />
            <Item n={1} title="Tailscale on both">
              <Small>Sign this device and the computer in to the same Tailscale account.</Small>
            </Item>
            <Item n={2} title="SSH sign-in turned on">
              <Small>{os === "macos" ? "System Settings → General → Sharing → Remote Login, or:" : "Start the SSH server:"}</Small>
              <Command text={SSH_ON[os]} onCopy={copy} />
            </Item>
            <Item n={3} title="mosh installed">
              <Small>Panes stream over mosh, so they survive bad networks and sleep.</Small>
              <Command text={MOSH_INSTALL[os]} onCopy={copy} />
            </Item>
            <Item n={4} title="herdr running">
              <Small>Start herdr there as usual. Moshlet shows its workspaces, tabs and agents.</Small>
            </Item>
            <Note>Moshlet checks all of this in the last step and tells you what's missing.</Note>
            <Action label="Continue" onPress={() => go("where")} />
          </>
        )}

        {step === "where" && (
          <>
            <Title>Find the computer</Title>
            <Body>
              Its Tailscale name is in the Tailscale app on this device, or run <Code>tailscale status</Code> on the computer.
            </Body>
            <Field label="Tailscale name or address">
              <Input
                value={address}
                onChangeText={setAddress}
                placeholder="my-laptop or 100.x.y.z"
                placeholderTextColorClassName="accent-idle"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType={Platform.OS === "android" ? "visible-password" : "url"}
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => userInput.current?.focus()}
                className={INPUT}
              />
            </Field>
            <Field label="Your username on it">
              <Input
                ref={userInput}
                value={user}
                onChangeText={setUser}
                placeholder="the name you sign in with"
                placeholderTextColorClassName="accent-idle"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType={Platform.OS === "android" ? "visible-password" : "default"}
                returnKeyType="go"
                onSubmitEditing={() => void connect()}
                className={INPUT}
              />
            </Field>
            <Field label="SSH port">
              <Input value={port} onChangeText={setPort} keyboardType="number-pad" returnKeyType="go" onSubmitEditing={() => void connect()} className={cn(INPUT, "w-[120px]")} />
            </Field>
            {error && <ErrorBox text={error} />}
            <Action label="Connect" busy={busy} onPress={() => void connect()} />
          </>
        )}

        {step === "trust" && conn && (
          <>
            <Title>Is this your computer?</Title>
            <Body>
              <Code>{t.address}</Code> answered with this host key:
            </Body>
            <View className="flex-row items-start gap-3 rounded-xl border border-border-strong bg-card p-4">
              <Icon as={ShieldCheck} size={20} className="text-brand" />
              <View className="flex-1 gap-1">
                <Text className="font-medium text-xs uppercase tracking-[0.6px] text-faint">{conn.keyType}</Text>
                <Text className="font-mono text-sm leading-[21px]" selectable>
                  {conn.hostKey}
                </Text>
              </View>
            </View>
            <Body>To compare, run this on the computer:</Body>
            <Command text={hostKeyCommand(conn.keyType)} onCopy={copy} />
            {existing?.hostKey && existing.hostKey !== conn.hostKey ? (
              <ErrorBox
                text={`This isn't the key Moshlet saved for ${existing.name} (${existing.hostKey}). Only continue if you know why it changed, such as a reinstall or a new SSH server.`}
              />
            ) : null}
            <Note>Moshlet remembers this key and won't connect if it ever changes.</Note>
            {error && <ErrorBox text={error} />}
            <Action label="Trust and continue" busy={busy} onPress={() => void trusted()} />
          </>
        )}

        {step === "signin" && conn && (
          <>
            <Title>Sign in once</Title>
            <Body>
              Enter the password for <Code>{t.user}</Code> on <Code>{t.address}</Code>. Moshlet uses it once to add this device's key to <Code>~/.ssh/authorized_keys</Code>,
              and signs in with the key from then on. The password isn't stored.
            </Body>
            <Field label="Password">
              <Input
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={() => void signInWithPassword()}
                className={INPUT}
              />
            </Field>
            {error && <ErrorBox text={error} />}
            <Action label="Sign in and add the key" busy={busy && !manualKey} onPress={() => void signInWithPassword()} />

            <Button variant="ghost" onPress={() => setManualKey(!manualKey)} className="gap-2">
              <Icon as={KeyRound} size={16} className="text-muted-foreground" />
              <Text className="font-medium text-sm text-muted-foreground">{manualKey ? "Hide" : "No password sign-in? Add the key yourself"}</Text>
            </Button>
            {manualKey && publicKey && (
              <Card className="gap-3 rounded-xl border-border bg-card p-4">
                <Small>On the computer, as {t.user}, run:</Small>
                <Command text={`mkdir -p -m 700 ~/.ssh && echo '${authorizedKeyLine(publicKey)}' >> ~/.ssh/authorized_keys`} onCopy={copy} />
                <Action label="I've added it" busy={busy} secondary onPress={() => void run(() => withKey())} />
              </Card>
            )}
          </>
        )}

        {step === "check" && check && (
          <>
            <Title>{ready ? "All set" : "Almost there"}</Title>
            <Body>
              Signed in to <Code>{check.hostname || t.address}</Code> as <Code>{check.user || t.user}</Code> with this device's key.
            </Body>
            <CheckRow ok={!!check.mosh} label="mosh" detail={check.mosh ?? "not installed"}>
              {!check.mosh && <Command text={MOSH_INSTALL[os]} onCopy={copy} />}
            </CheckRow>
            <CheckRow ok={!!check.herdr && check.bridge} label="herdr" detail={check.herdr ? `${check.herdrVersion ?? "installed"}${check.bridge ? "" : ": needs a newer herdr"}` : "not found on PATH"} />
            <CheckRow
              ok={check.sessions.some((s) => s.running)}
              label="herdr running"
              detail={check.sessions.some((s) => s.running) ? `${check.sessions.filter((s) => s.running).length} running` : "no session running"}
            >
              {!!check.herdr && !check.sessions.some((s) => s.running) && <Small>Start herdr on the computer, then check again.</Small>}
            </CheckRow>

            {ready && (
              <>
                <Field label="herdr session">
                  <Choices
                    value={session}
                    onChange={setSession}
                    options={check.sessions.map((s) => ({
                      value: s.name,
                      label: s.default && s.name !== "default" ? `${s.name} (default)` : s.name,
                      disabled: !s.running,
                    }))}
                  />
                </Field>
                <Field label="Name in Moshlet">
                  <Input value={name} onChangeText={setName} autoCorrect={false} returnKeyType="done" className={cn(INPUT, "font-normal")} />
                </Field>
              </>
            )}
            {error && <ErrorBox text={error} />}
            {ready ? (
              <Action label={`Open ${name.trim() || check.hostname}`} busy={busy} onPress={() => void finish()} />
            ) : (
              <Action label="Check again" busy={busy} onPress={() => void run(() => checkWith(conn!))} />
            )}
          </>
        )}
      </ScrollView>
      {/* Text scrolling up shouldn't run under the status bar. */}
      <View pointerEvents="none" className="absolute left-0 right-0 top-0 bg-background" style={{ height: insets.top }} />
    </KeyboardAvoidingView>
  );
}

/** ssh-keygen's file name for a host key type. */

const INPUT = "h-[52px] rounded-lg border-border-strong bg-card px-4 font-mono text-base";

const Title = ({ children }: { children: ReactNode }) => <Text className="mt-1 font-bold text-[28px]">{children}</Text>;
const Body = ({ children }: { children: ReactNode }) => <Text className="text-[15px] leading-[22px] text-muted-foreground">{children}</Text>;
const Small = ({ children }: { children: ReactNode }) => <Text className="text-sm leading-5 text-muted-foreground">{children}</Text>;
const Note = ({ children }: { children: ReactNode }) => <Text className="text-[13px] leading-[19px] text-faint">{children}</Text>;
const Code = ({ children }: { children: ReactNode }) => <Text className="font-mono text-brand">{children}</Text>;

function Progress({ index }: { index: number }) {
  return (
    <View className="mt-1 gap-2">
      <View className="flex-row gap-1.5">
        {STEPS.map((s, i) => (
          <View key={s.id} className={cn("h-1 flex-1 rounded-sm", i <= index ? "bg-brand" : "bg-border")} />
        ))}
      </View>
      <Text className="font-medium text-xs uppercase tracking-[0.6px] text-faint">
        Step {index + 1} of {STEPS.length} · {STEPS[index].label}
      </Text>
    </View>
  );
}

function Item(props: { n: number; title: string; children: ReactNode }) {
  return (
    <Card className="flex-row gap-3.5 rounded-xl border-border bg-card p-4 py-4">
      <View className="size-7 items-center justify-center rounded-full bg-accent">
        <Text className="font-semibold text-sm text-brand">{props.n}</Text>
      </View>
      <View className="flex-1 gap-2">
        <Text className="font-semibold text-base">{props.title}</Text>
        {props.children}
      </View>
    </Card>
  );
}

function CheckRow(props: { ok: boolean; label: string; detail: string; children?: ReactNode }) {
  return (
    <Card className="flex-row gap-3.5 rounded-xl border-border bg-card p-4 py-4">
      <View className={cn("size-7 items-center justify-center rounded-full", props.ok ? "bg-success-muted" : "bg-destructive-muted")}>
        <Icon as={props.ok ? Check : X} size={16} className={props.ok ? "text-success" : "text-destructive"} />
      </View>
      <View className="flex-1 gap-1.5">
        <Text className="font-semibold text-base">{props.label}</Text>
        <Text className="font-mono text-xs text-faint" numberOfLines={2}>
          {props.detail}
        </Text>
        {props.children}
      </View>
    </Card>
  );
}

function Command({ text, onCopy }: { text: string; onCopy: (t: string) => void }) {
  return (
    <Pressable
      onPress={() => onCopy(text)}
      accessibilityLabel={`Copy ${text}`}
      className="flex-row items-center gap-2.5 rounded-md border border-terminal-border bg-terminal px-3 py-2.5 active:opacity-70"
    >
      <Text className="flex-1 font-mono text-[13px] leading-[19px] text-term-fg" selectable>
        {text}
      </Text>
      <Icon as={Copy} size={15} className="text-term-7" />
    </Pressable>
  );
}

function Field(props: { label: string; children: ReactNode }) {
  return (
    <View className="gap-2">
      <Label className="font-medium text-[13px] text-muted-foreground">{props.label}</Label>
      {props.children}
    </View>
  );
}

function ErrorBox({ text }: { text: string }) {
  return (
    <Alert variant="destructive" icon={CircleAlert} className="rounded-lg border-destructive-border bg-destructive-muted">
      <AlertDescription className="text-sm leading-5">{text}</AlertDescription>
    </Alert>
  );
}

function Action(props: { label: string; onPress: () => void; busy?: boolean; secondary?: boolean }) {
  return (
    <Button
      variant={props.secondary ? "secondary" : "default"}
      onPress={props.onPress}
      disabled={props.busy}
      className={cn("mt-1 h-[54px] rounded-xl", props.secondary && "border border-border-strong", props.busy && "opacity-80")}
    >
      {props.busy ? (
        <ActivityIndicator colorClassName={props.secondary ? "accent-foreground" : "accent-primary-foreground"} />
      ) : (
        <Text className={cn("font-semibold text-[17px]", props.secondary ? "text-foreground" : "text-primary-foreground")}>{props.label}</Text>
      )}
    </Button>
  );
}
