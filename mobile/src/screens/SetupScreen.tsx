import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/index.js';
import { useGameStore, loadSession } from '../stores/game.js';
import { connect, sendRegister } from '../lib/network.js';
import { startServer, getServerUrl } from '../lib/server.js';

type Props = NativeStackScreenProps<RootStackParamList, 'Setup'>;

export default function SetupScreen({ navigation }: Props) {
  const [name, setName] = useState('');
  const [serverUrl, setServerUrl] = useState('ws://192.168.43.1:3000');
  const [connecting, setConnecting] = useState(false);
  const { setUsername } = useGameStore();

  useEffect(() => {
    loadSession().then(saved => {
      if (saved) setName(saved);
    });
  }, []);

  async function handleHostGame() {
    if (!name.trim()) {
      Alert.alert('Enter your name first');
      return;
    }
    setConnecting(true);
    try {
      startServer();
      // Give Node.js thread a moment to bind the port
      await new Promise<void>(resolve => setTimeout(resolve, 800));
      await connect(getServerUrl());
      setUsername(name.trim());
      sendRegister(name.trim());
    } catch (e: unknown) {
      Alert.alert('Failed to start server', (e as Error).message);
    } finally {
      setConnecting(false);
    }
  }

  async function handleJoinGame() {
    if (!name.trim()) {
      Alert.alert('Enter your name first');
      return;
    }
    if (!serverUrl.trim()) {
      Alert.alert('Enter the host address');
      return;
    }
    setConnecting(true);
    try {
      const url = serverUrl.trim().startsWith('ws')
        ? serverUrl.trim()
        : `ws://${serverUrl.trim()}`;
      await connect(url);
      setUsername(name.trim());
      sendRegister(name.trim());
    } catch (e: unknown) {
      Alert.alert('Connection failed', (e as Error).message);
    } finally {
      setConnecting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={styles.title}>MeCoil</Text>
      <Text style={styles.subtitle}>Recoil Laser Tag</Text>

      <View style={styles.form}>
        <Text style={styles.label}>Your name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Enter callsign..."
          placeholderTextColor="#666"
          autoCapitalize="words"
          maxLength={20}
        />

        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, connecting && styles.btnDisabled]}
          onPress={handleHostGame}
          disabled={connecting}>
          <Text style={styles.btnText}>
            {connecting ? 'Starting…' : 'Host Game'}
          </Text>
        </TouchableOpacity>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or join</Text>
          <View style={styles.dividerLine} />
        </View>

        <Text style={styles.label}>Host address</Text>
        <TextInput
          style={styles.input}
          value={serverUrl}
          onChangeText={setServerUrl}
          placeholder="192.168.43.1:3000"
          placeholderTextColor="#666"
          autoCapitalize="none"
          keyboardType="url"
        />

        <TouchableOpacity
          style={[styles.btn, styles.btnSecondary, connecting && styles.btnDisabled]}
          onPress={handleJoinGame}
          disabled={connecting}>
          <Text style={styles.btnText}>
            {connecting ? 'Connecting…' : 'Join Game'}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#fff',
    letterSpacing: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    marginBottom: 48,
    letterSpacing: 2,
  },
  form: {
    width: '100%',
    maxWidth: 360,
  },
  label: {
    color: '#aaa',
    fontSize: 12,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  input: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    padding: 14,
    color: '#fff',
    fontSize: 16,
    marginBottom: 16,
  },
  btn: {
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  btnPrimary: {
    backgroundColor: '#e63946',
  },
  btnSecondary: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#444',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#333',
  },
  dividerText: {
    color: '#666',
    paddingHorizontal: 12,
    fontSize: 13,
  },
});
