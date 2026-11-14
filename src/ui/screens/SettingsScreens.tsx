import React, { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, Text, TextInput, View } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useApp } from '../AppContext';
import { Button, Empty, SectionTitle } from '../components';
import { C, R, s, SP, TOUCH } from '../theme';
import { AREA_LABEL, Category, UNCLASSIFIED_LABEL } from '../../domain/types';
import { askPermission, PermissionState, permissionState, REMINDER_ENABLED_KEY, REMINDER_TIME_KEY, reminderSettings, syncReminders } from '../reminders';
import { parseTime } from '../../domain/reminders';
import { pickBackupText, shareBackup } from '../backupIO';

// ---------------------------------------------------------------------------
// Kategoriler
// ---------------------------------------------------------------------------

type CatRow = Category & { record_count: number };

export function CategoriesScreen() {
  const { repo, area, version, refresh, showToast } = useApp();
  const [rows, setRows] = useState<CatRow[] | null>(null);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);

  useEffect(() => {
    let alive = true;
    repo.categoriesWithCounts(area).then((r) => alive && setRows(r));
    return () => {
      alive = false;
    };
  }, [repo, area, version]);

  const add = async () => {
    const res = await repo.addCategory(area, newName);
    if (!res.ok) return showToast({ message: res.reason });
    setNewName('');
    refresh();
    showToast({ message: `"${res.category.name}" eklendi.` });
  };

  const saveRename = async () => {
    if (!editing) return;
    const res = await repo.renameCategory(editing.id, editing.name);
    if (!res.ok) return showToast({ message: res.reason });
    setEditing(null);
    refresh();
    showToast({ message: 'Kategori adı değişti.' });
  };

  const remove = (c: CatRow) => {
    const msg =
      c.record_count > 0
        ? `${c.record_count} kayıt silinmeyecek; ${AREA_LABEL[area]} alanının "${UNCLASSIFIED_LABEL}" bölümüne taşınacak.`
        : 'Bu kategoride kayıt yok.';
    Alert.alert(`"${c.name}" silinsin mi?`, msg, [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Kategoriyi sil',
        style: 'destructive',
        onPress: async () => {
          const res = await repo.deleteCategory(c.id);
          refresh();
          showToast({
            message: res.ok
              ? res.moved > 0
                ? `Kategori silindi. ${res.moved} kayıt "${UNCLASSIFIED_LABEL}" bölümünde.`
                : 'Kategori silindi.'
              : res.reason,
          });
        },
      },
    ]);
  };

  if (!rows) return null;
  return (
    <View>
      <View style={[s.row, { gap: SP.sm, marginBottom: SP.md }]}>
        <TextInput
          placeholderTextColor={C.muted}
          style={[s.input, { flex: 1 }]}
          placeholder={`Yeni ${AREA_LABEL[area]} kategorisi`}
          value={newName}
          onChangeText={setNewName}
          onSubmitEditing={add}
          returnKeyType="done"
        />
        <Button label="Ekle" kind="primary" onPress={add} disabled={!newName.trim()} />
      </View>
      {rows.length === 0 ? <Empty icon="🏷" text="Kategori yok. Kayıtlar Sınıflandırılacak bölümünde toplanır." /> : null}
      {rows.map((c, i) => (
        <View key={c.id} style={[s.card, { marginBottom: SP.sm, gap: SP.sm }]}>
          {editing?.id === c.id ? (
            <>
              <TextInput
                autoFocus
                style={s.input}
                value={editing.name}
                onChangeText={(t) => setEditing({ id: c.id, name: t })}
                onSubmitEditing={saveRename}
                accessibilityLabel="Yeni kategori adı"
              />
              <View style={[s.row, { gap: SP.sm }]}>
                <Button small label="Kaydet" kind="primary" style={{ flex: 1 }} onPress={saveRename} />
                <Button small label="Vazgeç" style={{ flex: 1 }} onPress={() => setEditing(null)} />
              </View>
            </>
          ) : (
            <>
              <View style={[s.row, { gap: SP.sm }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.text, { fontWeight: '600' }]}>{c.name}</Text>
                  <Text style={s.muted}>{c.record_count} kayıt</Text>
                </View>
                <MoveButton label="↑" a11y={`${c.name} yukarı taşı`} disabled={i === 0} onPress={async () => { await repo.moveCategory(c.id, -1); refresh(); }} />
                <MoveButton label="↓" a11y={`${c.name} aşağı taşı`} disabled={i === rows.length - 1} onPress={async () => { await repo.moveCategory(c.id, 1); refresh(); }} />
              </View>
              <View style={[s.row, { gap: SP.sm }]}>
                <Button small label="Adını değiştir" style={{ flex: 1 }} onPress={() => setEditing({ id: c.id, name: c.name })} />
                <Button small label="Sil" kind="danger" style={{ flex: 1 }} onPress={() => remove(c)} />
              </View>
            </>
          )}
        </View>
      ))}
    </View>
  );
}

function MoveButton(props: { label: string; a11y: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.a11y}
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => ({
        width: TOUCH,
        height: TOUCH,
        borderRadius: R.md,
        borderWidth: 1,
        borderColor: C.border,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: props.disabled ? 0.3 : pressed ? 0.6 : 1,
      })}
    >
      <Text style={[s.h2, { color: C.text }]}>{props.label}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Ayarlar: bildirim ve yedekleme
// ---------------------------------------------------------------------------

