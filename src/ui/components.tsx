import React from 'react';
import { Pressable, StyleProp, Text, View, ViewStyle } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { C, s } from './theme';
import { RecordRow, STATUS_LABEL } from '../domain/types';
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

export function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ borderWidth: 1, borderColor: color, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
      <Text style={{ color, fontSize: 11, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

export function RecordItem(props: { r: RecordRow; today: DayString; onPress: () => void; extra?: string; right?: React.ReactNode }) {
  const { r, today } = props;
  const overdue = r.follow_up_date && r.follow_up_date < today && r.status !== 'done';
  return (
    <Pressable onPress={props.onPress} style={({ pressed }) => [s.card, { marginBottom: 8, opacity: pressed ? 0.7 : 1 }]}>
      <View style={[s.row, { gap: 8 }]}>
        <View style={{ flex: 1 }}>
          <Text style={[s.text, { fontWeight: '600' }, r.status === 'done' && { color: C.done, textDecorationLine: 'line-through' }]} numberOfLines={2}>
            {r.title}
          </Text>
          <View style={[s.row, { gap: 6, marginTop: 4, flexWrap: 'wrap' }]}>
            <StatusBadge r={r} />
            {r.follow_up_date ? (
              <Badge label={(overdue ? 'Gecikti · ' : '') + formatDayShort(r.follow_up_date)} color={overdue ? C.danger : C.muted} />
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
