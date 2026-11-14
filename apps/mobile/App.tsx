import { CONTRACT_VERSION } from '@track/shared';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, useColorScheme, View } from 'react-native';

// Explicit colors for both appearances: with userInterfaceStyle "automatic" the system
// background turns black in Dark Mode, while React Native text stays black by default.
const colors = {
  light: { background: '#ffffff', text: '#111111' },
  dark: { background: '#000000', text: '#f2f2f2' },
};

// M0 placeholder. Background tracking starts as a spike in M1 (docs/roadmap.md).
export default function App() {
  const theme = colors[useColorScheme() === 'dark' ? 'dark' : 'light'];

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Text style={[styles.title, { color: theme.text }]}>Track</Text>
      <Text style={[styles.meta, { color: theme.text }]}>
        Runner app scaffold · contract v{CONTRACT_VERSION}
      </Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
  },
  meta: {
    marginTop: 8,
    opacity: 0.6,
  },
});
