import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Modal,
  Alert,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/index.js';
import { useGameStore, RoomInfo } from '../stores/game.js';
import {
  sendListRooms,
  sendJoinRoom,
  sendCreateRoom,
} from '../lib/network.js';

type Props = NativeStackScreenProps<RootStackParamList, 'RoomSelect'>;

export default function RoomSelectScreen(_props: Props) {
  const { rooms } = useGameStore();
  const [showCreate, setShowCreate] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');

  useEffect(() => {
    sendListRooms();
    const interval = setInterval(sendListRooms, 3_000);
    return () => clearInterval(interval);
  }, []);

  function handleCreate() {
    if (!newRoomName.trim()) {
      Alert.alert('Enter a room name');
      return;
    }
    sendCreateRoom(newRoomName.trim());
    setShowCreate(false);
    setNewRoomName('');
  }

  function renderRoom({ item }: { item: RoomInfo }) {
    return (
      <TouchableOpacity
        style={styles.roomRow}
        onPress={() => sendJoinRoom(item.id)}>
        <View>
          <Text style={styles.roomName}>{item.name}</Text>
          <Text style={styles.roomMeta}>
            {item.playerCount} player{item.playerCount !== 1 ? 's' : ''} ·{' '}
            {item.state}
          </Text>
        </View>
        <Text style={styles.joinArrow}>›</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Game Rooms</Text>

      <FlatList
        data={rooms}
        keyExtractor={r => String(r.id)}
        renderItem={renderRoom}
        ListEmptyComponent={
          <Text style={styles.empty}>No rooms yet. Create one!</Text>
        }
        style={styles.list}
      />

      <TouchableOpacity
        style={styles.createBtn}
        onPress={() => setShowCreate(true)}>
        <Text style={styles.createBtnText}>+ Create Room</Text>
      </TouchableOpacity>

      <Modal visible={showCreate} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>New Room</Text>
            <TextInput
              style={styles.input}
              value={newRoomName}
              onChangeText={setNewRoomName}
              placeholder="Room name…"
              placeholderTextColor="#666"
              autoFocus
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={[styles.btn, styles.btnSecondary]}
                onPress={() => setShowCreate(false)}>
                <Text style={styles.btnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary]}
                onPress={handleCreate}>
                <Text style={styles.btnText}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    padding: 20,
  },
  heading: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
    marginTop: 48,
  },
  list: {
    flex: 1,
  },
  roomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#333',
  },
  roomName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  roomMeta: {
    color: '#888',
    fontSize: 13,
    marginTop: 2,
  },
  joinArrow: {
    color: '#888',
    fontSize: 24,
  },
  empty: {
    color: '#666',
    textAlign: 'center',
    marginTop: 40,
  },
  createBtn: {
    backgroundColor: '#e63946',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  createBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 24,
  },
  modalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  input: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    padding: 14,
    color: '#fff',
    fontSize: 16,
    marginBottom: 16,
  },
  modalBtns: {
    flexDirection: 'row',
    gap: 12,
  },
  btn: {
    flex: 1,
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
  },
  btnPrimary: { backgroundColor: '#e63946' },
  btnSecondary: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#444',
  },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
