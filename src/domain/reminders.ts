// Günlük özet bildiriminin içeriği. Saf mantık: veritabanı ya da bildirim
// modülü bilmez, bu yüzden testte doğrudan denenebilir.

import type { ReminderInput } from '../db/repo';
import { addDays, DayString, ISTANBUL_OFFSET_MINUTES, mondayOf, weekdayOf } from './dates';

export interface DaySummary {
  /** Takip tarihi tam o güne düşen işler (tekrarlar hariç). */
  due: number;
  /** O gün zamanı gelen haftalık tekrarlar. */
  recurring: number;
  /** O güne kadar takip tarihi geçmiş ve hâlâ açık olanlar (eski tekrar haftaları dahil). */
  overdue: number;
}

export interface PlannedReminder {
  day: DayString;
  /** Bildirimin çalacağı an. */
  at: Date;
  summary: DaySummary;
  body: string;
}

export const DEFAULT_REMINDER_TIME = '09:00';
/** Uygulama açılmasa da bu kadar gün ileriye bildirim kurulur. */
export const REMINDER_DAYS_AHEAD = 14;

/** "09:00" gibi bir saati doğrular ve [saat, dakika] döndürür. */
export function parseTime(hhmm: string | null | undefined): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h <= 23 && min <= 59) return [h, min];
  }
  return [9, 0];
}

/**
 * Verilen gün için özet. Bugünden sonraki günlerde, bugün açık olan işlerin
 * o güne kadar açık kalacağı ve henüz oluşmamış tekrar haftalarının o gün
 * açılacağı varsayılır. Veri değiştikçe plan yeniden kurulur.
 */
export function summarizeDay(input: ReminderInput, day: DayString): DaySummary {
  const out: DaySummary = { due: 0, recurring: 0, overdue: 0 };
  for (const r of input.followUps) {
    if (r.follow_up_date < day) out.overdue++;
    else if (r.follow_up_date === day) {
      if (r.recurrence_id) out.recurring++;
      else out.due++;
    }
  }
  const existing = new Set(input.instances.map((i) => `${i.recurrence_id}|${i.week_start}`));
  for (const rec of input.recurrences) {
    if (weekdayOf(day) !== rec.weekday || day < rec.start_date) continue;
    if (!existing.has(`${rec.id}|${mondayOf(day)}`)) out.recurring++;
  }
  return out;
}

export function summaryText(s: DaySummary): string | null {
  const parts: string[] = [];
  if (s.due) parts.push(`${s.due} takip`);
  if (s.recurring) parts.push(`${s.recurring} tekrar`);
  if (s.overdue) parts.push(`${s.overdue} gecikmiş`);
  return parts.length ? `Bugün ${parts.join(', ')}` : null;
}

/** İstanbul'da verilen gün ve saatteki an. */
export function istanbulAt(day: DayString, hour: number, minute: number): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour, minute) - ISTANBUL_OFFSET_MINUTES * 60_000);
}

/**
 * Önümüzdeki günler için günde en fazla bir özet bildirimi planlar. Saati
 * geçmiş bugün ve gösterecek bir şeyi olmayan günler atlanır.
 */
export function planReminders(
  input: ReminderInput,
  now: Date,
  today: DayString,
  time: string,
  days = REMINDER_DAYS_AHEAD,
): PlannedReminder[] {
  const [h, min] = parseTime(time);
  const out: PlannedReminder[] = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(today, i);
    const at = istanbulAt(day, h, min);
    if (at.getTime() <= now.getTime()) continue;
    const summary = summarizeDay(input, day);
    const body = summaryText(summary);
    if (body) out.push({ day, at, summary, body });
  }
  return out;
}
