import React from 'react';
import { Pressable, StyleProp, Text, View, ViewStyle } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { C, PRIORITY_COLOR, s } from './theme';
import { Priority, PRIORITIES, PRIORITY_ICON, PRIORITY_LABEL, RecordRow, STATUS_LABEL } from '../domain/types';
import { formatDayShort, DayString } from '../domain/dates';

export function Button(props: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  color?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}) {
  const kind = props.kind ?? 'secondary';
  const bg =
    kind === 'primary' ? props.color ?? C.accent : kind === 'danger' ? C.danger : kind === 'ghost' ? 'transparent' : C.card;
  const fg = kind === 'primary' || kind === 'danger' ? '#fff' : props.color ?? C.text;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      disabled={props.disabled}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          opacity: props.disabled ? 0.4 : pressed ? 0.7 : 1,
          paddingVertical: props.small ? 6 : 11,
          paddingHorizontal: props.small ? 10 : 14,
          borderRadius: 10,
          borderWidth: kind === 'secondary' ? 1 : 0,
          borderColor: C.border,
          alignItems: 'center',
          justifyContent: 'center',
        },
        props.style,
      ]}
    >
      <Text style={{ color: fg, fontWeight: '600', fontSize: props.small ? 13 : 15 }}>{props.label}</Text>
    </Pressable>
  );
}

export function Chip(props: { label: string; selected?: boolean; onPress: () => void; color?: string }) {
  const color = props.color ?? C.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!props.selected }}
      onPress={props.onPress}
      style={{
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: props.selected ? color : C.border,
        backgroundColor: props.selected ? color : C.card,
      }}
    >
      <Text style={{ color: props.selected ? '#fff' : C.text, fontSize: 13 }}>{props.label}</Text>
    </Pressable>
  );
}

export function StatusBadge({ r }: { r: RecordRow }) {
  if (r.kind === 'note') return <Badge label="Not" color={C.muted} />;
  if (!r.status) return null;
  const color = r.status === 'done' ? C.done : r.status === 'waiting' ? C.warn : C.is;
  return <Badge label={STATUS_LABEL[r.status]} color={color} />;
}

