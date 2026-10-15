import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { loadHosts } from "../lib/hosts";
import { useApp } from "../lib/store";
import { C, FONT_FILES } from "../theme";
import { ConfirmDialog } from "../ui/Confirm";
import { Toast } from "../ui/Toast";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts(FONT_FILES);
  const hostsLoaded = useApp((s) => s.hostsLoaded);

  useEffect(() => {
    void loadHosts().then((hosts) => useApp.setState({ hosts, hostsLoaded: true }));
  }, []);

  useEffect(() => {
    if (fontsLoaded && hostsLoaded) void SplashScreen.hideAsync();
  }, [fontsLoaded, hostsLoaded]);

  if (!fontsLoaded || !hostsLoaded) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: C.ground }}>
      <BottomSheetModalProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.ground }, animation: "fade" }} />
        <Toast />
        <ConfirmDialog />
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
}
