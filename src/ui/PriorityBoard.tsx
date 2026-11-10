// "Önceliğe göre" görünümü: Kritik / Yüksek / Orta / Düşük bölümleri.
// Kartın sağındaki ⋮⋮ tutamacından sürükleyip başka bölüme bırakınca önem
// derecesi değişir (Geri Al ile geri alınabilir). Ekran okuyucu kullananlar
// aynı işi kartın "Önemi değiştir" eyleminden yapar.
import React, { useRef, useState } from 'react';
import { Animated, PanResponder, PanResponderGestureState, GestureResponderEvent, Text, View } from 'react-native';
import { useApp } from './AppContext';
import { hapticTick } from './feedback';
import { useTaskActions } from './taskActions';
import { TaskRow } from './TaskRow';
import { C, PRIORITY_COLOR, s } from './theme';
import { Priority, PRIORITIES, PRIORITY_ICON, PRIORITY_LABEL, RecordRow } from '../domain/types';
import { DayString } from '../domain/dates';

interface DragCallbacks {
  start: (e: GestureResponderEvent) => void;
  move: (e: GestureResponderEvent, g: PanResponderGestureState) => void;
  end: (e: GestureResponderEvent, g: PanResponderGestureState) => void;
}

function DragHandle({ cb }: { cb: React.RefObject<DragCallbacks> }) {
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => cb.current?.start(e),
      onPanResponderMove: (e, g) => cb.current?.move(e, g),
      onPanResponderRelease: (e, g) => cb.current?.end(e, g),
      onPanResponderTerminate: (e, g) => cb.current?.end(e, { ...g, dy: 0 }),
    }),
  ).current;
  return (
    <View
      {...pan.panHandlers}
      importantForAccessibility="no-hide-descendants"
      style={{ width: 40, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}
      testID="drag-handle"
    >
      <Text style={{ color: C.muted, fontSize: 18, fontWeight: '700', letterSpacing: -2 }}>⋮⋮</Text>
    </View>
  );
}

function DraggableTask(props: {
  r: RecordRow;
  today: DayString;
  dragging: boolean;
  dy: Animated.Value;
  onStart: (r: RecordRow, pageY: number) => void;
  onMove: (pageY: number) => void;
  onEnd: (r: RecordRow, pageY: number) => void;
}) {
  const cb = useRef<DragCallbacks>(null as unknown as DragCallbacks);
  cb.current = {
    start: (e) => props.onStart(props.r, e.nativeEvent.pageY),
    move: (e) => props.onMove(e.nativeEvent.pageY),
    end: (e) => props.onEnd(props.r, e.nativeEvent.pageY),
  };
  return (
    <Animated.View
      style={
        props.dragging
          ? { transform: [{ translateY: props.dy }, { scale: 1.03 }], zIndex: 20, elevation: 8, shadowOpacity: 0.2, shadowRadius: 8 }
          : null
      }
    >
      <TaskRow r={props.r} today={props.today} right={<DragHandle cb={cb} />} />
    </Animated.View>
  );
}

export function PriorityBoard({ rows, today }: { rows: RecordRow[]; today: DayString }) {
  const { setScrollLocked } = useApp();
  const act = useTaskActions();
  const sections = useRef<Partial<Record<Priority, React.ComponentRef<typeof View> | null>>>({});
  const rects = useRef<{ p: Priority; top: number; bottom: number }[]>([]);
  const startY = useRef(0);
  const dy = useRef(new Animated.Value(0)).current;
  const [drag, setDrag] = useState<{ id: string; over: Priority | null } | null>(null);
  const overRef = useRef<Priority | null>(null);

  const find = (pageY: number): Priority | null => rects.current.find((r) => pageY >= r.top && pageY <= r.bottom)?.p ?? null;

  const onStart = (r: RecordRow, pageY: number) => {
    setScrollLocked(true);
    startY.current = pageY;
    dy.setValue(0);
    rects.current = [];
    for (const p of PRIORITIES) {
      sections.current[p]?.measure((_x: number, _y: number, _w: number, h: number, _px: number, py: number) => {
        rects.current = [...rects.current.filter((x) => x.p !== p), { p, top: py, bottom: py + h }];
      });
    }
    overRef.current = r.priority;
    setDrag({ id: r.id, over: r.priority });
    hapticTick();
  };

  const onMove = (pageY: number) => {
    dy.setValue(pageY - startY.current);
    const over = find(pageY);
    if (over && over !== overRef.current) {
      overRef.current = over;
      hapticTick();
      setDrag((d) => (d ? { ...d, over } : d));
    }
  };

  const onEnd = (r: RecordRow, pageY: number) => {
    setScrollLocked(false);
    const target = find(pageY);
    dy.setValue(0);
    setDrag(null);
    overRef.current = null;
    if (target && target !== r.priority) act.setPriority(r, target);
  };

  return (
    <View>
      <Text style={[s.muted, { marginTop: 8 }]}>Önemi değiştirmek için kartı sağdaki ⋮⋮ tutamacından başka bölüme sürükle.</Text>
      {PRIORITIES.map((p) => {
        const list = rows.filter((r) => r.priority === p);
        const hovered = drag?.over === p;
        const holdsDragged = !!drag && list.some((r) => r.id === drag.id);
        return (
          <View
            key={p}
            ref={(v) => {
              sections.current[p] = v;
            }}
            collapsable={false}
            style={[
              { borderRadius: 12, paddingHorizontal: 4, marginHorizontal: -4, borderWidth: 2, borderColor: 'transparent', borderStyle: 'dashed' },
              hovered && drag ? { borderColor: PRIORITY_COLOR[p], backgroundColor: C.card } : null,
              holdsDragged ? { zIndex: 10, elevation: 10 } : null,
            ]}
          >
            <Text style={[s.section, p !== 2 ? { color: PRIORITY_COLOR[p] } : null]}>
              {PRIORITY_ICON[p]} {PRIORITY_LABEL[p]} ({list.length})
            </Text>
            {list.length === 0 ? (
              <Text style={[s.muted, { marginBottom: 8, paddingVertical: 8 }]}>{drag ? 'Buraya bırak' : 'Bu seviyede iş yok.'}</Text>
            ) : null}
            {list.map((r) => (
              <DraggableTask
                key={r.id}
                r={r}
                today={today}
                dragging={drag?.id === r.id}
                dy={dy}
                onStart={onStart}
                onMove={onMove}
                onEnd={onEnd}
              />
            ))}
          </View>
        );
      })}
    </View>
  );
}
