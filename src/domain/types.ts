import type { DayString } from './dates';

export type Area = 'is' | 'ozel';
export const AREA_LABEL: Record<Area, string> = { is: 'İş', ozel: 'Özel' };

export type RecordKind = 'task' | 'note';
export type TaskStatus = 'open' | 'waiting' | 'done';
export const STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'Açık',
  waiting: 'Beklemede',
  done: 'Tamamlandı',
};

/** Girişin kaynağı: konuşma dökümü, klavye ya da ekrandaki düğme. */
export type Source = 'voice' | 'text' | 'button';
export const SOURCE_LABEL: Record<Source, string> = { voice: 'sesle', text: 'yazıyla', button: 'düğmeyle' };

export type EntryType = 'progress' | 'next_step' | 'closing';

export interface Category {
  id: number;
  area: Area;
  name: string;
  sort_order: number;
}

export interface RecordRow {
  id: string;
  area: Area;
  category_id: number | null;
  category_name: string | null;
  kind: RecordKind;
  title: string;
  status: TaskStatus | null;
  next_step: string | null;
  follow_up_date: DayString | null;
  recurrence_id: string | null;
  week_start: DayString | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  deleted_at: string | null;
  version: number;
  last_entry_body?: string | null;
  last_entry_at?: string | null;
  entry_count?: number;
}

export interface Entry {
  id: string;
  record_id: string;
  body: string;
  entry_type: EntryType;
  source: Source;
  created_at: string;
}

export type HistoryAction =
  | 'create'
  | 'add_note'
  | 'complete'
  | 'hold'
  | 'reopen'
  | 'set_follow_up'
  | 'set_next_step'
  | 'edit'
  | 'trash'
  | 'restore'
  | 'undo';

export interface HistoryRow {
  id: number;
  record_id: string;
  action: HistoryAction;
  source: Source;
  detail: string | null;
  created_at: string;
  undone_at: string | null;
}

export interface Recurrence {
  id: string;
  area: Area;
  category_id: number | null;
  title: string;
  weekday: number; // 0 = Pazar
  start_date: DayString;
  active: number;
}

export const DEFAULT_CATEGORIES: Record<Area, string[]> = {
  is: [
    'Mal Kabul ve İthalat',
    'Stok, Sayım ve SKT',
    'Fabrika Sevki ve Depolar Arası Transfer',
    'Sipariş, Sevkiyat ve İrsaliye',
    'Kargo, Araç ve 3PL',
    'İade ve Mutabakat',
    'E-ticaret ve Kampanya',
    'ERP, WMS ve Süreç Geliştirme',
  ],
  ozel: ['Ev ve Faturalar', 'Aile', 'Araç', 'Alışveriş', 'Kişisel Hedefler ve Projeler'],
};

export const UNCLASSIFIED_LABEL = 'Sınıflandırılacak';
