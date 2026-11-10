// Konuş / Yaz giriş kartı. Ses ve klavye aynı düzenlenebilir alana yazar;
// "Kaydet" önce aynı komut motorundan geçer, komut değilse kayıt olarak saklanır.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { useApp } from './AppContext';
import { Button, Chip, pickDate, PriorityPicker } from './components';
import { C, areaColor, s } from './theme';
import { useSpeech } from './useSpeech';
import { parseInput } from '../domain/commands';
import { answerDate, CommandOutcome, confirmTrash, continueCommand, PendingCommand, runIntent } from '../logic/commandFlow';
import { Area, AREA_LABEL, Category, DEFAULT_PRIORITY, Priority, PRIORITY_LABEL, RecordRow, Source } from '../domain/types';
import { detectPriority, stripPriorityShortcuts } from '../domain/priority';
import { DayString, findDateExpression, formatDayLong, formatDayShort, addDays, WEEKDAY_NAMES } from '../domain/dates';
import { firstLineTitle } from '../domain/turkish';

type Mode = 'task' | 'note' | 'append' | 'next_step' | 'weekly';

const MODE_LABEL: Record<Mode, string> = {
  task: 'Yeni iş aç',
  note: 'Bağımsız not',
  append: 'Mevcut kayda ekle',
  next_step: 'Sonraki adım',
  weekly: 'Haftalık tekrar',
};

