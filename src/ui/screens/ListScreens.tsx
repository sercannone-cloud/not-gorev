import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { useApp } from '../AppContext';
import { Button, Chip, Empty, PriorityBadge, RecordItem, SectionTitle } from '../components';
import { C, PRIORITY_COLOR, R, s, SP, TOUCH } from '../theme';
import { SwipeRow } from '../SwipeRow';
import { TaskRow } from '../TaskRow';
import { PriorityBoard } from '../PriorityBoard';
import { useTaskActions } from '../taskActions';
import { RecordRow, Entry, Priority, PRIORITY_LABEL } from '../../domain/types';
import { TodayView, SearchHit } from '../../db/repo';
import { addDays, DayString, formatDayLong, formatDayShort, formatTime, formatTimestamp, istanbulDayOf } from '../../domain/dates';

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
  const act = useTaskActions();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${r.title} tamamla`}
      onPress={() => act.setStatus(r, 'done')}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 2,
        borderColor: C.ozel,
        backgroundColor: pressed ? C.ozel : C.ozelSoft,
        alignItems: 'center',
        justifyContent: 'center',
      })}
    >
      {({ pressed }) => <Text style={{ color: pressed ? C.onColor : C.ozel, fontSize: 18, fontWeight: '800' }}>✓</Text>}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Tamamlananlar: zaman çizelgesi, sıralama ve gün grupları
// ---------------------------------------------------------------------------

type DoneSort = 'time' | 'priority' | 'category';
const DONE_SORT_LABEL: Record<DoneSort, string> = { time: 'Saate göre', priority: 'Önceliğe göre', category: 'Kategoriye göre' };

function sortDone(rows: RecordRow[], sort: DoneSort): RecordRow[] {
  const byTime = (a: RecordRow, b: RecordRow) => ((a.completed_at ?? '') < (b.completed_at ?? '') ? 1 : -1);
  const copy = [...rows];
  if (sort === 'time') return copy.sort(byTime);
  if (sort === 'priority') return copy.sort((a, b) => b.priority - a.priority || byTime(a, b));
  return copy.sort((a, b) => (a.category_name ?? '').localeCompare(b.category_name ?? '', 'tr') || byTime(a, b));
}

function doneSummary(rows: RecordRow[]): string {
  const critical = rows.filter((r) => r.priority === 4).length;
  return `${rows.length} iş${critical ? ` · ${critical} kritik` : ''}`;
}

/** Tamamlanan bir iş: solda bitiş saati, ince çizgi, üstü çizili başlık. */
function CompletedRow({ r, onPress }: { r: RecordRow; onPress: () => void }) {
  const act = useTaskActions();
  return (
    <SwipeRow bottomInset={0} left={{ label: '↺ Yeniden aç', color: C.is, onTrigger: () => act.setStatus(r, 'open') }}>
      <CompletedRowBody r={r} onPress={onPress} onReopen={() => act.setStatus(r, 'open')} />
    </SwipeRow>
  );
}

function CompletedRowBody({ r, onPress, onReopen }: { r: RecordRow; onPress: () => void; onReopen: () => void }) {
  const time = r.completed_at ? formatTime(r.completed_at) : '';
  return (
    <Pressable
      onPress={onPress}
      accessibilityActions={[{ name: 'reopen', label: 'Yeniden aç' }]}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === 'reopen' && onReopen()}
      accessibilityRole="button"
      accessibilityLabel={`Tamamlandı, saat ${time}, ${r.title}${r.priority !== 2 ? `, ${PRIORITY_LABEL[r.priority]} öncelik` : ''}, ${r.category_name ?? 'Sınıflandırılacak'}`}
      style={({ pressed }) => [s.row, { alignItems: 'stretch', minHeight: 48, backgroundColor: C.card, opacity: pressed ? 0.6 : 1 }]}
    >
      <Text style={[s.muted, { width: 46, paddingTop: 10, fontVariant: ['tabular-nums'] }]}>{time}</Text>
      <View style={{ width: 14, alignItems: 'center' }}>
        <View style={{ width: 2, flex: 1, backgroundColor: C.border }} />
        <View style={{ position: 'absolute', top: 12, width: 12, height: 12, borderRadius: 6, backgroundColor: C.done, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: C.card, fontSize: 8, fontWeight: '800' }}>✓</Text>
        </View>
      </View>
      <View style={{ flex: 1, paddingVertical: 8, paddingLeft: 6, gap: 3 }}>
        <Text style={[s.text, { color: C.done, textDecorationLine: 'line-through' }]} numberOfLines={2}>
          {r.title}
        </Text>
        <View style={[s.row, { gap: 6, flexWrap: 'wrap' }]}>
          <PriorityBadge priority={r.priority} />
          <Text style={s.muted} numberOfLines={1}>
            {r.category_name ?? 'Sınıflandırılacak'}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function DoneSortChips({ value, onChange }: { value: DoneSort; onChange: (v: DoneSort) => void }) {
  return (
    <View style={[s.wrap, { marginBottom: 6 }]}>
      {(Object.keys(DONE_SORT_LABEL) as DoneSort[]).map((k) => (
        <Chip key={k} label={DONE_SORT_LABEL[k]} selected={value === k} onPress={() => onChange(k)} />
      ))}
    </View>
  );
}

/** Bugün ekranının altındaki daraltılabilir "Bugün tamamlanan" bölümü. */
function CompletedToday({ rows }: { rows: RecordRow[] }) {
  const { navigate } = useApp();
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState<DoneSort>('time');
  if (rows.length === 0) return null;
  return (
    <View style={{ marginTop: SP.lg }}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Bugün tamamlanan ${rows.length} iş, ${open ? 'gizle' : 'göster'}`}
        style={[s.row, { minHeight: 48, justifyContent: 'space-between' }]}
      >
        <Text style={[s.section, { marginTop: 0, marginBottom: 0, color: C.ozel }]}>✓ Bugün tamamlanan ({rows.length})</Text>
        <Text style={{ color: C.muted, fontSize: 18 }}>{open ? '▴' : '▾'}</Text>
      </Pressable>
      {open ? (
        <View style={[s.card, { paddingVertical: SP.sm }]}>
          <DoneSortChips value={sort} onChange={setSort} />
          {sortDone(rows, sort).map((r) => (
            <CompletedRow key={r.id} r={r} onPress={() => navigate({ name: 'record', id: r.id })} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function dayHeading(day: DayString, today: DayString): string {
  if (day === today) return 'Bugün';
  if (day === addDays(today, -1)) return 'Dün';
  return formatDayLong(day);
}

/** Geçmiş sekmesindeki tamamlananlar: günlere bölünmüş zaman çizelgesi. */
function CompletedByDay({ rows, today }: { rows: RecordRow[]; today: DayString }) {
  const { navigate } = useApp();
  const [sort, setSort] = useState<DoneSort>('time');
  const days = new Map<DayString, RecordRow[]>();
  for (const r of rows) {
    if (!r.completed_at) continue;
    const d = istanbulDayOf(r.completed_at);
    const g = days.get(d) ?? [];
    g.push(r);
    days.set(d, g);
  }
  const ordered = [...days.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  return (
    <View>
      <DoneSortChips value={sort} onChange={setSort} />
      {ordered.map(([day, list]) => (
        <View key={day} style={[s.card, { marginBottom: 8, paddingVertical: 8 }]}>
          <View style={[s.row, { justifyContent: 'space-between', marginBottom: 2 }]}>
            <Text style={s.h2}>{dayHeading(day, today)}</Text>
            <Text style={s.muted}>{doneSummary(list)}</Text>
          </View>
          {sortDone(list, sort).map((r) => (
            <CompletedRow key={r.id} r={r} onPress={() => navigate({ name: 'record', id: r.id })} />
          ))}
        </View>
      ))}
    </View>
  );
}

export function TodayScreen() {
  const { repo, area, version, navigate } = useApp();
  const today = repo.today();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const data = useLoad<TodayView & { completed: RecordRow[] }>(async () => {
    await repo.ensureRecurrences();
    return { ...(await repo.listToday(area)), completed: await repo.listCompletedToday(area) };
  }, [area, version, today]);
  if (!data) return null;
  const empty = data.overdue.length + data.today.length + data.recurring.length === 0;
  return (
    <View>
      {empty ? (
        <Empty
          icon={data.completed.length ? '🎉' : '☀️'}
          text={
            data.completed.length
              ? `Bugünkü takipler bitti (${data.completed.length} iş tamamlandı). Tarihsiz işler Açık İşler’de.`
              : 'Bugün için takip ya da tekrar yok. Tarihsiz işler Açık İşler’de.'
          }
        />
      ) : null}
      {data.overdue.length ? <SectionTitle label="Gecikmiş takipler" count={data.overdue.length} color={C.danger} /> : null}
      {data.overdue.map((r) => (
        <TaskRow key={r.id} r={r} today={today} right={<CompleteButton r={r} />} />
      ))}
      {data.today.length ? <SectionTitle label="Bugün" count={data.today.length} /> : null}
      {data.today.map((r) => (
        <TaskRow key={r.id} r={r} today={today} right={<CompleteButton r={r} />} />
      ))}
      {data.recurring.length ? <SectionTitle label="Haftalık tekrarlar" count={data.recurring.length} /> : null}
      {data.recurring.map((g) => (
        <View key={g.latest.id}>
          <TaskRow
            r={g.latest}
            today={today}
            right={<CompleteButton r={g.latest} />}
            extra={
              g.olderOpen.length
                ? `+ ${g.olderOpen.length} önceki hafta açık (en eskisi ${formatDayShort(g.olderOpen[g.olderOpen.length - 1].follow_up_date!)})`
                : undefined
            }
          />
          {g.olderOpen.length ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setExpanded((e) => ({ ...e, [g.latest.id]: !e[g.latest.id] }))}
              style={{ minHeight: 40, justifyContent: 'center', marginTop: -6, marginBottom: SP.xs, marginLeft: SP.sm }}
            >
              <Text style={s.link}>{expanded[g.latest.id] ? 'Önceki haftaları gizle' : 'Önceki haftaları göster'}</Text>
            </Pressable>
          ) : null}
          {expanded[g.latest.id]
            ? g.olderOpen.map((r) => (
                <View key={r.id} style={{ marginLeft: 16 }}>
                  <TaskRow r={r} today={today} right={<CompleteButton r={r} />} />
                </View>
              ))
            : null}
        </View>
      ))}
      <CompletedToday rows={data.completed} />
    </View>
  );
}

type OpenFilter = 'all' | 'undated' | 'waiting';
type OpenSort = 'category' | 'priority';

export function OpenScreen() {
  const { repo, area, version, navigate } = useApp();
  const today = repo.today();
  const [filter, setFilter] = useState<OpenFilter>('all');
  const [sort, setSort] = useState<OpenSort>('category');
  const data = useLoad(async () => ({ open: await repo.listOpen(area), unclassified: await repo.listUnclassified(area) }), [area, version]);
  if (!data) return null;
  const filtered = data.open.filter((r) =>
    filter === 'undated' ? !r.follow_up_date : filter === 'waiting' ? r.status === 'waiting' : true,
  );
  const categorized = filtered.filter((r) => r.category_id !== null);
  const groups = new Map<string, { rows: RecordRow[]; priority?: Priority }>();
  if (sort === 'category') {
    for (const r of categorized) {
      const g = groups.get(r.category_name!) ?? { rows: [] };
      g.rows.push(r);
      groups.set(r.category_name!, g);
    }
  }
  const uncl = filter === 'all' ? data.unclassified : data.unclassified.filter((r) => filtered.some((f) => f.id === r.id));
  return (
    <View>
      <View style={[s.wrap, { marginTop: SP.lg }]}>
        <Chip label={`Tümü (${data.open.length})`} selected={filter === 'all'} onPress={() => setFilter('all')} />
        <Chip label={`Tarihsiz (${data.open.filter((r) => !r.follow_up_date).length})`} selected={filter === 'undated'} onPress={() => setFilter('undated')} />
        <Chip label={`Beklemede (${data.open.filter((r) => r.status === 'waiting').length})`} selected={filter === 'waiting'} onPress={() => setFilter('waiting')} />
      </View>
      <View style={[s.row, { gap: SP.sm, marginTop: SP.sm, flexWrap: 'wrap' }]}>
        <Text style={s.label}>SIRALA</Text>
        <Chip label="Kategoriye göre" selected={sort === 'category'} onPress={() => setSort('category')} />
        <Chip label="Önceliğe göre" selected={sort === 'priority'} onPress={() => setSort('priority')} />
      </View>
      {uncl.length ? <SectionTitle label="Sınıflandırılacak" count={uncl.length} color={C.warn} /> : null}
      {uncl.map((r) => (
        <TaskRow key={r.id} r={r} today={today} />
      ))}
      {[...groups.entries()].map(([name, { rows, priority }]) => (
        <View key={name}>
          <SectionTitle label={name} count={rows.length} color={priority && priority !== 2 ? PRIORITY_COLOR[priority] : undefined} />
          {rows.map((r) => (
            <TaskRow key={r.id} r={r} today={today} />
          ))}
        </View>
      ))}
      {sort === 'priority' && categorized.length > 0 ? <PriorityBoard rows={categorized} today={today} /> : null}
      {filtered.length === 0 && uncl.length === 0 ? <Empty icon="✅" text="Açık iş yok." /> : null}
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
      <TextInput style={[s.input, { marginTop: SP.lg }]} placeholderTextColor={C.muted} placeholder="🔍 Ara: başlık, kategori, not metni, irsaliye no…" value={q} onChangeText={setQ} autoCorrect={false} />
      {q.trim() && hits ? (
        <>
          <SectionTitle label="Sonuçlar" count={hits.length} />
          {hits.map((h) => (
            <View key={h.record.id}>
              <RecordItem r={h.record} today={today} onPress={() => navigate({ name: 'record', id: h.record.id })} extra={`${h.record.entry_count ?? 0} gelişme`} />
              {h.entries.map((e) => (
                <Pressable
                  key={e.id}
                  onPress={() => navigate({ name: 'record', id: h.record.id })}
                  style={{ marginLeft: SP.lg, marginTop: -4, marginBottom: SP.sm, paddingLeft: SP.md, borderLeftWidth: 2, borderColor: C.border }}
                >
                  <Text style={s.muted}>{formatTimestamp(e.created_at)}</Text>
                  <Text style={s.text} numberOfLines={3}>
                    {e.body}
                  </Text>
                </Pressable>
              ))}
            </View>
          ))}
          {hits.length === 0 ? <Empty icon="🔍" text="Sonuç yok." /> : null}
        </>
      ) : hist ? (
        <>
          <SectionTitle label="Son gelişmeler" />
          {hist.recentEntries.slice(0, 15).map((e: Entry & { title: string }) => (
            <Pressable key={e.id} onPress={() => navigate({ name: 'record', id: e.record_id })} style={({ pressed }) => [s.card, { marginBottom: SP.sm, gap: 2, opacity: pressed ? 0.75 : 1 }]}>
              <Text style={s.muted} numberOfLines={1}>
                {formatTimestamp(e.created_at)} · {e.title}
              </Text>
              <Text style={s.text} numberOfLines={2}>
                {e.body}
              </Text>
            </Pressable>
          ))}
          <SectionTitle label="Tamamlananlar" count={hist.done.length} />
          {hist.done.length === 0 ? <Empty text="Henüz tamamlanan yok." /> : <CompletedByDay rows={hist.done} today={today} />}
          <SectionTitle label="Bağımsız notlar" count={hist.notes.length} />
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
      {rows.length === 0 ? <Empty icon="🗑" text="Çöp kutusu boş." /> : null}
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
      {rows.length === 0 ? <Empty icon="🔁" text="Haftalık tekrar yok." /> : null}
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
