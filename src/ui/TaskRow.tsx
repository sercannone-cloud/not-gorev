// Listelerdeki iş kartı: kaydırma hareketleri, uzun basma menüsü ve
// ekran okuyucu (TalkBack) için aynı işlemlerin özel eylemleri.
import React from 'react';
import { RecordItem } from './components';
import { SwipeRow } from './SwipeRow';
import { useApp } from './AppContext';
import { useTaskActions } from './taskActions';
import { C } from './theme';
import { RecordRow } from '../domain/types';
import { DayString } from '../domain/dates';

export function TaskRow(props: { r: RecordRow; today: DayString; extra?: string; right?: React.ReactNode }) {
  const { r } = props;
  const { navigate, openActions } = useApp();
  const act = useTaskActions();
  const isOpenTask = r.kind === 'task' && r.status !== 'done' && !r.deleted_at;
  const open = () => navigate({ name: 'record', id: r.id });

  const item = (
    <RecordItem
      r={r}
      today={props.today}
      extra={props.extra}
      right={props.right}
      onPress={open}
      onLongPress={isOpenTask ? () => openActions(r) : undefined}
      accessibilityActions={
        isOpenTask
          ? [
              { name: 'complete', label: 'Tamamla' },
              { name: r.status === 'waiting' ? 'reopen' : 'hold', label: r.status === 'waiting' ? 'Yeniden aç' : 'Beklet' },
              { name: 'actions', label: 'Önemi değiştir ve diğer işlemler' },
            ]
          : undefined
      }
      onAccessibilityAction={(e) => {
        const n = e.nativeEvent.actionName;
        if (n === 'complete') act.setStatus(r, 'done');
        else if (n === 'hold') act.setStatus(r, 'waiting');
        else if (n === 'reopen') act.setStatus(r, 'open');
        else if (n === 'actions') openActions(r);
      }}
    />
  );
  if (!isOpenTask) return item;
  return (
    <SwipeRow
      right={{ label: '✓ Tamamla', color: C.ozel, onTrigger: () => act.setStatus(r, 'done') }}
      left={
        r.status === 'waiting'
          ? { label: '↺ Yeniden aç', color: C.is, onTrigger: () => act.setStatus(r, 'open') }
          : { label: '⏸ Beklet', color: C.warn, onTrigger: () => act.setStatus(r, 'waiting') }
      }
    >
      {item}
    </SwipeRow>
  );
}
