import React, { useEffect, useState } from 'react';
import { AppState, BackHandler, KeyboardAvoidingView, Pressable, ScrollView, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { openExpoDb } from './src/db/expoDb';
import { Repo } from './src/db/repo';
import { AppProvider, Route, useApp } from './src/ui/AppContext';
import { Composer } from './src/ui/Composer';
import { HistorySearchScreen, OpenScreen, RecurrencesScreen, TodayScreen, TrashScreen } from './src/ui/screens/ListScreens';
import { RecordScreen } from './src/ui/screens/RecordScreen';
import { C, R, SP, TOUCH, areaColor, s, useThemeScheme } from './src/ui/theme';
import { Area, AREA_LABEL } from './src/domain/types';
import { formatDayLong } from './src/domain/dates';
import { ActionSheet } from './src/ui/ActionSheet';
import { Button } from './src/ui/components';
import * as QuickActions from 'expo-quick-actions';
import { useQuickActionCallback } from 'expo-quick-actions/hooks';

/** Uygulama simgesine uzun basınca çıkan kısayollar. */
const QUICK_ACTIONS: QuickActions.Action[] = [
  { id: 'voice', title: 'Sesli kayıt' },
  { id: 'critical', title: 'Yeni kritik iş' },
  { id: 'today', title: 'Bugün' },
];

type Tab = 'today' | 'open' | 'history';
const TAB_LABEL: Record<Tab, string> = { today: 'Bugün', open: 'Açık İşler', history: 'Geçmiş ve Ara' };

export default function App() {
  const [repo, setRepo] = useState<Repo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scheme = useThemeScheme();

  useEffect(() => {
    (async () => {
      try {
        const db = await openExpoDb();
        const r = new Repo(db);
        await r.init();
        setRepo(r);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'bottom']}>
        {error ? (
          <Text style={[s.text, { padding: 16, color: C.danger }]}>Veritabanı açılamadı: {error}</Text>
        ) : !repo ? (
          <Text style={[s.muted, { padding: 16 }]}>Açılıyor…</Text>
        ) : (
          <AppRoot repo={repo} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

/** Veritabanı hazır olduktan sonraki uygulama kökü (testlerde de kullanılır). */
export function AppRoot({ repo }: { repo: Repo }) {
  useThemeScheme();
  const [stack, setStack] = useState<Route[]>([{ name: 'tabs' }]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length > 1) {
        setStack(stack.slice(0, -1));
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [stack]);

  return (
    <AppProvider repo={repo} stack={stack} setStack={setStack}>
      <Shell />
    </AppProvider>
  );
}

function Shell() {
  const { route, area, setArea, navigate, back, refresh, repo, scrollLocked, quickAction, fireQuickAction, setStack } = useApp();
  const [tab, setTab] = useState<Tab>('today');

  useEffect(() => {
    QuickActions.setItems(QUICK_ACTIONS).catch(() => undefined);
  }, []);
  useQuickActionCallback((a) => fireQuickAction(a.id));
  // Kısayol hangi ekrandayken gelirse gelsin ana ekrana dön.
  useEffect(() => {
    if (!quickAction) return;
    setStack([{ name: 'tabs' }]);
    if (quickAction.id === 'today') setTab('today');
  }, [quickAction]); // eslint-disable-line react-hooks/exhaustive-deps

  // Uygulama öne gelince gün değişmiş olabilir: tekrarları ve listeleri yenile.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') repo.ensureRecurrences().then(refresh);
    });
    return () => sub.remove();
  }, [repo, refresh]);

  const color = areaColor(area);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior="height">
      <View style={{ paddingHorizontal: SP.lg, paddingTop: SP.sm, gap: SP.sm, backgroundColor: C.card, borderBottomWidth: 1, borderColor: C.border }}>
        <View style={[s.row, { justifyContent: 'space-between', minHeight: TOUCH }]}>
          {route.name === 'tabs' ? (
            <View style={{ flexShrink: 1 }}>
              <Text style={s.h1}>Notlar ve İşler</Text>
              <Text style={s.muted}>{formatDayLong(repo.today())}</Text>
            </View>
          ) : (
            <Pressable
              onPress={back}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Geri"
              style={({ pressed }) => [s.row, { minHeight: TOUCH, paddingRight: SP.md, opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={[s.h2, { color: C.is }]}>‹ Geri</Text>
            </Pressable>
          )}
          <View style={[s.row, { gap: 2, backgroundColor: C.sunken, borderRadius: R.pill, padding: 3, borderWidth: 1, borderColor: C.border }]}>
            {(['is', 'ozel'] as Area[]).map((a) => (
              <Pressable
                key={a}
                accessibilityRole="button"
                accessibilityState={{ selected: area === a }}
                onPress={() => setArea(a)}
                style={{ minHeight: 40, justifyContent: 'center', paddingHorizontal: SP.lg, borderRadius: R.pill, backgroundColor: area === a ? areaColor(a) : 'transparent' }}
              >
                <Text style={{ color: area === a ? C.onColor : C.muted, fontWeight: '700' }}>{AREA_LABEL[a]}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        {route.name === 'tabs' ? (
          <View accessibilityRole="tablist" style={s.row}>
            {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
              <Pressable
                key={t}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === t }}
                onPress={() => setTab(t)}
                style={{ flex: 1, minHeight: TOUCH, justifyContent: 'center', alignItems: 'center' }}
              >
                <Text style={{ fontSize: 14, fontWeight: tab === t ? '800' : '600', color: tab === t ? color : C.muted }}>{TAB_LABEL[t]}</Text>
                <View style={{ position: 'absolute', bottom: 0, left: SP.md, right: SP.md, height: 3, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: tab === t ? color : 'transparent' }} />
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={{ height: SP.xs }} />
        )}
      </View>

      <ScrollView scrollEnabled={!scrollLocked} contentContainerStyle={{ padding: SP.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        {route.name === 'tabs' ? (
          <View>
            <Composer />
            {tab === 'today' ? <TodayScreen /> : tab === 'open' ? <OpenScreen /> : <HistorySearchScreen />}
            <View style={[s.row, { gap: SP.sm, marginTop: SP.xl }]}>
              <Button label="🔁 Haftalık tekrarlar" kind="ghost" color={C.muted} style={{ flex: 1 }} onPress={() => navigate({ name: 'recurrences' })} />
              <Button label="🗑 Çöp kutusu" kind="ghost" color={C.muted} style={{ flex: 1 }} onPress={() => navigate({ name: 'trash' })} />
            </View>
          </View>
        ) : route.name === 'record' ? (
          <RecordScreen key={route.id} id={route.id} />
        ) : route.name === 'trash' ? (
          <View>
            <Text style={[s.h1, { marginBottom: SP.md }]}>Çöp kutusu</Text>
            <TrashScreen />
          </View>
        ) : (
          <View>
            <Text style={[s.h1, { marginBottom: SP.md }]}>Haftalık tekrarlar · {AREA_LABEL[area]}</Text>
            <RecurrencesScreen />
          </View>
        )}
      </ScrollView>
      <ActionSheet />
    </KeyboardAvoidingView>
  );
}
