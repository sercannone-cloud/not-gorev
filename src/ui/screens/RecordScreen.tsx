import React, { useEffect, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { useApp } from '../AppContext';
import { Badge, Button, Chip, pickDate, PriorityBadge, PriorityPicker, StatusBadge } from '../components';
import { C, areaColor, s } from '../theme';
import { Composer } from '../Composer';
import { Area, AREA_LABEL, Category, Entry, HistoryRow, PRIORITY_LABEL, RecordRow, Recurrence, SOURCE_LABEL } from '../../domain/types';
import { formatDayLong, formatTimestamp, WEEKDAY_NAMES } from '../../domain/dates';
import { ChangeResult } from '../../db/repo';

type TimelineItem = { at: string; kind: 'entry'; e: Entry } | { at: string; kind: 'history'; h: HistoryRow };

const ENTRY_LABEL = { progress: 'Gelişme', next_step: 'Sonraki adım', closing: 'Kapanış' } as const;

export function RecordScreen({ id }: { id: string }) {
  const { repo, version, refresh, showToast, back } = useApp();
  const [r, setR] = useState<RecordRow | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [recurrence, setRecurrence] = useState<Recurrence | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [editArea, setEditArea] = useState<Area>('is');
  const [editCat, setEditCat] = useState<number | null>(null);
  const [cats, setCats] = useState<Category[]>([]);

  useEffect(() => {
    (async () => {
      const rec = await repo.getRecord(id);
      setR(rec);
      setEntries(await repo.entries(id));
      setHistory(await repo.history(id));
      setRecurrence(rec?.recurrence_id ? await repo.getRecurrence(rec.recurrence_id) : null);
    })();
  }, [id, version, repo]);

  useEffect(() => {
    repo.categories(editArea).then(setCats);
  }, [editArea, repo]);

  if (!r) return <Text style={s.muted}>Yükleniyor…</Text>;

  const done = (res: ChangeResult, msg: string) => {
    refresh();
    showToast(res.ok ? { message: msg, undoHistoryId: res.historyId } : { message: res.reason });
  };

  const lastEntry = entries[entries.length - 1];
  const timeline: TimelineItem[] = [
    ...entries.map((e) => ({ at: e.created_at, kind: 'entry' as const, e })),
    ...history.filter((h) => h.action !== 'add_note').map((h) => ({ at: h.created_at, kind: 'history' as const, h })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const startEdit = () => {
    setTitle(r.title);
    setEditArea(r.area);
    setEditCat(r.category_id);
    setEditing(true);
  };

  return (
    <View style={{ gap: 12 }}>
      {r.deleted_at ? (
        <View style={{ backgroundColor: C.dangerSoft, padding: 10, borderRadius: 8 }}>
          <Text style={{ color: C.danger }}>Bu kayıt çöp kutusunda.</Text>
        </View>
      ) : null}

      <View style={[s.card, { gap: 8 }]}>
        {editing ? (
          <>
            <TextInput style={s.input} value={title} onChangeText={setTitle} placeholder="Kayıt başlığı" />
            <View style={s.wrap}>
              {(['is', 'ozel'] as Area[]).map((a) => (
                <Chip key={a} label={AREA_LABEL[a]} selected={editArea === a} color={areaColor(a)} onPress={() => { if (a !== editArea) setEditCat(null); setEditArea(a); }} />
              ))}
            </View>
            <View style={s.wrap}>
              <Chip label="Sınıflandırılacak" selected={editCat === null} onPress={() => setEditCat(null)} color={areaColor(editArea)} />
              {cats.map((c) => (
                <Chip key={c.id} label={c.name} selected={editCat === c.id} onPress={() => setEditCat(c.id)} color={areaColor(editArea)} />
              ))}
            </View>
            <View style={[s.row, { gap: 8 }]}>
              <Button label="Vazgeç" onPress={() => setEditing(false)} style={{ flex: 1 }} />
              <Button
                label="Kaydet"
                kind="primary"
                style={{ flex: 1 }}
                onPress={async () => {
                  const res = await repo.editRecord(r.id, { title, area: editArea, categoryId: editCat }, 'button');
                  setEditing(false);
                  done(res, 'Kayıt güncellendi.');
                }}
              />
            </View>
          </>
        ) : (
          <>
            <Text style={s.h1}>{r.title}</Text>
            <View style={[s.row, { gap: 6, flexWrap: 'wrap' }]}>
              <Badge label={AREA_LABEL[r.area]} color={areaColor(r.area)} />
              {r.kind === 'task' ? <PriorityBadge priority={r.priority} /> : null}
              <StatusBadge r={r} />
              <Text style={s.muted}>{r.category_name ?? 'Sınıflandırılacak'}</Text>
              <Text style={{ color: C.is }} onPress={startEdit}>
                Düzenle
              </Text>
            </View>
          </>
        )}
      </View>

      <View style={[s.card, { gap: 6 }]}>
        <Text style={s.h2}>Durum</Text>
        <Text style={s.text}>
          {r.kind === 'note' ? 'Bağımsız not' : r.status === 'done' ? 'Tamamlandı' : r.status === 'waiting' ? 'Beklemede' : 'Açık'}
          {r.completed_at ? ` · ${formatTimestamp(r.completed_at)}` : ''}
        </Text>
        <Text style={s.muted}>En son gelişme</Text>
        <Text style={s.text}>{lastEntry ? `${lastEntry.body} (${formatTimestamp(lastEntry.created_at)})` : '—'}</Text>
        {r.kind === 'task' ? (
          <>
            <Text style={s.muted}>Önem derecesi</Text>
            {!r.deleted_at && r.status !== 'done' ? (
              <PriorityPicker
                value={r.priority}
                onChange={async (p) => {
                  if (p === r.priority) return;
                  done(await repo.setPriority(r.id, p, 'button'), `Önem derecesi: ${PRIORITY_LABEL[p]}`);
                }}
              />
            ) : (
              <Text style={s.text}>{PRIORITY_LABEL[r.priority]}</Text>
            )}
            <Text style={s.muted}>Sonraki adım</Text>
            <Text style={s.text}>{r.next_step ?? '—'}</Text>
            <Text style={s.muted}>Takip tarihi</Text>
            <Text style={s.text}>{r.follow_up_date ? formatDayLong(r.follow_up_date) : 'Yok (tarihsiz)'}</Text>
          </>
        ) : null}
        {recurrence ? (
          <Text style={s.muted}>
            Haftalık tekrar: her {WEEKDAY_NAMES[recurrence.weekday]} {recurrence.active ? '' : '(durduruldu)'} · Bu işlem yalnızca bu haftaya uygulanır.
          </Text>
        ) : null}
      </View>

      {!r.deleted_at ? (
        <View style={s.wrap}>
          {r.kind === 'task' && r.status !== 'done' ? (
            <Button small label="✓ Tamamla" kind="primary" onPress={async () => done(await repo.setStatus(r.id, 'done', 'button'), `"${r.title}" tamamlandı.`)} />
          ) : null}
          {r.kind === 'task' && r.status === 'open' ? (
            <Button small label="Beklet" onPress={async () => done(await repo.setStatus(r.id, 'waiting', 'button'), `"${r.title}" beklemeye alındı.`)} />
          ) : null}
          {r.kind === 'task' && r.status !== 'open' ? (
            <Button small label="Yeniden aç" onPress={async () => done(await repo.setStatus(r.id, 'open', 'button'), `"${r.title}" yeniden açıldı.`)} />
          ) : null}
          {r.kind === 'task' ? (
            <Button
              small
              label="Takip tarihi…"
              onPress={() =>
                pickDate(r.follow_up_date, async (d) => done(await repo.setFollowUp(r.id, d, 'button'), `Takip tarihi: ${formatDayLong(d)}`))
              }
            />
          ) : null}
          {r.kind === 'task' && r.follow_up_date ? (
            <Button small label="Tarihi kaldır" onPress={async () => done(await repo.setFollowUp(r.id, null, 'button'), 'Takip tarihi kaldırıldı.')} />
          ) : null}
          {r.kind === 'task' && r.next_step ? (
            <Button small label="Sonraki adımı temizle" onPress={async () => done(await repo.setNextStep(r.id, null, 'button'), 'Sonraki adım temizlendi.')} />
          ) : null}
          {!r.recurrence_id ? (
            <Button
              small
              label={r.kind === 'note' ? 'İşe çevir' : 'Nota çevir'}
              onPress={async () => done(await repo.editRecord(r.id, { kind: r.kind === 'note' ? 'task' : 'note' }, 'button'), 'Tür değiştirildi.')}
            />
          ) : null}
          <Button
            small
            label="Çöpe taşı"
            kind="danger"
            onPress={() =>
              Alert.alert('Çöp kutusuna taşınsın mı?', `"${r.title}" kaydı ve tüm geçmişi çöp kutusuna taşınacak. Oradan geri yükleyebilirsin.`, [
                { text: 'Vazgeç', style: 'cancel' },
                {
                  text: 'Çöpe taşı',
                  style: 'destructive',
                  onPress: async () => {
                    done(await repo.trash(r.id, 'button'), `"${r.title}" çöp kutusuna taşındı.`);
                    back();
                  },
                },
              ])
            }
          />
          {recurrence?.active ? (
            <Button
              small
              label="Tüm seriyi durdur…"
              onPress={() =>
                Alert.alert(
                  'Tüm seri durdurulsun mu?',
                  `"${recurrence.title}" için yeni haftalar oluşturulmayacak. Bu işlem tek bir haftayı değil tüm seriyi etkiler. Mevcut haftalar olduğu gibi kalır.`,
                  [
                    { text: 'Vazgeç', style: 'cancel' },
                    {
                      text: 'Seriyi durdur',
                      style: 'destructive',
                      onPress: async () => {
                        await repo.setRecurrenceActive(recurrence.id, false);
                        refresh();
                        showToast({ message: 'Seri durduruldu.' });
                      },
                    },
                  ],
                )
              }
            />
          ) : null}
        </View>
      ) : (
        <Button label="Geçmişiyle geri yükle" onPress={async () => done(await repo.restore(r.id, 'button'), 'Geri yüklendi.')} />
      )}

      {!r.deleted_at ? <Composer currentRecord={r} /> : null}

      <Text style={s.section}>Tarihli geçmiş</Text>
      {timeline.map((t) =>
        t.kind === 'entry' ? (
          <View key={'e' + t.e.id} style={[s.card, { gap: 2 }]}>
            <Text style={s.muted}>
              {formatTimestamp(t.e.created_at)} · {ENTRY_LABEL[t.e.entry_type]} · {SOURCE_LABEL[t.e.source]}
            </Text>
            <Text style={s.text}>{t.e.body}</Text>
          </View>
        ) : (
          <Text key={'h' + t.h.id} style={[s.muted, { marginLeft: 4 }, t.h.undone_at ? { textDecorationLine: 'line-through' } : null]}>
            {formatTimestamp(t.h.created_at)} · {t.h.detail ?? t.h.action} ({SOURCE_LABEL[t.h.source]})
          </Text>
        ),
      )}
    </View>
  );
}