export function Badge({ label, color, filled }: { label: string; color: string; filled?: boolean }) {
  return (
    <View style={{ borderWidth: 1, borderColor: color, backgroundColor: filled ? color : 'transparent', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
      <Text style={{ color: filled ? '#fff' : color, fontSize: 11, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

/** Önem rozeti. Varsayılan "Orta" için gösterilmez; göze yalnızca istisnalar çarpar. */
export function PriorityBadge({ priority, showDefault }: { priority: Priority; showDefault?: boolean }) {
  if (priority === 2 && !showDefault) return null;
  return (
    <View accessible accessibilityLabel={`${PRIORITY_LABEL[priority]} öncelik`}>
      <Badge label={`${PRIORITY_ICON[priority]} ${PRIORITY_LABEL[priority]}`} color={PRIORITY_COLOR[priority]} filled={priority === 4} />
    </View>
  );
}

/** Dört parçalı tek seçimli önem seçici (segmented control). Her parça en az 48 dp yüksekliğinde. */
export function PriorityPicker(props: { value: Priority; onChange: (p: Priority) => void; hint?: string | null }) {
  return (
    <View style={{ gap: 4 }}>
      <View accessibilityRole="radiogroup" accessibilityLabel="Önem derecesi" style={[s.row, { borderWidth: 1, borderColor: C.border, borderRadius: 10, overflow: 'hidden' }]}>
        {[...PRIORITIES].reverse().map((p, i) => {
          const selected = props.value === p;
          const color = PRIORITY_COLOR[p];
          return (
            <Pressable
              key={p}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`${PRIORITY_LABEL[p]} öncelik`}
              onPress={() => props.onChange(p)}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 48,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: selected ? color : pressed ? C.bg : C.card,
                borderLeftWidth: i === 0 ? 0 : 1,
                borderColor: C.border,
              })}
            >
              <Text style={{ color: selected ? '#fff' : color, fontWeight: '700', fontSize: 15 }}>{PRIORITY_ICON[p]}</Text>
              <Text style={{ color: selected ? '#fff' : C.text, fontSize: 12, fontWeight: selected ? '700' : '500' }}>{PRIORITY_LABEL[p]}</Text>
            </Pressable>
          );
        })}
      </View>
      {props.hint ? <Text style={s.muted}>{props.hint}</Text> : null}
    </View>
  );
}

export function RecordItem(props: { r: RecordRow; today: DayString; onPress: () => void; extra?: string; right?: React.ReactNode }) {
  const { r, today } = props;
  const overdue = r.follow_up_date && r.follow_up_date < today && r.status !== 'done';
  const priority = r.kind === 'task' ? r.priority ?? 2 : 2;
  const edge = r.status !== 'done' && priority >= 3 ? { borderLeftWidth: priority === 4 ? 4 : 2, borderLeftColor: PRIORITY_COLOR[priority] } : null;
  const a11y = [
    priority !== 2 ? `${PRIORITY_LABEL[priority]} öncelik` : null,
    r.kind === 'note' ? 'Not' : r.status ? STATUS_LABEL[r.status] : null,
    r.title,
    r.follow_up_date ? `${overdue ? 'gecikti, ' : ''}takip ${formatDayShort(r.follow_up_date)}` : null,
    r.category_name ?? 'Sınıflandırılacak',
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={({ pressed }) => [s.card, { marginBottom: 8, opacity: pressed ? 0.7 : 1 }, edge]}
    >
      <View style={[s.row, { gap: 8 }]}>
        <View style={{ flex: 1 }}>
          <Text style={[s.text, { fontWeight: '600' }, r.status === 'done' && { color: C.done, textDecorationLine: 'line-through' }]} numberOfLines={2}>
            {r.title}
          </Text>
          <View style={[s.row, { gap: 6, marginTop: 4, flexWrap: 'wrap' }]}>
            {r.kind === 'task' ? <PriorityBadge priority={priority} /> : null}
            <StatusBadge r={r} />
            {r.follow_up_date ? (
              <Badge label={(overdue ? '🕒 Gecikti · ' : '') + formatDayShort(r.follow_up_date)} color={overdue ? C.danger : C.muted} />
            ) : null}
            <Text style={s.muted} numberOfLines={1}>
              {r.category_name ?? 'Sınıflandırılacak'}
            </Text>
          </View>
          {r.next_step ? (
            <Text style={[s.muted, { marginTop: 4 }]} numberOfLines={1}>
              Sıradaki: {r.next_step}
            </Text>
          ) : r.last_entry_body && r.last_entry_body !== r.title ? (
            <Text style={[s.muted, { marginTop: 4 }]} numberOfLines={1}>
              Son: {r.last_entry_body}
            </Text>
          ) : null}
          {props.extra ? <Text style={[s.muted, { marginTop: 4 }]}>{props.extra}</Text> : null}
        </View>
        {props.right}
      </View>
    </Pressable>
  );
}

export function Empty({ text }: { text: string }) {
  return <Text style={[s.muted, { textAlign: 'center', marginVertical: 24 }]}>{text}</Text>;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Android tarih seçicisini açar ve seçilen günü 'YYYY-MM-DD' olarak döndürür. */
export function pickDate(initial: DayString | null, onPick: (day: DayString) => void) {
  const base = initial ? new Date(Number(initial.slice(0, 4)), Number(initial.slice(5, 7)) - 1, Number(initial.slice(8, 10)), 12) : new Date();
  DateTimePickerAndroid.open({
    value: base,
    mode: 'date',
    firstDayOfWeek: 1,
    onValueChange: (_e, date) => {
      onPick(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`);
    },
  });
}
