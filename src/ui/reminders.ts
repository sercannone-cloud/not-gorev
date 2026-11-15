// Telefonun yerel bildirimleri. Sunucu ya da internet kullanılmaz; bildirimler
// cihazda zamanlanır. İzin yoksa hiçbir şey kurulmaz ve uygulama normal çalışır.

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { Repo } from '../db/repo';
import { DEFAULT_REMINDER_TIME, planAlarms, planReminders } from '../domain/reminders';

export const REMINDER_TIME_KEY = 'reminder_time';
export const REMINDER_ENABLED_KEY = 'reminder_enabled';
const CHANNEL_ID = 'gunluk-ozet';
const ALARM_CHANNEL_ID = 'saatli-hatirlatma';
const KIND = 'daily-summary';
const ALARM_KIND = 'record-alarm';

export type PermissionState = 'granted' | 'denied' | 'undetermined';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function reminderSettings(repo: Repo): Promise<{ time: string; enabled: boolean }> {
  const [time, enabled] = await Promise.all([repo.getSetting(REMINDER_TIME_KEY), repo.getSetting(REMINDER_ENABLED_KEY)]);
  return { time: time ?? DEFAULT_REMINDER_TIME, enabled: enabled !== '0' };
}

export async function permissionState(): Promise<PermissionState> {
  try {
    const p = await Notifications.getPermissionsAsync();
    return p.granted ? 'granted' : p.status === 'undetermined' ? 'undetermined' : 'denied';
  } catch {
    return 'denied';
  }
}

export async function askPermission(): Promise<PermissionState> {
  try {
    await ensureChannel();
    const p = await Notifications.requestPermissionsAsync();
    return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'denied';
  }
}

async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Günlük özet',
    description: 'Takip tarihi gelen işler ve haftalık tekrarlar',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  await Notifications.setNotificationChannelAsync(ALARM_CHANNEL_ID, {
    name: 'Saatli hatırlatma',
    description: 'Saati verilmiş işler, o saatte',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

let running: Promise<void> = Promise.resolve();

/**
 * Planlanmış özet bildirimlerini güncel veriye göre yeniden kurar.
 * Çağrılar sıraya alınır; aynı anda iki kurulum yapılmaz.
 */
export function syncReminders(repo: Repo): Promise<void> {
  running = running.then(() => doSync(repo)).catch(() => undefined);
  return running;
}

async function doSync(repo: Repo) {
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    existing
      .filter((n) => n.content.data?.kind === KIND || n.content.data?.kind === ALARM_KIND)
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
  if ((await permissionState()) !== 'granted') return;
  await ensureChannel();
  const { time, enabled } = await reminderSettings(repo);
  if (enabled) {
    const plan = planReminders(await repo.reminderInput(), repo.currentTime(), repo.today(), time);
    for (const p of plan) {
      await Notifications.scheduleNotificationAsync({
        content: { title: 'Notlar ve İşler', body: p.body, data: { kind: KIND, day: p.day } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: p.at, channelId: CHANNEL_ID },
      });
    }
  }
  // İşe özel saatli bildirimler günlük özet kapalıyken de çalar.
  for (const a of planAlarms(await repo.alarmInput(), repo.currentTime())) {
    await Notifications.scheduleNotificationAsync({
      content: { title: '⏰ ' + a.title, body: 'Takip saati geldi', data: { kind: ALARM_KIND, recordId: a.recordId } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: a.at, channelId: ALARM_CHANNEL_ID },
    });
  }
}

/**
 * Bildirime dokunulunca (uygulama kapalıyken açıldıysa da) çağrılır: özet
 * bildirimi Bugün ekranını, saatli bildirim o işin detayını açar.
 */
export function onReminderTap(handlers: { today: () => void; record: (id: string) => void }): () => void {
  const handle = (data: Record<string, unknown> | undefined) => {
    if (data?.kind === KIND) handlers.today();
    else if (data?.kind === ALARM_KIND && typeof data.recordId === 'string') handlers.record(data.recordId);
    else return false;
    return true;
  };
  const last = Notifications.getLastNotificationResponse();
  if (last && handle(last.notification.request.content.data)) Notifications.clearLastNotificationResponse();
  const sub = Notifications.addNotificationResponseReceivedListener((r) => {
    handle(r.notification.request.content.data);
  });
  return () => sub.remove();
}
