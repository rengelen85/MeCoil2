import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useGameStore, Screen } from './src/stores/game.js';
import { RootStackParamList } from './src/navigation/index.js';

import SetupScreen from './src/screens/SetupScreen.js';
import RoomSelectScreen from './src/screens/RoomSelectScreen.js';
import LobbyScreen from './src/screens/LobbyScreen.js';
import InGameScreen from './src/screens/InGameScreen.js';
import EndScreen from './src/screens/EndScreen.js';

const Stack = createNativeStackNavigator<RootStackParamList>();

const SCREEN_TO_ROUTE: Record<Screen, keyof RootStackParamList> = {
  setup: 'Setup',
  roomselect: 'RoomSelect',
  lobby: 'Lobby',
  ingame: 'InGame',
  end: 'End',
};

function ScreenRouter() {
  const { screen } = useGameStore();
  const navigation = useNavigation<any>();

  useEffect(() => {
    navigation.navigate(SCREEN_TO_ROUTE[screen]);
  }, [screen]);

  return null;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName="Setup"
          screenOptions={{ headerShown: false, animation: 'fade' }}>
          <Stack.Screen name="Setup" component={SetupScreen} />
          <Stack.Screen name="RoomSelect" component={RoomSelectScreen} />
          <Stack.Screen name="Lobby" component={LobbyScreen} />
          <Stack.Screen name="InGame" component={InGameScreen} />
          <Stack.Screen name="End" component={EndScreen} />
        </Stack.Navigator>
        <ScreenRouter />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
