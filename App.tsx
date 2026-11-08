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
import { C, areaColor, s } from './src/ui/theme';
import { Area, AREA_LABEL } from './src/domain/types';
import { formatDayLong } from './src/domain/dates';

type Tab = 'today' | 'open' | 'history';
const TAB_LABEL: Record<Tab, string> = { today: 'Bugün', open: 'Açık İşler', history: 'Geçmiş ve Ara' };

export default function App() {
  const [repo, setRepo] = useState<Repo | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      <StatusBar style="dark" />
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
  const { route, area, setArea, navigate, back, refresh, repo } = useApp();
  const [tab, setTab] = useState<Tab>('today');

  // Uygulama öne gelince gün değişmiş olabilir: tekrarları ve listeleri yenile.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') repo.ensureRecurrences().then(refresh);
    });
    return () => sub.remove();
  }, [repo, refresh]);

  const color = areaColor(area);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="height">
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, gap: 8, borderBottomWidth: 1, borderColor: C.border }}>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          {route.name === 'tabs' ? (
            <View>
              <Text style={s.h1}>Notlar ve İşler</Text>
              <Text style={s.muted}>{formatDayLong(repo.today())}</Text>
            </View>
          ) : (
            <Pressable onPress={back} hitSlop={10}>
              <Text style={[s.h2, { color: C.is }]}>‹ Geri</Text>
            </Pressable>
          )}
          <View style={[s.row, { gap: 4, backgroundColor: C.card, borderRadius: 10, padding: 3, borderWidth: 1, borderColor: C.border }]}>
            {(['is', 'ozel'] as Area[]).map((a) => (
              <Pressable
                key={a}
                accessibilityRole="button"
                accessibilityState={{ selected: area === a }}
                onPress={() => setArea(a)}
                style={{ paddingVertical: 6, paddingHorizontal: 14, borderRadius: 8, backgroundColor: area === a ? areaColor(a) : 'transparent' }}
              >
                <Text style={{ color: area === a ? '#fff' : C.text, fontWeight: '700' }}>{AREA_LABEL[a]}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        {route.name === 'tabs' ? (
          <View style={[s.row, { gap: 6 }]}>
            {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
              <Pressable
                key={t}
                onPress={() => setTab(t)}
                style={{ flex: 1, paddingVertical: 8, borderBottomWidth: 3, borderColor: tab === t ? color : 'transparent', alignItems: 'center' }}
              >
                <Text style={{ fontWeight: tab === t ? '700' : '500', color: tab === t ? C.text : C.muted }}>{TAB_LABEL[t]}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        {route.name === 'tabs' ? (
          <View style={{ gap: 4 }}>
            <Composer />
            {tab === 'today' ? <TodayScreen /> : tab === 'open' ? <OpenScreen /> : <HistorySearchScreen />}
            <View style={[s.row, { gap: 16, justifyContent: 'center', marginTop: 24 }]}>
              <Text style={{ color: C.muted }} onPress={() => navigate({ name: 'recurrences' })}>
                Haftalık tekrarlar
              </Text>
              <Text style={{ color: C.muted }} onPress={() => navigate({ name: 'trash' })}>
                Çöp kutusu
              </Text>
            </View>
          </View>
        ) : route.name === 'record' ? (
          <RecordScreen key={route.id} id={route.id} />
        ) : route.name === 'trash' ? (
          <View>
            <Text style={[s.h1, { marginBottom: 8 }]}>Çöp kutusu</Text>
            <TrashScreen />
          </View>
        ) : (
          <View>
            <Text style={[s.h1, { marginBottom: 8 }]}>Haftalık tekrarlar · {AREA_LABEL[area]}</Text>
            <RecurrencesScreen />
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
