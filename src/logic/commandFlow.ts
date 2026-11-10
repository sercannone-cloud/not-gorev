// Uygulama katmanı: yorumlayıcının önerdiği işlemi hedef kayda bağlar,
// eksik bilgiyi sorar, silmede onay ister ve geri alınabilir değişikliği uygular.

import { Repo, ChangeResult } from '../db/repo';
import { CommandAction, CommandDate, Intent } from '../domain/commands';
import { DayString, findDateExpression, formatDayLong } from '../domain/dates';
import { Area, Priority, PRIORITY_LABEL, RecordRow, Source } from '../domain/types';

export interface CommandContext {
  area: Area;
  /** Ekranda açık olan kayıt (yalnızca kayıt detayında dolu). */
  currentRecordId: string | null;
  source: Source;
  submissionId?: string;
}

/** Eksik bilgi tamamlanana kadar oturumda tutulan taslak komut. */
export interface PendingCommand {
  action: CommandAction;
  recordId?: string;
  date?: CommandDate;
  noteText?: string;
  priority?: Priority;
  source: Source;
  submissionId?: string;
}

export type CommandOutcome =
  | { type: 'applied'; message: string; historyId: number; record: RecordRow }
  | { type: 'open'; recordId: string }
  | { type: 'ask_target'; question: string; candidates: RecordRow[]; pending: PendingCommand }
  | { type: 'ask_date'; question: string; record: RecordRow; pending: PendingCommand }
  | { type: 'confirm_trash'; record: RecordRow; pending: PendingCommand }
  | { type: 'error'; message: string }
  | { type: 'not_command'; message?: string };

const MAX_CANDIDATES = 3;

function suitable(action: CommandAction, r: RecordRow): boolean {
  switch (action) {
    case 'complete':
    case 'hold':
    case 'postpone':
    case 'set_priority':
      return r.kind === 'task' && r.status !== 'done';
    case 'reopen':
      return r.kind === 'task' && r.status !== 'open';
    default:
      return true;
  }
}

/** Yorumlanan girdiyi işler. Komut değilse 'not_command' döner. */
export async function runIntent(repo: Repo, intent: Intent, ctx: CommandContext): Promise<CommandOutcome> {
  if (intent.kind !== 'command') return { type: 'not_command' };

  const pending: PendingCommand = {
    action: intent.action,
    date: intent.date,
    noteText: intent.noteText,
    priority: intent.priority,
    source: ctx.source,
    submissionId: ctx.submissionId,
  };

  if (intent.action === 'add_note' && !intent.noteText?.trim()) {
    return { type: 'error', message: 'Eklenecek notu yaz: "Not ekle: …"' };
  }

  if (intent.target.type === 'this' || intent.target.type === 'none') {
    // "Bunu" yalnızca açık kayıt detayına bağlanır.
    if (ctx.currentRecordId) {
      return continueCommand(repo, { ...pending, recordId: ctx.currentRecordId });
    }
    return { type: 'ask_target', question: 'Hangi kayıt?', candidates: [], pending };
  }

  const all = await repo.findByName(ctx.area, intent.target.name);
  const matches = all.filter((r) => suitable(intent.action, r));
  if (matches.length === 0) {
    const anyMatch = all.length > 0;
    return {
      type: 'not_command',
      message: anyMatch
        ? `"${intent.target.name}" için bu işleme uygun kayıt yok. Metin not taslağı olarak duruyor.`
        : `"${intent.target.name}" adlı bir kayıt bulunamadı. Metin not taslağı olarak duruyor.`,
    };
  }
  if (matches.length > 1) {
    // Son güncellenen kaydı kendiliğinden seçme: en fazla üç aday göster.
    return { type: 'ask_target', question: 'Hangi kayıt?', candidates: matches.slice(0, MAX_CANDIDATES), pending };
  }
  return continueCommand(repo, { ...pending, recordId: matches[0].id });
}

