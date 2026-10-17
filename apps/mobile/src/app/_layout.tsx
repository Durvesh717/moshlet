import "../global.css";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { PortalHost } from "@rn-primitives/portal";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useCSSVariable, useUniwind } from "uniwind";
import { alerts } from "../../modules/moshlet-native";
import { loadAlerts, openFromAlert } from "../lib/alerts";
import { isLight, loadAppearance } from "../lib/appearance";
import { loadHosts } from "../lib/hosts";
import { useApp } from "../lib/store";
import { FONT_FILES } from "../theme";
import { ConfirmDialog } from "../ui/Confirm";
import { Toast } from "../ui/Toast";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts(FONT_FILES);
  const hostsLoaded = useApp((s) => s.hostsLoaded);
  const [themeLoaded, setThemeLoaded] = useState(false);
  const ground = useCSSVariable("--color-background") as string;
  const { theme } = useUniwind();

  useEffect(() => {
    void loadHosts().then((hosts) => useApp.setState({ hosts, hostsLoaded: true }));
    void Promise.all([loadAppearance(), loadAlerts()]).then(() => setThemeLoaded(true));
  }, []);

  const ready = fontsLoaded && hostsLoaded && themeLoaded;
  useEffect(() => {
    if (!ready) return;
    void SplashScreen.hideAsync();
    // A tapped approval notification: the one that started the app, then any while it runs.
    const take = () => {
      const r = alerts.takeOpenRequest();
      if (r) void openFromAlert(r);
    };
    take();
    const sub = alerts.onOpen(take);
    return () => sub?.remove();
  }, [ready]);

  if (!ready) return null;
  return (
    <GestureHandlerRootView className="flex-1 bg-background">
      <BottomSheetModalProvider>
        <StatusBar style={isLight(theme) ? "dark" : "light"} />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: ground }, animation: "fade" }} />
        <Toast />
        <ConfirmDialog />
        <PortalHost />
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
}
