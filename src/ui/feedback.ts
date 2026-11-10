// Dokunsal geri bildirim (titreşim) ve "animasyonları azalt" ayarına uyan geçişler.
import { useEffect, useState } from 'react';
import { AccessibilityInfo, LayoutAnimation, Platform, UIManager } from 'react-native';
import * as Haptics from 'expo-haptics';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  try {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  } catch {
    // Yeni mimaride gerekmez.
  }
}

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled?.()
  .then((v) => (reduceMotion = !!v))
  .catch(() => undefined);
AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => (reduceMotion = !!v));

export function isReduceMotion(): boolean {
  return reduceMotion;
}

export function useReduceMotion(): boolean {
  const [v, setV] = useState(reduceMotion);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((x) => setV(!!x))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (x: boolean) => setV(!!x));
    return () => sub?.remove();
  }, []);
  return v;
}

/** Listedeki satırların yumuşakça kapanıp yer değiştirmesi (bir sonraki yerleşim için). */
export function animateNextLayout(): void {
  if (reduceMotion) return;
  LayoutAnimation.configureNext({
    duration: 250,
    update: { type: LayoutAnimation.Types.easeInEaseOut },
    delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  });
}

/** Hafif "tık": eşik geçildi, sürükleme başladı. */
export function hapticTick(): void {
  Haptics.selectionAsync().catch(() => undefined);
}

/** Başarılı işlem: tamamlandı, önem değişti. */
export function hapticSuccess(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}