let subCounter = 0;
const newSubmissionId = () => `sub-${Date.now().toString(36)}-${(subCounter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function Composer(props: { currentRecord?: RecordRow | null }) {
  const { repo, area: selectedArea, refresh, showToast, navigate, version, quickAction, consumeQuickAction } = useApp();
  const current = props.currentRecord ?? null;
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);

  const [text, setText] = useState('');
  const [source, setSource] = useState<Source>('text');
  const [submissionId, setSubmissionId] = useState(newSubmissionId);
  const [mode, setMode] = useState<Mode>(current ? 'append' : 'task');
  const [area, setArea] = useState<Area>(current?.area ?? selectedArea);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [title, setTitle] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);
  const [followDate, setFollowDate] = useState<DayString | null>(null);
  const [priority, setPriority] = useState<Priority>(DEFAULT_PRIORITY);
  const [priorityTouched, setPriorityTouched] = useState(false);
  const [followText, setFollowText] = useState('');
  const [weekday, setWeekday] = useState<number>(0);
  const [target, setTarget] = useState<RecordRow | null>(current);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerResults, setPickerResults] = useState<RecordRow[]>([]);
  const [message, setMessage] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);
  const [skipCommand, setSkipCommand] = useState(false);
  const [pending, setPending] = useState<{ kind: 'date' | 'target'; p: PendingCommand; question: string; candidates: RecordRow[]; record?: RecordRow } | null>(null);
  const [dateAnswer, setDateAnswer] = useState('');
  const [queue, setQueue] = useState<string[]>([]);
  const [splitTotal, setSplitTotal] = useState(0);
  const [busy, setBusy] = useState(false);

  const today = repo.today();

  // Seçili alan değişince (ve kart boşken) yeni kaydın alanı da değişsin.
  useEffect(() => {
    if (!text && !current) setArea(selectedArea);
  }, [selectedArea]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setTarget(current);
    if (current) setArea(current.area);
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    repo.categories(area).then(setCategories);
  }, [area, repo, version]);

  // Başlık boşsa ilk satır düzenlenebilir başlangıç başlığı olur.
  useEffect(() => {
    if (!titleTouched) setTitle(firstLineTitle(stripPriorityShortcuts(text)));
  }, [text, titleTouched]);

  // Metinde "acil", "kritik", "!!!" gibi bir işaret varsa önem önceden seçili gelir (kullanıcı değiştirmediyse).
  const priorityHint = useMemo(() => detectPriority(text), [text]);
  useEffect(() => {
    if (!priorityTouched) setPriority(priorityHint?.priority ?? DEFAULT_PRIORITY);
  }, [priorityHint?.priority, priorityTouched]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Mevcut kayda ekle" ya da "Hangi kayıt?" için seçili alanda arama.
  const showPicker = (mode === 'append' && !target) || (pending?.kind === 'target' && pending.candidates.length === 0);
  useEffect(() => {
    if (!showPicker) return;
    let alive = true;
    const run = async () => {
      const rows = pickerQuery.trim()
        ? (await repo.search(selectedArea, pickerQuery)).map((h) => h.record)
        : [...(await repo.listOpen(selectedArea)).slice(0, 8)];
      if (alive) setPickerResults(rows.slice(0, 8));
    };
    run();
    return () => {
      alive = false;
    };
  }, [pickerQuery, showPicker, selectedArea, repo, version]);

  const speech = useSpeech((finalText) => {
    // Nihai metin mevcut metnin sonuna eklenir; kullanıcı düzeltebilir.
    setText((prev) => (prev.trim() ? prev.trimEnd() + ' ' + finalText : finalText));
    setSource('voice');
    setSkipCommand(false);
  });

  // Ana ekran kısayolları: "Sesli kayıt" dinlemeyi başlatır, "Yeni kritik iş" yazı alanını Kritik seçili açar.
  useEffect(() => {
    if (!quickAction || current || (quickAction.id !== 'voice' && quickAction.id !== 'critical')) return;
    consumeQuickAction();
    if (quickAction.id === 'voice' && speech.state !== 'listening') speech.start();
    if (quickAction.id === 'critical') {
      setMode('task');
      setPriority(4);
      setPriorityTouched(true);
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [quickAction?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  const modes: Mode[] = current ? ['append', 'next_step', 'task', 'note'] : ['task', 'note', 'append', 'weekly'];
  const lines = useMemo(() => text.split('\n').map((l) => l.trim()).filter(Boolean), [text]);

  function resetDraft(nextText = '') {
    setText(nextText);
    setSource('text');
    setSubmissionId(newSubmissionId());
    setTitle('');
    setTitleTouched(false);
    setFollowDate(null);
    setFollowText('');
    setPriority(DEFAULT_PRIORITY);
    setPriorityTouched(false);
    setSkipCommand(false);
    setPending(null);
    setDateAnswer('');
    setPickerQuery('');
    if (!current) {
      setTarget(null);
      setMode('task');
      setCategoryId(null);
      setArea(selectedArea);
    } else {
      setMode('append');
      setTarget(current);
    }
  }

  function afterSuccess(msg: string, historyId?: number) {
    showToast({ message: msg, undoHistoryId: historyId });
    setMessage(null);
    refresh();
    if (queue.length > 0) {
      const [next, ...rest] = queue;
      setQueue(rest);
      const keepArea = area;
      resetDraft(next);
      setArea(keepArea);
    } else {
      setSplitTotal(0);
      resetDraft();
    }
  }

  async function handleOutcome(out: CommandOutcome): Promise<boolean> {
    switch (out.type) {
      case 'applied':
        afterSuccess(out.message, out.historyId);
        return true;
      case 'open':
        resetDraft();
        setMessage(null);
        navigate({ name: 'record', id: out.recordId });
        return true;
      case 'ask_target':
        setPending({ kind: 'target', p: out.pending, question: out.question, candidates: out.candidates });
        setMessage({ text: out.question, tone: 'info' });
        return true;
      case 'ask_date':
        setPending({ kind: 'date', p: { ...out.pending, recordId: out.record.id }, question: out.question, candidates: [], record: out.record });
        setMessage({ text: `"${out.record.title}" · ${out.question}`, tone: 'info' });
        return true;
      case 'confirm_trash':
        Alert.alert(
          'Çöp kutusuna taşınsın mı?',
          `"${out.record.title}" kaydı ve tüm geçmişi çöp kutusuna taşınacak. Oradan geri yükleyebilirsin.`,
          [
            { text: 'Vazgeç', style: 'cancel', onPress: () => setPending(null) },
            {
              text: 'Çöpe taşı',
              style: 'destructive',
              onPress: async () => {
                const r = await confirmTrash(repo, out.pending);
                if (r.type === 'applied') afterSuccess(r.message, r.historyId);
                else if (r.type === 'error') setMessage({ text: r.message, tone: 'error' });
              },
            },
          ],
        );
        return true;
      case 'error':
        setMessage({ text: out.message, tone: 'error' });
        return true;
      case 'not_command':
        if (out.message) {
          setMessage({ text: out.message + ' Kaydet’e basarsan seçili türde kaydedilir.', tone: 'info' });
          setSkipCommand(true);
          return true;
        }
        return false;
    }
  }

  async function save() {
    if (busy) return;
    const body = stripPriorityShortcuts(text.trim());
    if (!body) {
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      if (!skipCommand) {
        const intent = parseInput(body, today);
        if (intent.kind === 'recurrence' && mode !== 'weekly') {
          setMode('weekly');
          setWeekday(intent.weekday);
          setTitle(intent.title);
          setTitleTouched(true);
          setMessage({ text: `Haftalık tekrar taslağı: her ${WEEKDAY_NAMES[intent.weekday]}. Onaylamak için Kaydet’e bas.`, tone: 'info' });
          setSkipCommand(true);
          return;
        }
        if (intent.kind === 'command') {
          const out = await runIntent(repo, intent, {
            area: current?.area ?? selectedArea,
            currentRecordId: current?.id ?? null,
            source,
            submissionId,
          });
          if (await handleOutcome(out)) return;
        }
      }

      if (mode === 'task' || mode === 'note') {
        const res = await repo.createRecord({
          area,
          categoryId,
          kind: mode,
          title: title.trim() || undefined,
          body,
          followUpDate: mode === 'task' ? followDate : null,
          priority: mode === 'task' ? priority : undefined,
          source,
          submissionId,
        });
        if (!res.ok) {
          if (!res.duplicate) setMessage({ text: res.reason, tone: 'error' });
          return;
        }
        const pr = res.record.kind === 'task' && res.record.priority !== DEFAULT_PRIORITY ? ` · ${PRIORITY_LABEL[res.record.priority]}` : '';
        afterSuccess(`Kaydedildi: "${res.record.title}" · ${AREA_LABEL[res.record.area]} · ${res.record.category_name ?? 'Sınıflandırılacak'}${pr}`, res.historyId);
      } else if (mode === 'append' || mode === 'next_step') {
        if (!target) {
          setMessage({ text: 'Hangi kayda ekleneceğini seç.', tone: 'error' });
          return;
        }
        const res = await repo.addEntry({
          recordId: target.id,
          body,
          entryType: mode === 'next_step' ? 'next_step' : 'progress',
          followUpDate: followDate ?? undefined,
          source,
          submissionId,
        });
        if (!res.ok) {
          if (!res.duplicate) setMessage({ text: res.reason, tone: 'error' });
          return;
        }
        afterSuccess(`"${res.record.title}" kaydına ${mode === 'next_step' ? 'sonraki adım' : 'not'} eklendi.`, res.historyId);
      } else if (mode === 'weekly') {
        const res = await repo.createRecurrence({
          area,
          categoryId,
          title: title.trim() || firstLineTitle(body),
          weekday,
          source,
          submissionId,
        });
        if (!res.ok) {
          if (!res.duplicate) setMessage({ text: res.reason, tone: 'error' });
          return;
        }
        afterSuccess(`Haftalık tekrar kuruldu: her ${WEEKDAY_NAMES[weekday]} · "${res.recurrence.title}"`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function answerPendingDate(answer: string | DayString, isExact = false) {
    if (!pending || pending.kind !== 'date') return;
    setBusy(true);
    try {
      const out = isExact
        ? await continueCommand(repo, { ...pending.p, date: { type: 'date', date: answer } })
        : await answerDate(repo, pending.p, answer, today);
      setDateAnswer('');
      await handleOutcome(out);
    } finally {
      setBusy(false);
    }
  }

  async function chooseTarget(r: RecordRow) {
    if (pending?.kind === 'target') {
      setBusy(true);
      try {
        const out = await continueCommand(repo, { ...pending.p, recordId: r.id });
        setPending(null);
        await handleOutcome(out);
      } finally {
        setBusy(false);
      }
    } else {
      setTarget(r);
      setPickerQuery('');
    }
  }

  function applyFollowText(v: string) {
    setFollowText(v);
    if (!v.trim()) return;
    const d = findDateExpression(v, today);
    if (d?.type === 'date') setFollowDate(d.date);
  }

  const followResolution = followText.trim() ? findDateExpression(followText, today) : null;
  const color = areaColor(area);
  const hasText = text.trim().length > 0;

  return (
    <View style={[s.card, { gap: 10 }]}>
      <View style={[s.row, { gap: 8 }]}>
        <Button
          label={speech.state === 'listening' ? '■ Bitir' : speech.state === 'checking' ? 'Hazırlanıyor…' : '🎙 Konuş'}
          kind="primary"
          color={speech.state === 'listening' ? C.danger : color}
          style={{ flex: 1 }}
          disabled={speech.state === 'checking'}
          onPress={() => (speech.state === 'listening' ? speech.stop() : speech.start())}
        />
        <Button label="⌨ Yaz" style={{ flex: 1 }} onPress={() => inputRef.current?.focus()} />
      </View>

      {speech.state === 'listening' ? (
        <View style={{ backgroundColor: C.dangerSoft, borderRadius: 8, padding: 8 }}>
          <Text style={{ color: C.danger, fontWeight: '600' }}>Dinliyorum… (Türkçe, {speech.routeLabel})</Text>
          {speech.partial ? <Text style={[s.text, { marginTop: 4, fontStyle: 'italic' }]}>{speech.partial}</Text> : null}
          <Pressable onPress={speech.abort} style={{ marginTop: 6 }}>
            <Text style={{ color: C.muted }}>İptal</Text>
          </Pressable>
        </View>
      ) : null}
      {speech.error ? (
        <View style={{ backgroundColor: C.warnSoft, borderRadius: 8, padding: 8, gap: 6 }}>
          <Text style={{ color: C.warn }}>{speech.error}</Text>
          {speech.details ? <Text style={{ color: C.muted, fontSize: 11 }}>Ayrıntı: {speech.details}</Text> : null}
          <View style={[s.row, { gap: 8 }]}>
            {speech.canDownload ? <Button small label="Türkçe paketi indir" onPress={speech.downloadTurkish} /> : null}
            <Button
              small
              label="Yazıyla devam et"
              onPress={() => {
                speech.setError(null);
                inputRef.current?.focus();
              }}
            />
          </View>
        </View>
      ) : null}

      <TextInput
        ref={inputRef}
        style={[s.input, { minHeight: 64, textAlignVertical: 'top' }]}
        multiline
        placeholder={current ? 'Bu kayda not, sonraki adım ya da komut (ör. "Bunu cumaya ertele")' : 'Aklına geleni yaz ya da Konuş’a dokun'}
        value={text}
        onChangeText={(v) => {
          setText(v);
          setSkipCommand(false);
          if (!v.trim()) setMessage(null);
        }}
      />

      {splitTotal > 0 ? (
        <Text style={s.muted}>
          Bölünmüş metin: {splitTotal - queue.length}/{splitTotal}
        </Text>
      ) : null}

      {message ? (
        <Text style={{ color: message.tone === 'error' ? C.danger : C.text, fontWeight: '600' }}>{message.text}</Text>
      ) : null}

      {pending?.kind === 'date' ? (
        <View style={{ gap: 8 }}>
          <View style={s.wrap}>
            {[
              ['Bugün', today],
              ['Yarın', addDays(today, 1)],
            ].map(([label, d]) => (
              <Chip key={label} label={`${label} (${formatDayShort(d)})`} onPress={() => answerPendingDate(d, true)} />
            ))}
            <Chip label="Takvimden seç…" onPress={() => pickDate(null, (d) => answerPendingDate(d, true))} />
          </View>
          <View style={[s.row, { gap: 8 }]}>
            <TextInput
              style={[s.input, { flex: 1 }]}
              placeholder="ör. cuma, 15.11"
              value={dateAnswer}
              onChangeText={setDateAnswer}
              onSubmitEditing={() => answerPendingDate(dateAnswer)}
            />
            <Button label="Tamam" kind="primary" onPress={() => answerPendingDate(dateAnswer)} />
          </View>
          <Pressable onPress={() => { setPending(null); setMessage(null); }}>
            <Text style={s.muted}>Vazgeç (metin taslak olarak kalır)</Text>
          </Pressable>
        </View>
      ) : null}

      {pending?.kind === 'target' && pending.candidates.length > 0 ? (
        <View style={{ gap: 6 }}>
          {pending.candidates.map((r) => (
            <Button
              key={r.id}
              label={`${r.title}${r.follow_up_date ? ' · ' + formatDayShort(r.follow_up_date) : ''}${r.category_name ? ' · ' + r.category_name : ''}`}
              onPress={() => chooseTarget(r)}
            />
          ))}
          <Pressable onPress={() => { setPending(null); setMessage(null); }}>
            <Text style={s.muted}>Vazgeç</Text>
          </Pressable>
        </View>
      ) : null}

      {hasText && !pending ? (
        <>
          <View style={s.wrap}>
            {modes.map((m) => (
              <Chip
                key={m}
                label={m === 'append' && current ? 'Bu kayda ekle' : MODE_LABEL[m]}
                selected={mode === m}
                color={color}
                onPress={() => {
                  setMode(m);
                  setSkipCommand(false);
                  if (m === 'append' && current) setTarget(current);
                }}
              />
            ))}
          </View>

          {mode === 'task' || mode === 'note' || mode === 'weekly' ? (
            <>
              <View style={s.wrap}>
                {(['is', 'ozel'] as Area[]).map((a) => (
                  <Chip
                    key={a}
                    label={AREA_LABEL[a]}
                    selected={area === a}
                    color={areaColor(a)}
                    onPress={() => {
                      if (a !== area) setCategoryId(null);
                      setArea(a);
                    }}
                  />
                ))}
              </View>
              <View style={s.wrap}>
                <Chip label="Sınıflandırılacak" selected={categoryId === null} color={color} onPress={() => setCategoryId(null)} />
                {categories.map((c) => (
                  <Chip key={c.id} label={c.name} selected={categoryId === c.id} color={color} onPress={() => setCategoryId(c.id)} />
                ))}
              </View>
              <TextInput
                style={s.input}
                placeholder="Kayıt başlığı"
                value={title}
                onChangeText={(v) => {
                  setTitle(v);
                  setTitleTouched(true);
                }}
              />
            </>
          ) : null}

          {mode === 'task' ? (
            <View style={{ gap: 6 }}>
              <Text style={s.muted}>Önem:</Text>
              <PriorityPicker
                value={priority}
                onChange={(p) => {
                  setPriority(p);
                  setPriorityTouched(true);
                }}
                hint={!priorityTouched && priorityHint ? `Metinden algılandı: “${priorityHint.match}”. Değiştirmek için dokun.` : null}
              />
            </View>
          ) : null}

          {mode === 'weekly' ? (
            <View style={s.wrap}>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <Chip key={d} label={WEEKDAY_NAMES[d]} selected={weekday === d} color={color} onPress={() => setWeekday(d)} />
              ))}
            </View>
          ) : null}

          {mode === 'append' && !current ? (
            target ? (
              <View style={[s.row, { gap: 8 }]}>
                <Text style={[s.text, { flex: 1, fontWeight: '600' }]} numberOfLines={2}>
                  → {target.title}
                </Text>
                <Button small label="Değiştir" onPress={() => setTarget(null)} />
              </View>
            ) : null
          ) : null}

          {mode === 'task' || mode === 'append' || mode === 'next_step' ? (
            <View style={{ gap: 6 }}>
              <View style={[s.row, { gap: 6, flexWrap: 'wrap' }]}>
                <Text style={s.muted}>Takip tarihi:</Text>
                <Chip label="Yok" selected={followDate === null} onPress={() => { setFollowDate(null); setFollowText(''); }} />
                <Chip label="Bugün" selected={followDate === today} onPress={() => setFollowDate(today)} />
                <Chip label="Yarın" selected={followDate === addDays(today, 1)} onPress={() => setFollowDate(addDays(today, 1))} />
                <Chip label="Takvim…" onPress={() => pickDate(followDate, setFollowDate)} />
              </View>
              <TextInput style={s.input} placeholder="ya da yaz: cuma, 15.11, 3 gün sonra" value={followText} onChangeText={applyFollowText} />
              {followResolution?.type === 'ask' ? <Text style={{ color: C.warn }}>{followResolution.question}</Text> : null}
              {followDate ? <Text style={[s.text, { fontWeight: '600' }]}>📅 {formatDayLong(followDate)}</Text> : null}
            </View>
          ) : null}

          <View style={[s.row, { gap: 8 }]}>
            {lines.length > 1 ? (
              <Button
                label="Satırlara böl"
                onPress={() => {
                  setQueue(lines.slice(1));
                  setSplitTotal(lines.length);
                  setText(lines[0]);
                  setTitleTouched(false);
                }}
              />
            ) : null}
            <Button label={busy ? 'Kaydediliyor…' : 'Kaydet'} kind="primary" color={color} style={{ flex: 1 }} disabled={busy} onPress={save} />
          </View>
          <Pressable onPress={() => { resetDraft(); setQueue([]); setSplitTotal(0); setMessage(null); }}>
            <Text style={s.muted}>Taslağı temizle</Text>
          </Pressable>
        </>
      ) : null}

      {showPicker ? (
        <View style={{ gap: 6 }}>
          <TextInput style={s.input} placeholder="Kayıt ara (seçili alanda)" value={pickerQuery} onChangeText={setPickerQuery} />
          {pickerResults.map((r) => (
            <Button key={r.id} label={r.title + (r.category_name ? ' · ' + r.category_name : '')} onPress={() => chooseTarget(r)} />
          ))}
          {pickerResults.length === 0 ? <Text style={s.muted}>Kayıt bulunamadı.</Text> : null}
        </View>
      ) : null}
    </View>
  );
}
