import { CONTRACT_VERSION } from '@track/shared';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

// M0 placeholder. Background tracking starts as a spike in M1 (docs/roadmap.md).
export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Track</Text>
      <Text style={styles.meta}>Runner app scaffold · contract v{CONTRACT_VERSION}</Text>
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
