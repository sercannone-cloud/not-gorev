// Listelerden, kaydırma hareketlerinden, uzun basma menüsünden ve ekran
// okuyucu eylemlerinden ortak kullanılan hızlı işlemler.
import { useApp } from './AppContext';
import { animateNextLayout, hapticSuccess } from './feedback';
import { Priority, PRIORITY_LABEL, RecordRow, TaskStatus } from '../domain/types';
import { DayString, formatDayLong } from '../domain/dates';
import { ChangeResult } from '../db/repo';

export function useTaskActions() {
  const { repo, refresh, showToast } = useApp();

  const finish = (res: ChangeResult, message: string) => {
    if (res.ok) {
      hapticSuccess();
      animateNextLayout();
    }
    refresh();
    showToast(res.ok ? { message, undoHistoryId: res.historyId } : { message: res.reason });
    return res.ok;
  };

  const STATUS_MSG: Record<TaskStatus, string> = { done: 'tamamlandı', waiting: 'beklemeye alındı', open: 'yeniden açıldı' };

  return {
    setStatus: async (r: RecordRow, status: TaskStatus) =>
      finish(await repo.setStatus(r.id, status, 'button'), `"${r.title}" ${STATUS_MSG[status]}.`),
    setPriority: async (r: RecordRow, p: Priority) =>
      finish(await repo.setPriority(r.id, p, 'button'), `"${r.title}" önem derecesi: ${PRIORITY_LABEL[p]}.`),
    setFollowUp: async (r: RecordRow, d: DayString) =>
      finish(await repo.setFollowUp(r.id, d, 'button'), `"${r.title}" takip tarihi: ${formatDayLong(d)}.`),
  };
}
