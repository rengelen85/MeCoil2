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
  Image,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/index.js';
import {
  useGameStore,
  loadSession,
  loadServerUrl,
  saveServerUrl,
} from '../stores/game.js';
import { connect, sendRegister, normalizeServerUrl } from '../lib/network.js';

type Props = NativeStackScreenProps<RootStackParamList, 'Setup'>;

export default function SetupScreen({ navigation: _navigation }: Props) {
  const [name, setName] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [connecting, setConnecting] = useState(false);
  const { setUsername } = useGameStore();

  useEffect(() => {
    loadSession().then(saved => {
      if (saved) setName(saved);
    });
    loadServerUrl().then(saved => {
      if (saved) setServerUrl(saved);
    });
  }, []);

  async function handleConnect() {
    if (!name.trim()) {
      Alert.alert('Enter your name first');
      return;
    }
    if (!serverUrl.trim()) {
      Alert.alert('Enter the server address');
      return;
    }
    setConnecting(true);
    try {
      const url = normalizeServerUrl(serverUrl);
      await connect(url);
      setUsername(name.trim());
      saveServerUrl(serverUrl.trim());
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
      <Image
        source={require('../assets/logo.png')}
        style={styles.logo}
        resizeMode="contain"
      />
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

        <Text style={styles.label}>Server address</Text>
        <TextInput
          style={styles.input}
          value={serverUrl}
          onChangeText={setServerUrl}
          placeholder="mecoil.example.com or 192.168.1.42:3000"
          placeholderTextColor="#666"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Text style={styles.hint}>
          Enter the IP address or hostname of the MeCoil server. Defaults to a
          secure (wss://) connection.
        </Text>

        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, connecting && styles.btnDisabled]}
          onPress={handleConnect}
          disabled={connecting}>
          <Text style={[styles.btnText, styles.btnTextDark]}>
            {connecting ? 'Connecting…' : 'Connect'}
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
  logo: {
    width: 96,
    height: 96,
    marginBottom: 16,
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
    marginBottom: 8,
  },
  hint: {
    color: '#666',
    fontSize: 12,
    marginBottom: 20,
    lineHeight: 16,
  },
  btn: {
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  btnPrimary: {
    backgroundColor: '#00e5ff',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  btnTextDark: {
    color: '#000',
  },
});
