import { Interpreter, Screen, Sealer, utf8Encode } from "@corral/core";
import { Canvas, RoundedRect } from "@shopify/react-native-skia";
import { StyleSheet, Text, View } from "react-native";

function selfTest(): string[] {
  const out: string[] = [];
  const key = Uint8Array.from({ length: 16 }, (_, i) => i);
  const sealer = new Sealer(key);
  const sealed = sealer.seal((1n << 63n) | 7n, utf8Encode("hello mosh"));
  out.push(`ocb round trip: ${sealer.open(sealed) ? "ok" : "FAILED"}`);
  const s = new Screen(20, 2);
  Interpreter.apply(s, utf8Encode("\x1b[1;35mcorral\x1b[0m ⚠️ ok"));
  out.push(`interpreter: "${s.rowText(0)}"`);
  return out;
}

export default function Index() {
  const lines = selfTest();
  return (
    <View style={styles.root}>
      <Canvas style={styles.canvas}>
        <RoundedRect x={0} y={0} width={56} height={56} r={16} color="#7C4DFF" />
      </Canvas>
      <Text style={styles.title}>Corral</Text>
      {lines.map((l) => (
        <Text key={l} style={styles.line}>
          {l}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "#0B0812" },
  canvas: { width: 56, height: 56 },
  title: { color: "#F4F0FF", fontSize: 28, fontWeight: "700" },
  line: { color: "#B9AED6", fontSize: 14, fontFamily: "monospace" },
});
