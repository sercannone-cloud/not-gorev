import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { useApp } from '../AppContext';
import { Button, Chip, Empty, RecordItem } from '../components';
import { C, s } from '../theme';
import { RecordRow, Entry } from '../../domain/types';
import { TodayView, SearchHit } from '../../db/repo';
import { formatDayShort, formatTimestamp } from '../../domain/dates';

function useLoad<T>(load: () => Promise<T>, deps: unknown[]): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    load().then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return data;
}

function CompleteButton({ r }: { r: RecordRow }) {
  const { repo, refresh, showToast } = useApp();
  return (
    <Button
      small
      label="✓"
      onPress={async () => {
        const res = await repo.setStatus(r.id, 'done', 'button');
        refresh();
        showToast(res.ok ? { message: `"${r.title}" tamamlandı.`, undoHistoryId: res.historyId } : { message: res.reason });
      }}
    />
  );
}

export function TodayScreen() {
  const { repo, area, version, navigate } = useApp();
  const today = repo.today();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const data = useLoad<TodayView>(async () => {
    await repo.ensureRecurrences();
    return repo.listToday(area);
  }, [area, version, today]);
  if (!data) return null;
  const empty = data.overdue.length + data.today.length + data.recurring.length === 0;
  return (
    <View>
      {empty ? <Empty text="Bugün için takip ya da tekrar yok. Tarihsiz işler Açık İşler’de." /> : null}
      {data.overdue.length ? <Text style={[s.section, { color: C.danger }]}>Gecikmiş takipler</Text> : null}
      {data.overdue.map((r) => (
        <RecordItem key={r.id} r={r} today={today} onPress={() => navigate({ name: 'record', id: r.id })} right={<CompleteButton r={r} />} />
      ))}
      {data.today.length ? <Text style={s.section}>Bugün</Text> : null}
      {data.today.map((r) => (
        <RecordItem key={r.id} r={r} today={today} onPress={() => navigate({ name: 'record', id: r.id })} right={<CompleteButton r={r} />} />
      ))}
      {data.recurring.length ? <Text style={s.section}>Haftalık tekrarlar</Text> : null}
      {data.recurring.map((g) => (
        <View key={g.latest.id}>
          <RecordItem
            r={g.latest}
            today={today}
            onPress={() => navigate({ name: 'record', id: g.latest.id })}
            right={<CompleteButton r={g.latest} />}
            extra={
              g.olderOpen.length
                ? `+ ${g.olderOpen.length} önceki hafta açık (en eskisi ${formatDayShort(g.olderOpen[g.olderOpen.length - 1].follow_up_date!)})`
                : undefined
            }
          />
          {g.olderOpen.length ? (
            <Pressable onPress={() => setExpanded((e) => ({ ...e, [g.latest.id]: !e[g.latest.id] }))} style={{ marginTop: -4, marginBottom: 8, marginLeft: 8 }}>
              <Text style={{ color: C.is }}>{expanded[g.latest.id] ? 'Önceki haftaları gizle' : 'Önceki haftaları göster'}</Text>
            </Pressable>
          ) : null}
          {expanded[g.latest.id]
            ? g.olderOpen.map((r) => (
                <View key={r.id} style={{ marginLeft: 16 }}>
                  <RecordItem r={r} today={today} onPress={() => navigate({ name: 'record', id: r.id })} right={<CompleteButton r={r} />} />
                </View>
              ))
            : null}
        </View>
      ))}
    </View>
  );
}

type OpenFilter = 'all' | 'undated' | 'waiting';