function resultMessage(action: CommandAction, r: RecordRow): string {
  const t = `"${r.title}"`;
  switch (action) {
    case 'complete':
      return `${t} tamamlandı.`;
    case 'hold':
      return `${t} beklemeye alındı.`;
    case 'reopen':
      return `${t} yeniden açıldı.`;
    case 'postpone':
      return r.follow_up_date
        ? `${t} takip tarihi: ${formatDayLong(r.follow_up_date)}.`
        : `${t} takip tarihi kaldırıldı.`;
    case 'add_note':
      return `${t} kaydına not eklendi.`;
    case 'trash':
      return `${t} çöp kutusuna taşındı.`;
    case 'set_priority':
      return `${t} önem derecesi: ${PRIORITY_LABEL[r.priority]}.`;
    default:
      return `${t} güncellendi.`;
  }
}

function fromChange(action: CommandAction, res: ChangeResult): CommandOutcome {
  if (!res.ok) return { type: 'error', message: res.reason };
  return { type: 'applied', message: resultMessage(action, res.record), historyId: res.historyId, record: res.record };
}

/** Hedef kayıt belli olduktan sonra komutu tamamlar. */
export async function continueCommand(repo: Repo, p: PendingCommand): Promise<CommandOutcome> {
  if (!p.recordId) return { type: 'ask_target', question: 'Hangi kayıt?', candidates: [], pending: p };
  const record = await repo.getRecord(p.recordId);
  if (!record || record.deleted_at) return { type: 'error', message: 'Kayıt bulunamadı.' };

  switch (p.action) {
    case 'open':
      return { type: 'open', recordId: record.id };
    case 'trash':
      return { type: 'confirm_trash', record, pending: p };
    case 'complete':
      return fromChange(p.action, await repo.setStatus(record.id, 'done', p.source, p.submissionId));
    case 'hold':
      return fromChange(p.action, await repo.setStatus(record.id, 'waiting', p.source, p.submissionId));
    case 'reopen':
      return fromChange(p.action, await repo.setStatus(record.id, 'open', p.source, p.submissionId));
    case 'set_priority':
      return fromChange(p.action, await repo.setPriority(record.id, p.priority ?? 2, p.source, p.submissionId));
    case 'add_note':
      return fromChange(
        p.action,
        await repo.addEntry({ recordId: record.id, body: p.noteText ?? '', source: p.source, submissionId: p.submissionId }),
      );
    case 'postpone': {
      if (!p.date || p.date.type === 'missing') {
        return { type: 'ask_date', question: 'Hangi gün?', record, pending: p };
      }
      if (p.date.type === 'ask') {
        return { type: 'ask_date', question: p.date.question, record, pending: p };
      }
      return fromChange(p.action, await repo.setFollowUp(record.id, p.date.date, p.source, p.submissionId));
    }
  }
}

/** "Hangi gün?" sorusuna verilen yanıtla bekleyen komutu tamamlar. */
export async function answerDate(repo: Repo, p: PendingCommand, answer: string, today: DayString): Promise<CommandOutcome> {
  const d = findDateExpression(answer, today);
  if (!d) {
    const record = p.recordId ? await repo.getRecord(p.recordId) : null;
    if (!record) return { type: 'error', message: 'Kayıt bulunamadı.' };
    return { type: 'ask_date', question: 'Tarihi anlayamadım. Hangi gün? (ör. cuma, yarın, 15.11)', record, pending: p };
  }
  const date: CommandDate = d.type === 'date' ? { type: 'date', date: d.date } : { type: 'ask', question: d.question };
  return continueCommand(repo, { ...p, date });
}

/** Silme onayı verildikten sonra çağrılır. */
export async function confirmTrash(repo: Repo, p: PendingCommand): Promise<CommandOutcome> {
  if (!p.recordId) return { type: 'error', message: 'Kayıt seçilmedi.' };
  return fromChange('trash', await repo.trash(p.recordId, p.source, p.submissionId));
}
