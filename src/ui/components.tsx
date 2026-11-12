import React from 'react';
import { AccessibilityActionEvent, AccessibilityActionInfo, Pressable, StyleProp, Text, View, ViewStyle } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { C, PRIORITY_COLOR, R, s, SP, TOUCH } from './theme';
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
  accessibilityLabel?: string;
}) {
  const kind = props.kind ?? 'secondary';
  const bg =
    kind === 'primary' ? props.color ?? C.accent : kind === 'danger' ? C.dangerSoft : kind === 'ghost' ? 'transparent' : C.card;
  const fg = kind === 'primary' ? C.onColor : kind === 'danger' ? C.danger : props.color ?? C.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={{ disabled: !!props.disabled }}
      onPress={props.onPress}
      disabled={props.disabled}
      hitSlop={props.small ? 4 : 0}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          opacity: props.disabled ? 0.45 : pressed ? 0.75 : 1,
          minHeight: props.small ? 40 : TOUCH,
          paddingVertical: props.small ? SP.sm : SP.md,
          paddingHorizontal: props.small ? SP.md : SP.lg,
          borderRadius: props.small ? R.sm + 2 : R.md,
          borderWidth: kind === 'secondary' ? 1 : 0,
          borderColor: C.border,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ scale: pressed && !props.disabled ? 0.98 : 1 }],
        },
        props.style,
      ]}
    >
      <Text style={{ color: fg, fontWeight: '700', fontSize: props.small ? 14 : 15, textAlign: 'center' }}>{props.label}</Text>
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
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => ({
        minHeight: 36,
        justifyContent: 'center',
        paddingHorizontal: SP.md,
        borderRadius: R.pill,
        borderWidth: 1,
        borderColor: props.selected ? color : C.border,
        backgroundColor: props.selected ? color : pressed ? C.sunken : C.card,
      })}
    >
      <Text style={{ color: props.selected ? C.onColor : C.text, fontSize: 13, fontWeight: props.selected ? '700' : '500' }}>
        {props.label}
      </Text>
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
    <View
      style={{
        borderWidth: 1,
        borderColor: color,
        backgroundColor: filled ? color : 'transparent',
        borderRadius: R.pill,
        paddingHorizontal: SP.sm,
        paddingVertical: 1,
      }}
    >
      <Text style={{ color: filled ? C.onColor : color, fontSize: 11, lineHeight: 16, fontWeight: '700' }}>{label}</Text>
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
      <View accessibilityRole="radiogroup" accessibilityLabel="Önem derecesi" style={[s.row, { borderWidth: 1, borderColor: C.border, borderRadius: R.md, overflow: 'hidden' }]}>
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
                backgroundColor: selected ? color : pressed ? C.sunken : C.card,
                borderLeftWidth: i === 0 ? 0 : 1,
                borderColor: C.border,
              })}
            >
              <Text style={{ color: selected ? C.onColor : color, fontWeight: '700', fontSize: 15 }}>{PRIORITY_ICON[p]}</Text>
              <Text style={{ color: selected ? C.onColor : C.text, fontSize: 12, fontWeight: selected ? '700' : '500' }}>{PRIORITY_LABEL[p]}</Text>
            </Pressable>
          );
        })}
      </View>
      {props.hint ? <Text style={s.muted}>{props.hint}</Text> : null}
    </View>
  );
}

export function RecordItem(props: {
  r: RecordRow;
  today: DayString;
  onPress: () => void;
  onLongPress?: () => void;
  extra?: string;
  right?: React.ReactNode;
  accessibilityActions?: AccessibilityActionInfo[];
  onAccessibilityAction?: (e: AccessibilityActionEvent) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { r, today } = props;
  const overdue = r.follow_up_date && r.follow_up_date < today && r.status !== 'done';
  const priority = r.kind === 'task' ? r.priority ?? 2 : 2;
  const edge = r.status !== 'done' && priority >= 3 ? { borderLeftWidth: priority === 4 ? 5 : 3, borderLeftColor: PRIORITY_COLOR[priority] } : null;
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
      onLongPress={props.onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint={props.onLongPress ? 'Hızlı işlemler için uzun bas' : undefined}
      accessibilityActions={props.accessibilityActions}
      onAccessibilityAction={props.onAccessibilityAction}
      style={({ pressed }) => [s.card, { marginBottom: SP.sm + 2, opacity: pressed ? 0.75 : 1 }, edge, props.style]}
    >
      <View style={[s.row, { gap: SP.sm }]}>
        <View style={{ flex: 1 }}>
          <Text style={[s.text, { fontSize: 16, fontWeight: '600' }, r.status === 'done' && { color: C.done, textDecorationLine: 'line-through' }]} numberOfLines={2}>
            {r.title}
          </Text>
          <View style={[s.row, { gap: 6, marginTop: 6, flexWrap: 'wrap' }]}>
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
            <Text style={[s.muted, { marginTop: 6 }]} numberOfLines={1}>
              <Text style={{ fontWeight: '700', color: C.text }}>→ Sıradaki: </Text>
              {r.next_step}
            </Text>
          ) : r.last_entry_body && r.last_entry_body !== r.title ? (
            <Text style={[s.muted, { marginTop: 6 }]} numberOfLines={1}>
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

export function Empty({ text, icon }: { text: string; icon?: string }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: SP.xl, paddingHorizontal: SP.lg, gap: SP.sm }}>
      {icon ? (
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: C.sunken, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 24 }}>{icon}</Text>
        </View>
      ) : null}
      <Text style={[s.muted, { textAlign: 'center', fontSize: 14, lineHeight: 20 }]}>{text}</Text>
    </View>
  );
}

/** Ayrıntı ekranında "etiket: değer" satırı. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 2, paddingVertical: SP.xs }}>
      <Text style={s.label}>{label}</Text>
      {typeof children === 'string' ? <Text style={s.text}>{children}</Text> : children}
    </View>
  );
}

/** Bölüm başlığı; isteğe bağlı sayı ve renk. */
export function SectionTitle({ label, count, color }: { label: string; count?: number; color?: string }) {
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={count !== undefined ? `${label} (${count})` : label}
      style={[s.row, { gap: SP.sm, marginTop: SP.xl, marginBottom: SP.sm }]}
    >
      <Text style={[s.section, { marginTop: 0, marginBottom: 0 }, color ? { color } : null]}>{label}</Text>
      {count !== undefined ? (
        <View style={{ minWidth: 22, paddingHorizontal: 6, borderRadius: R.pill, backgroundColor: C.sunken, alignItems: 'center' }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: color ?? C.muted }}>{count}</Text>
        </View>
      ) : null}
    </View>
  );
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
