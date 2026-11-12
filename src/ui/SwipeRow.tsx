// Kaydırarak hızlı işlem: sağa kaydır = birinci işlem (ör. Tamamla),
// sola kaydır = ikinci işlem (ör. Beklet). Eşik satır genişliğinin %35'i;
// eşik geçilince hafif titreşim, geçilmezse satır yerine yaylanır.
// Yalnızca React Native çekirdeği (PanResponder + Animated) kullanılır.
import React, { useRef, useState } from 'react';
import { Animated, PanResponder, Text, View } from 'react-native';
import { useApp } from './AppContext';
import { hapticTick, isReduceMotion } from './feedback';
import { C, R } from './theme';

export interface SwipeAction {
  label: string;
  color: string;
  onTrigger: () => void;
}

const THRESHOLD = 0.35;

export function SwipeRow(props: { right?: SwipeAction; left?: SwipeAction; bottomInset?: number; children: React.ReactNode }) {
  const { setScrollLocked } = useApp();
  const x = useRef(new Animated.Value(0)).current;
  const width = useRef(1);
  const armed = useRef(false);
  const [dir, setDir] = useState<0 | 1 | -1>(0);
  const propsRef = useRef(props);
  propsRef.current = props;

  const reset = () => {
    if (isReduceMotion()) x.setValue(0);
    else Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
  };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => {
        const p = propsRef.current;
        if (Math.abs(g.dx) < 12 || Math.abs(g.dx) < Math.abs(g.dy) * 1.5) return false;
        return g.dx > 0 ? !!p.right : !!p.left;
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        armed.current = false;
        setScrollLocked(true);
      },
      onPanResponderMove: (_e, g) => {
        const p = propsRef.current;
        const dx = g.dx > 0 ? (p.right ? g.dx : 0) : p.left ? g.dx : 0;
        x.setValue(dx);
        setDir(dx > 0 ? 1 : dx < 0 ? -1 : 0);
        const over = Math.abs(dx) > width.current * THRESHOLD;
        if (over !== armed.current) {
          armed.current = over;
          if (over) hapticTick();
        }
      },
      onPanResponderRelease: (_e, g) => {
        setScrollLocked(false);
        const p = propsRef.current;
        const action = g.dx > 0 ? p.right : p.left;
        if (action && Math.abs(g.dx) > width.current * THRESHOLD) {
          const out = g.dx > 0 ? width.current : -width.current;
          const done = () => {
            action.onTrigger();
            x.setValue(0);
            setDir(0);
          };
          if (isReduceMotion()) done();
          else Animated.timing(x, { toValue: out, duration: 160, useNativeDriver: true }).start(done);
        } else {
          reset();
        }
      },
      onPanResponderTerminate: () => {
        setScrollLocked(false);
        reset();
      },
    }),
  ).current;

  const action = dir > 0 ? props.right : dir < 0 ? props.left : undefined;
  return (
    <View onLayout={(e) => (width.current = Math.max(1, e.nativeEvent.layout.width))}>
      {action ? (
        <View
          importantForAccessibility="no-hide-descendants"
          style={{
            position: 'absolute',
            top: 0,
            bottom: props.bottomInset ?? 10,
            left: 0,
            right: 0,
            borderRadius: R.md + 2,
            backgroundColor: action.color,
            justifyContent: 'center',
            alignItems: dir > 0 ? 'flex-start' : 'flex-end',
            paddingHorizontal: 18,
          }}
        >
          <Text style={{ color: C.onColor, fontWeight: '800', fontSize: 15 }}>{action.label}</Text>
        </View>
      ) : null}
      <Animated.View style={{ transform: [{ translateX: x }] }} {...pan.panHandlers}>
        {props.children}
      </Animated.View>
    </View>
  );
}
