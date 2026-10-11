import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LibraryProvider } from '@/lib/library';

export const unstable_settings = { initialRouteName: '(tabs)' };

export default function Layout() {
  return <SafeAreaProvider><LibraryProvider><StatusBar style="dark" /><Stack screenOptions={{ headerShown: false }}><Stack.Screen name="(tabs)" /><Stack.Screen name="editor" /></Stack></LibraryProvider></SafeAreaProvider>;
}
