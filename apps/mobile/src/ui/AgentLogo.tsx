import { Bot } from "lucide-react-native";
import { SvgXml } from "react-native-svg";
import { withUniwind } from "uniwind";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { AGENT_LOGOS } from "./agentLogos";

// The text color fills one-color logos (their currentColor).
const Logo = withUniwind(SvgXml, { color: { fromClassName: "className", styleProperty: "color" } });

/** The agent's own logo (Claude, Codex, Gemini...) in its colors, by herdr's agent kind; a robot when there's none. */
export function AgentLogo(props: { kind: string; size?: number; className?: string }) {
  const size = props.size ?? 16;
  const xml = AGENT_LOGOS[props.kind];
  if (!xml) return <Icon as={Bot} size={size} className={cn("text-muted-foreground", props.className)} />;
  return <Logo xml={xml} width={size} height={size} className={cn("text-foreground", props.className)} />;
}