const PERMISSION_LABEL: Record<PermissionState, string> = {
  granted: 'İzin verildi',
  denied: 'İzin yok',
  undetermined: 'Henüz sorulmadı',
};

const pad = (n: number) => String(n).padStart(2, '0');

export function SettingsScreen() {
  const { repo, refresh, showToast, setStack } = useApp();
  const [time, setTime] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [perm, setPerm] = useState<PermissionState | null>(null);
  const [importing, setImporting] = useState(false);
  const [pasted, setPasted] = useState('');

  useEffect(() => {
    reminderSettings(repo).then((r) => {
      setTime(r.time);
      setEnabled(r.enabled);
    });
    permissionState().then(setPerm);
  }, [repo]);

  const chooseTime = () => {
    const [h, m] = parseTime(time);
    const base = new Date();
    base.setHours(h, m, 0, 0);
    DateTimePickerAndroid.open({
      value: base,
      mode: 'time',
      is24Hour: true,
      onValueChange: async (_e, date) => {
        const next = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
        await repo.setSetting(REMINDER_TIME_KEY, next);
        setTime(next);
        await syncReminders(repo);
        showToast({ message: `Günlük özet saati ${next}.` });
      },
    });
  };

  const toggle = async () => {
    const next = !enabled;
    await repo.setSetting(REMINDER_ENABLED_KEY, next ? '1' : '0');
    setEnabled(next);
    await syncReminders(repo);
  };

  const requestPerm = async () => {
    const p = await askPermission();
    setPerm(p);
    if (p === 'granted') await syncReminders(repo);
    else if (p === 'denied') Linking.openSettings().catch(() => undefined);
  };

  const doExport = async () => {
    try {
      const data = await repo.exportData();
      await shareBackup(data);
    } catch (e) {
      showToast({ message: `Yedek oluşturulamadı: ${String(e)}` });
    }
  };

  const startImport = async (text: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return showToast({ message: 'Metin okunamadı. Yedeğin tamamını yapıştırdığından emin ol.' });
    }
    const check = repo.checkBackup(parsed);
    if (!check.ok) return showToast({ message: check.reason });
    Alert.alert(
      'Yedek geri yüklensin mi?',
      `Telefondaki tüm kayıtlar silinip yerine yedekteki ${check.records} kayıt ve ${check.entries} gelişme yüklenecek. Bu işlem geri alınamaz.`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Üzerine yaz',
          style: 'destructive',
          onPress: async () => {
            const res = await repo.importData(parsed);
            if (!res.ok) return showToast({ message: res.reason });
            setImporting(false);
            setPasted('');
            refresh();
            await syncReminders(repo);
            setStack([{ name: 'tabs' }]);
            showToast({ message: `Yedek yüklendi: ${res.records} kayıt.` });
          },
        },
      ],
    );
  };

  const openImport = async () => {
    const picked = await pickBackupText();
    if (picked === 'manual') setImporting(true);
    else if (picked !== null) startImport(picked);
  };

  return (
    <View>
      <SectionTitle label="Günlük özet bildirimi" />
      <View style={[s.card, { gap: SP.sm }]}>
        <Text style={s.text}>
          Takip tarihi gelen işler, haftalık tekrarlar ve gecikmişler için günde bir bildirim. İnternet gerekmez.
        </Text>
        <Text style={s.muted}>Bildirim izni: {perm ? PERMISSION_LABEL[perm] : '…'}</Text>
        {perm && perm !== 'granted' ? (
          <Button small label={perm === 'denied' ? 'Telefon ayarlarında izin ver' : 'Bildirim izni ver'} kind="primary" onPress={requestPerm} />
        ) : null}
        <View style={[s.row, { gap: SP.sm }]}>
          <Button small label={`Saat: ${time ?? '…'}`} style={{ flex: 1 }} onPress={chooseTime} disabled={!enabled} />
          <Button small label={enabled ? 'Kapat' : 'Aç'} style={{ flex: 1 }} onPress={toggle} />
        </View>
        {!enabled ? <Text style={s.muted}>Bildirim kapalı.</Text> : null}
      </View>

      <SectionTitle label="Yedekleme" />
      <View style={[s.card, { gap: SP.sm }]}>
        <Text style={s.text}>
          Veriler yalnızca bu telefonda. Telefon değişirse ya da uygulama silinirse kaybolmaması için ara sıra yedek al ve Drive gibi bir yere kaydet.
        </Text>
        <Button small label="Yedeği dışa aktar" kind="primary" onPress={doExport} />
        <Button small label="Yedekten geri yükle" onPress={openImport} />
        {importing ? (
          <View style={{ gap: SP.sm }}>
            <Text style={s.muted}>Yedek metnini kutuya yapıştır.</Text>
            <TextInput
              multiline
              placeholderTextColor={C.muted}
              style={[s.input, { minHeight: 120, textAlignVertical: 'top', fontSize: 12 }]}
              placeholder='{"app":"not-gorev", …}'
              value={pasted}
              onChangeText={setPasted}
              accessibilityLabel="Yedek metni"
            />
            <View style={[s.row, { gap: SP.sm }]}>
              <Button small label="Devam" kind="primary" style={{ flex: 1 }} disabled={!pasted.trim()} onPress={() => startImport(pasted)} />
              <Button small label="Vazgeç" style={{ flex: 1 }} onPress={() => { setImporting(false); setPasted(''); }} />
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}
