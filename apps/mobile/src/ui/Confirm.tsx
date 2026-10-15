import { useRef } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { create } from "zustand";
import { C, F, R } from "../theme";

type Question = { title: string; message: string; action: string; danger?: boolean };
type Asked = Question & { resolve(ok: boolean): void };

const useConfirm = create<{ asked: Asked | null }>(() => ({ asked: null }));

/** Asks a yes/no question in the app's own dialog; resolves true when the action is chosen. */
export function confirm(q: Question): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirm.getState().asked?.resolve(false);
    useConfirm.setState({ asked: { ...q, resolve } });
  });
}

function answer(ok: boolean) {
  const asked = useConfirm.getState().asked;
  useConfirm.setState({ asked: null });
  asked?.resolve(ok);
}

/** Mounted once at the root. */
export function ConfirmDialog() {
  const asked = useConfirm((s) => s.asked);
  // Keep the last question on screen while the dialog fades out.
  const last = useRef<Question | null>(null);
  if (asked) last.current = asked;
  const q = asked ?? last.current;
  return (
    <Modal visible={!!asked} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={() => answer(false)}>
      <Pressable style={styles.scrim} onPress={() => answer(false)}>
        {q && (
          <Pressable style={styles.card}>
            <Text style={styles.title}>{q.title}</Text>
            <Text style={styles.message}>{q.message}</Text>
            <View style={styles.actions}>
              <Pressable onPress={() => answer(false)} style={({ pressed }) => [styles.button, styles.cancel, pressed && styles.pressed]}>
                <Text style={styles.buttonText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => answer(true)}
                style={({ pressed }) => [styles.button, q.danger ? styles.danger : styles.primary, pressed && styles.pressed]}
              >
                <Text style={[styles.buttonText, { color: q.danger ? C.danger : "#fff" }]}>{q.action}</Text>
              </Pressable>
            </View>
          </Pressable>
        )}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: C.scrim, justifyContent: "center", padding: 28 },
  card: {
    backgroundColor: C.surface,
    borderColor: C.line2,
    borderWidth: 1,
    borderRadius: R.xl,
    padding: 22,
    gap: 8,
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
  },
  title: { fontFamily: F.semibold, fontSize: 19, color: C.text },
  message: { fontFamily: F.regular, fontSize: 15, lineHeight: 21, color: C.muted },
  actions: { flexDirection: "row", gap: 10, marginTop: 14 },
  button: { flex: 1, height: 48, borderRadius: R.lg, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  cancel: { backgroundColor: C.surface2, borderColor: C.line2 },
  primary: { backgroundColor: C.accentStrong, borderColor: C.accentStrong },
  danger: { backgroundColor: C.dangerBg, borderColor: C.dangerLine },
  pressed: { opacity: 0.75 },
  buttonText: { fontFamily: F.semibold, fontSize: 15, color: C.text },
});
