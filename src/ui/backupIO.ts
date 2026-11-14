// Yedeğin telefondan dışarı çıkması ve geri gelmesi. Ek paket kullanmadan
// Android paylaşım menüsüyle metin olarak gönderilir; geri yüklerken metin
// uygulamadaki kutuya yapıştırılır.

import { Share } from 'react-native';
import type { Backup } from '../db/repo';

export async function shareBackup(data: Backup): Promise<void> {
  const day = data.exportedAt.slice(0, 10);
  await Share.share({ title: `Notlar ve İşler yedeği ${day}`, message: JSON.stringify(data) });
}

/** Yedek metnini getirir. 'manual': kullanıcı metni kendisi yapıştıracak. */
export async function pickBackupText(): Promise<string | 'manual' | null> {
  return 'manual';
}