export function OpenScreen() {
  const { repo, area, version, navigate } = useApp();
  const today = repo.today();
  const [filter, setFilter] = useState<OpenFilter>('all');
  const data = useLoad(async () => ({ open: await repo.listOpen(area), unclassified: await repo.listUnclassified(area) }), [area, version]);
  if (!data) return null;
  const filtered = data.open.filter((r) =>
    filter === 'undated' ? !r.follow_up_date : filter === 'waiting' ? r.status === 'waiting' : true,
  );
  const categorized = filtered.filter((r) => r.category_id !== null);
  const groups = new Map<string, RecordRow[]>();
  for (const r of categorized) {
    const g = groups.get(r.category_name!) ?? [];
    g.push(r);
    groups.set(r.category_name!, g);
  }
  const uncl = filter === 'all' ? data.unclassified : data.unclassified.filter((r) => filtered.some((f) => f.id === r.id));
  return (
    <View>
      <View style={[s.wrap, { marginTop: 4 }]}>
        <Chip label={`Tümü (${data.open.length})`} selected={filter === 'all'} onPress={() => setFilter('all')} />
        <Chip label={`Tarihsiz (${data.open.filter((r) => !r.follow_up_date).length})`} selected={filter === 'undated'} onPress={() => setFilter('undated')} />
        <Chip label={`Beklemede (${data.open.filter((r) => r.status === 'waiting').length})`} selected={filter === 'waiting'} onPress={() => setFilter('waiting')} />
      </View>
      {uncl.length ? <Text style={[s.section, { color: C.warn }]}>Sınıflandırılacak ({uncl.length})</Text> : null}
      {uncl.map((r) => (
        <RecordItem key={r.id} r={r} today={today} onPress={() => navigate({ name: 'record', id: r.id })} />
      ))}
      {[...groups.entries()].map(([name, rows]) => (
        <View key={name}>
          <Text style={s.section}>{name}</Text>
          {rows.map((r) => (
            <RecordItem key={r.id} r={r} today={today} onPress={() => navigate({ name: 'record', id: r.id })} />
          ))}
        </View>
      ))}
      {filtered.length === 0 && uncl.length === 0 ? <Empty text="Açık iş yok." /> : null}
    </View>
  );
}

export function HistorySearchScreen() {
  const { repo, area, version, navigate } = useApp();
  const today = repo.today();
  const [q, setQ] = useState('');
  const hits = useLoad<SearchHit[] | null>(async () => (q.trim() ? repo.search(area, q) : null), [q, area, version]);
  const hist = useLoad(() => repo.listHistoryView(area), [area, version]);
  return (
    <View>
      <TextInput style={[s.input, { marginTop: 4 }]} placeholder="Ara: başlık, kategori, not metni, irsaliye no…" value={q} onChangeText={setQ} autoCorrect={false} />
      {q.trim() && hits ? (
        <>
          <Text style={s.section}>{hits.length} sonuç</Text>
          {hits.map((h) => (
            <View key={h.record.id}>
              <RecordItem r={h.record} today={today} onPress={() => navigate({ name: 'record', id: h.record.id })} extra={`${h.record.entry_count ?? 0} gelişme`} />
              {h.entries.map((e) => (
                <Pressable key={e.id} onPress={() => navigate({ name: 'record', id: h.record.id })} style={{ marginLeft: 16, marginTop: -4, marginBottom: 8 }}>
                  <Text style={s.muted}>{formatTimestamp(e.created_at)}</Text>
                  <Text style={s.text} numberOfLines={3}>
                    {e.body}
                  </Text>
                </Pressable>
              ))}
            </View>
          ))}
          {hits.length === 0 ? <Empty text="Sonuç yok." /> : null}
        </>
      ) : hist ? (
        <>
          <Text style={s.section}>Son gelişmeler</Text>
          {hist.recentEntries.slice(0, 15).map((e: Entry & { title: string }) => (
            <Pressable key={e.id} onPress={() => navigate({ name: 'record', id: e.record_id })} style={[s.card, { marginBottom: 6 }]}>
              <Text style={s.muted}>
                {formatTimestamp(e.created_at)} · {e.title}
              </Text>
              <Text style={s.text} numberOfLines={2}>
                {e.body}
              </Text>
            </Pressable>
          ))}
          <Text style={s.section}>Tamamlananlar</Text>
          {hist.done.length === 0 ? <Empty text="Henüz tamamlanan yok." /> : null}
          {hist.done.map((r) => (
            <RecordItem key={r.id} r={r} today={today} onPress={() => navigate({ name: 'record', id: r.id })} />
          ))}
          <Text style={s.section}>Bağımsız notlar</Text>
          {hist.notes.length === 0 ? <Empty text="Henüz not yok." /> : null}
          {hist.notes.map((r) => (
            <RecordItem key={r.id} r={r} today={today} onPress={() => navigate({ name: 'record', id: r.id })} />
          ))}
        </>
      ) : null}
    </View>
  );
}

