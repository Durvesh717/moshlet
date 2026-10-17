import { Bot } from "lucide-react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { AGENT_LOGOS, type LogoShape } from "./agentLogos";

function Mark(props: { shapes: LogoShape[]; size: number; color?: string }) {
  return (
    <Svg width={props.size} height={props.size} viewBox="0 0 24 24">
      {props.shapes.map((s, i) => (
        <Path key={i} d={s.d} fill={props.color} fillRule={s.evenOdd ? "evenodd" : "nonzero"} opacity={s.opacity} />
      ))}
    </Svg>
  );
}

const StyledMark = withUniwind(Mark, { color: { fromClassName: "className", styleProperty: "color" } });

/** The agent's own mark (Claude, Codex, Gemini...), one color, by herdr's agent kind; a robot when there's none. */
export function AgentLogo(props: { kind: string; size?: number; className?: string }) {
  const size = props.size ?? 16;
  const shapes = AGENT_LOGOS[props.kind];
  const className = cn("text-muted-foreground", props.className);
  if (!shapes) return <Icon as={Bot} size={size} className={className} />;
  return <StyledMark shapes={shapes} size={size} className={className} />;
}
