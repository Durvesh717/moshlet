import Svg, { Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { useCSSVariable } from "uniwind";

/** The app mark on its tile, as in assets/brand: a prompt (a stand-in until the Moshlet logo), in the theme's colors. */
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
      <Path d="M36 40L50 54L36 68" fill="none" stroke={mark} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
      <Rect x={55} y={62} width={17} height={7} rx={3.5} fill={chip} />
    </Svg>
  );
}
