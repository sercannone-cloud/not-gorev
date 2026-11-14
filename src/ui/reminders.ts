// Telefonun yerel bildirimleri. Sunucu ya da internet kullanılmaz; bildirimler
// cihazda zamanlanır. İzin yoksa hiçbir şey kurulmaz ve uygulama normal çalışır.

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { Repo } from '../db/repo';
import { DEFAULT_REMINDER_TIME, planReminders } from '../domain/reminders';

export const REMINDER_TIME_KEY = 'reminder_time';
export const REMINDER_ENABLED_KEY = 'reminder_enabled';
const CHANNEL_ID = 'gunluk-ozet';
const KIND = 'daily-summary';

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
      .filter((n) => n.content.data?.kind === KIND)
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
  const { time, enabled } = await reminderSettings(repo);
  if (!enabled || (await permissionState()) !== 'granted') return;
  await ensureChannel();
  const plan = planReminders(await repo.reminderInput(), repo.currentTime(), repo.today(), time);
  for (const p of plan) {
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Notlar ve İşler', body: p.body, data: { kind: KIND, day: p.day } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: p.at, channelId: CHANNEL_ID },
    });
  }
}

/** Bildirime dokunulunca (uygulama kapalıyken açıldıysa da) çağrılır. */
export function onReminderTap(handler: () => void): () => void {
  const last = Notifications.getLastNotificationResponse();
  if (last?.notification.request.content.data?.kind === KIND) {
    handler();
    Notifications.clearLastNotificationResponse();
  }
  const sub = Notifications.addNotificationResponseReceivedListener((r) => {
    if (r.notification.request.content.data?.kind === KIND) handler();
  });
  return () => sub.remove();
}
