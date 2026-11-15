// Yedeğin telefondan dışarı çıkması ve geri gelmesi. Yedek bir .json dosyası
// olarak yazılır ve Android paylaşım menüsüyle (Drive, e-posta, Dosyalar…)
// gönderilir. Geri yüklerken dosya seçiciden seçilir.

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import type { Backup } from '../db/repo';

/** Dosya adı: notlar-ve-isler-yedek-2026-11-15.json */
export function backupFileName(data: Backup): string {
  return `notlar-ve-isler-yedek-${data.exportedAt.slice(0, 10)}.json`;
}

export async function shareBackup(data: Backup): Promise<void> {
  const file = new File(Paths.cache, backupFileName(data));
  file.create({ overwrite: true });
  await file.write(JSON.stringify(data));
  if (!(await Sharing.isAvailableAsync())) throw new Error('Bu telefonda paylaşım kullanılamıyor.');
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Yedeği kaydet' });
}

/** Seçilen yedek dosyasının metni; vazgeçilirse null. */
export async function pickBackupText(): Promise<string | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain', 'application/octet-stream'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled || !res.assets?.length) return null;
  return new File(res.assets[0].uri).text();
}
