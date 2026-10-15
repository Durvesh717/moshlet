import Svg, { Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { useCSSVariable } from "uniwind";

/** The app mark on its tile, as in assets/brand: an open ring (the corral) around a prompt, in the theme's colors. */
export function Logo(props: { size: number }) {
  const [from, to, chip, mark] = useCSSVariable(["--color-logo-from", "--color-logo-to", "--color-logo-chip", "--color-logo-mark"]) as string[];
  return (
    <Svg width={props.size} height={props.size} viewBox="9 9 90 90">
      <Defs>
        <LinearGradient id="logoBase" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={from} />
          <Stop offset="1" stopColor={to} />
        </LinearGradient>
        <RadialGradient id="logoGlow" cx="0.3" cy="0.2" r="0.8">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.18} />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={9} y={9} width={90} height={90} rx={29} fill="url(#logoBase)" />
      <Rect x={9} y={9} width={90} height={90} rx={29} fill="url(#logoGlow)" />
      <Path d="M70.06 71.84A24 24 0 1 1 70.06 36.16" fill="none" stroke={mark} strokeWidth={8} strokeLinecap="round" />
      <Path d="M43 45L52 54L43 63" fill="none" stroke={mark} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
      <Rect x={56} y={59} width={11} height={5.5} rx={2} fill={chip} />
    </Svg>
  );
}
