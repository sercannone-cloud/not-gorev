// Bir iş kartına uzun basınca açılan hızlı işlemler paneli.
import React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useApp } from './AppContext';
import { Button, pickDate, PriorityPicker } from './components';
import { useReduceMotion } from './feedback';
import { useTaskActions } from './taskActions';
import { C, s } from './theme';
import { addDays } from '../domain/dates';

export function ActionSheet() {
  const { sheetRecord: r, openActions, navigate, repo } = useApp();
  const act = useTaskActions();
  const reduceMotion = useReduceMotion();
  const close = () => openActions(null);
  if (!r) return null;
  const run = (fn: () => unknown) => {
    close();
    fn();
  };
  return (
    <Modal transparent visible animationType={reduceMotion ? 'none' : 'slide'} onRequestClose={close}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={close} accessibilityLabel="Kapat" />
      <View style={{ backgroundColor: C.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, gap: 12 }}>
        <Text style={s.h2} numberOfLines={2}>
          {r.title}
        </Text>
        <Text style={s.muted}>Önem derecesi</Text>
        <PriorityPicker value={r.priority} onChange={(p) => run(() => p !== r.priority && act.setPriority(r, p))} />
        <View style={[s.row, { gap: 8 }]}>
          <Button label="✓ Tamamla" kind="primary" color={C.ozel} style={{ flex: 1, minHeight: 48 }} onPress={() => run(() => act.setStatus(r, 'done'))} />
          {r.status === 'waiting' ? (
            <Button label="↺ Yeniden aç" style={{ flex: 1, minHeight: 48 }} onPress={() => run(() => act.setStatus(r, 'open'))} />
          ) : (
            <Button label="⏸ Beklet" style={{ flex: 1, minHeight: 48 }} onPress={() => run(() => act.setStatus(r, 'waiting'))} />
          )}
        </View>
        <View style={[s.row, { gap: 8 }]}>
          <Button label="Yarına ertele" style={{ flex: 1, minHeight: 48 }} onPress={() => run(() => act.setFollowUp(r, addDays(repo.today(), 1)))} />
          <Button label="📅 Takvim…" style={{ flex: 1, minHeight: 48 }} onPress={() => run(() => pickDate(r.follow_up_date, (d) => act.setFollowUp(r, d)))} />
        </View>
        <View style={[s.row, { gap: 8 }]}>
          <Button label="Kaydı aç" kind="ghost" style={{ flex: 1, minHeight: 48 }} onPress={() => run(() => navigate({ name: 'record', id: r.id }))} />
          <Button label="Kapat" kind="ghost" style={{ flex: 1, minHeight: 48 }} onPress={close} />
        </View>
      </View>
    </Modal>
  );
}
