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
import { isLight, loadTheme } from "../lib/appearance";
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
    void loadTheme().then(() => setThemeLoaded(true));
  }, []);

  const ready = fontsLoaded && hostsLoaded && themeLoaded;
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
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
