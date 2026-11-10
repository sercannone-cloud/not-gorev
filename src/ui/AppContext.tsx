import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Repo } from '../db/repo';
import { Area, RecordRow } from '../domain/types';
import { C } from './theme';

export type Route =
  | { name: 'tabs' }
  | { name: 'record'; id: string }
  | { name: 'trash' }
  | { name: 'recurrences' };

export interface Toast {
  message: string;
  undoHistoryId?: number;
}

interface Ctx {
  repo: Repo;
  area: Area;
  setArea: (a: Area) => void;
  /** Veri değişince artar; ekranlar yeniden yükler. */
  version: number;
  refresh: () => void;
  showToast: (t: Toast) => void;
  navigate: (r: Route) => void;
  back: () => void;
  route: Route;
  /** Kaydırma ya da sürükleme sırasında ana listenin kaymasını durdurur. */
  scrollLocked: boolean;
  setScrollLocked: (v: boolean) => void;
  /** Uzun basma menüsü (hızlı aksiyonlar) için seçili kayıt. */
  sheetRecord: RecordRow | null;
  openActions: (r: RecordRow | null) => void;
  /** Ana ekran kısayolundan gelen son istek. */
  quickAction: { id: string; n: number } | null;
  fireQuickAction: (id: string) => void;
  consumeQuickAction: () => void;
  setStack: (r: Route[]) => void;
}

const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('AppContext yok');
  return c;
}

export function AppProvider(props: { repo: Repo; children: React.ReactNode; stack: Route[]; setStack: (r: Route[]) => void }) {
  const [area, setArea] = useState<Area>('is');
  const [version, setVersion] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);
  const [scrollLocked, setScrollLocked] = useState(false);
  const [sheetRecord, openActions] = useState<RecordRow | null>(null);
  const [quickAction, setQuickAction] = useState<{ id: string; n: number } | null>(null);
  const fireQuickAction = useCallback((id: string) => setQuickAction((q) => ({ id, n: (q?.n ?? 0) + 1 })), []);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const showToast = useCallback((t: Toast) => {
    setToast(t);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), t.undoHistoryId ? 8000 : 4000);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const route = props.stack[props.stack.length - 1];
  const navigate = (r: Route) => props.setStack([...props.stack, r]);
  const back = () => props.setStack(props.stack.length > 1 ? props.stack.slice(0, -1) : props.stack);

  const undo = async () => {
    if (!toast?.undoHistoryId) return;
    const id = toast.undoHistoryId;
    setToast(null);
    const res = await props.repo.undo(id);
    refresh();
    showToast({ message: res.ok ? 'Geri alındı.' : res.reason });
  };

  return (
    <AppCtx.Provider value={{
        repo: props.repo,
        area,
        setArea,
        version,
        refresh,
        showToast,
        navigate,
        back,
        route,
        scrollLocked,
        setScrollLocked,
        sheetRecord,
        openActions,
        quickAction,
        fireQuickAction,
        consumeQuickAction: () => setQuickAction(null),
        setStack: props.setStack,
      }}>
      {props.children}
      {toast ? (
        <View
          style={{
            position: 'absolute',
            left: 12,
            right: 12,
            bottom: 24,
            backgroundColor: '#2B2B2E',
            borderRadius: 12,
            padding: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            elevation: 6,
          }}
        >
          <Text style={{ color: '#fff', flex: 1 }}>{toast.message}</Text>
          {toast.undoHistoryId ? (
            <Pressable onPress={undo} accessibilityRole="button" hitSlop={10}>
              <Text style={{ color: '#9CC3FF', fontWeight: '700' }}>Geri Al</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => setToast(null)} hitSlop={10} accessibilityLabel="Kapat">
            <Text style={{ color: C.border }}>✕</Text>
          </Pressable>
        </View>
      ) : null}
    </AppCtx.Provider>
  );
}
