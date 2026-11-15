// İşin kontrol listesi: işaretlenebilir adımlar. Her değişiklik geçmişe düşer
// ve Geri Al ile geri alınabilir. Tüm adımlar bitince iş kendiliğinden
// kapanmaz; yalnızca tamamlansın mı diye sorulur.
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { useApp } from './AppContext';
import { Button } from './components';
import { C, R, SP, TOUCH, areaColor, s } from './theme';
import { ChecklistItem, RecordRow } from '../domain/types';
import { ChangeResult } from '../db/repo';

export function Checklist({ r }: { r: RecordRow }) {
  const { repo, version, refresh, showToast } = useApp();
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  useEffect(() => {
    repo.steps(r.id).then(setItems);
  }, [r.id, version, repo]);

  const done = (res: ChangeResult, msg: string) => {
    refresh();
    showToast(res.ok ? { message: msg, undoHistoryId: res.historyId } : { message: res.reason });
    return res;
  };

  const add = async () => {
    const body = draft.trim();
    if (!body) return;
    const res = done(await repo.addStep(r.id, body, 'text'), 'Adım eklendi.');
    if (res.ok) setDraft('');
  };

  const toggle = async (it: ChecklistItem) => {
    const res = done(await repo.toggleStep(it.id, 'button'), it.done_at ? 'İşaret kaldırıldı.' : 'Adım tamam.');
    if (!res.ok) return;
    const rec = res.record;
    if (rec.status !== 'done' && rec.steps_total && rec.steps_done === rec.steps_total) {
      Alert.alert('Hepsi bitti', `"${rec.title}" işinin tüm adımları tamam. İşi tamamlayayım mı?`, [
        { text: 'Şimdi değil', style: 'cancel' },
        { text: 'Tamamla', onPress: async () => done(await repo.setStatus(rec.id, 'done', 'button'), `"${rec.title}" tamamlandı.`) },
      ]);
    }
  };

  const saveEdit = async (it: ChecklistItem) => {
    setEditing(null);
    if (editText.trim() && editText.trim() !== it.body) done(await repo.renameStep(it.id, editText, 'button'), 'Adım güncellendi.');
  };

  const doneCount = items.filter((i) => i.done_at).length;
  const color = areaColor(r.area);

  return (
    <View style={[s.card, { gap: SP.xs }]}>
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <Text style={s.label}>KONTROL LİSTESİ</Text>
        {items.length ? <Text style={s.muted}>{`${doneCount}/${items.length}`}</Text> : null}
      </View>
      {items.map((it, i) =>
        editing === it.id ? (
          <View key={it.id} style={{ gap: SP.xs, paddingVertical: SP.xs }}>
            <TextInput
              style={s.input}
              placeholderTextColor={C.muted}
              value={editText}
              onChangeText={setEditText}
              onSubmitEditing={() => saveEdit(it)}
              autoFocus
            />
            <View style={[s.row, { gap: 6, flexWrap: 'wrap' }]}>
              <Button small label="Kaydet" kind="primary" onPress={() => saveEdit(it)} />
              <Button small label="↑" disabled={i === 0} accessibilityLabel="Yukarı taşı" onPress={async () => { setEditing(null); done(await repo.moveStep(it.id, -1, 'button'), 'Adım taşındı.'); }} />
              <Button small label="↓" disabled={i === items.length - 1} accessibilityLabel="Aşağı taşı" onPress={async () => { setEditing(null); done(await repo.moveStep(it.id, 1, 'button'), 'Adım taşındı.'); }} />
              <Button small label="Sil" kind="danger" onPress={async () => { setEditing(null); done(await repo.deleteStep(it.id, 'button'), 'Adım silindi.'); }} />
              <Button small label="Vazgeç" kind="ghost" onPress={() => setEditing(null)} />
            </View>
          </View>
        ) : (
          <Pressable
            key={it.id}
            onPress={() => toggle(it)}
            onLongPress={() => {
              setEditText(it.body);
              setEditing(it.id);
            }}
            delayLongPress={350}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: !!it.done_at }}
            accessibilityLabel={it.body}
            accessibilityHint="Düzenlemek, taşımak ya da silmek için uzun bas"
            style={({ pressed }) => [s.row, { gap: SP.sm, minHeight: TOUCH, opacity: pressed ? 0.6 : 1 }]}
          >
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: R.sm,
                borderWidth: 2,
                borderColor: it.done_at ? color : C.border,
                backgroundColor: it.done_at ? color : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {it.done_at ? <Text style={{ color: C.onColor, fontWeight: '800', fontSize: 14 }}>✓</Text> : null}
            </View>
            <Text style={[s.text, { flex: 1 }, it.done_at ? { color: C.done, textDecorationLine: 'line-through' } : null]}>{it.body}</Text>
          </Pressable>
        ),
      )}
      {!items.length ? <Text style={s.muted}>Bu işi adımlara bölebilirsin. Uzun basınca düzenle, taşı, sil.</Text> : null}
      <View style={[s.row, { gap: 8 }]}>
        <TextInput
          style={[s.input, { flex: 1 }]}
          placeholderTextColor={C.muted}
          placeholder="Adım ekle"
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={add}
          returnKeyType="done"
        />
        <Button label="Ekle" onPress={add} disabled={!draft.trim()} />
      </View>
    </View>
  );
}