export function TrashScreen() {
  const { repo, version, refresh, showToast } = useApp();
  const rows = useLoad(() => repo.listTrash(), [version]);
  if (!rows) return null;
  return (
    <View>
      {rows.length === 0 ? <Empty text="Çöp kutusu boş." /> : null}
      {rows.map((r) => (
        <View key={r.id} style={[s.card, { marginBottom: 8, gap: 6 }]}>
          <Text style={[s.text, { fontWeight: '600' }]}>{r.title}</Text>
          <Text style={s.muted}>
            {r.area === 'is' ? 'İş' : 'Özel'} · {r.category_name ?? 'Sınıflandırılacak'} · {r.entry_count ?? 0} gelişme · silinme {formatTimestamp(r.deleted_at!)}
          </Text>
          <Button
            small
            label="Geçmişiyle geri yükle"
            onPress={async () => {
              const res = await repo.restore(r.id, 'button');
              refresh();
              showToast(res.ok ? { message: `"${r.title}" geri yüklendi.`, undoHistoryId: res.historyId } : { message: res.reason });
            }}
          />
        </View>
      ))}
    </View>
  );
}

export function RecurrencesScreen() {
  const { repo, area, version, refresh, showToast } = useApp();
  const rows = useLoad(() => repo.listRecurrences(area), [area, version]);
  if (!rows) return null;
  const WEEKDAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
  return (
    <View>
      <Text style={[s.muted, { marginBottom: 8 }]}>
        Yeni tekrar için girişe “Her pazar … ” yaz ya da Kaydet’ten önce “Haftalık tekrar”ı seç. Durdurma tüm seriyi etkiler.
      </Text>
      {rows.length === 0 ? <Empty text="Haftalık tekrar yok." /> : null}
      {rows.map((r) => (
        <View key={r.id} style={[s.card, { marginBottom: 8, gap: 6 }]}>
          <Text style={[s.text, { fontWeight: '600' }]}>{r.title}</Text>
          <Text style={s.muted}>
            Her {WEEKDAYS[r.weekday]} · {r.active ? 'Etkin' : 'Durduruldu'}
          </Text>
          <Button
            small
            label={r.active ? 'Tüm seriyi durdur' : 'Seriyi yeniden başlat'}
            onPress={() =>
              Alert.alert(
                r.active ? 'Tüm seri durdurulsun mu?' : 'Seri yeniden başlatılsın mı?',
                r.active
                  ? `"${r.title}" için yeni haftalar oluşturulmayacak. Mevcut haftalar olduğu gibi kalır.`
                  : `"${r.title}" yeniden başlayınca aradaki haftalar da açık olarak oluşturulur.`,
                [
                  { text: 'Vazgeç', style: 'cancel' },
                  {
                    text: r.active ? 'Seriyi durdur' : 'Başlat',
                    onPress: async () => {
                      await repo.setRecurrenceActive(r.id, !r.active);
                      refresh();
                      showToast({ message: r.active ? 'Seri durduruldu.' : 'Seri yeniden başlatıldı.' });
                    },
                  },
                ],
              )
            }
          />
        </View>
      ))}
    </View>
  );
}
