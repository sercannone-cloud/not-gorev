import { StyleSheet } from 'react-native';

export const C = {
  bg: '#F6F5F2',
  card: '#FFFFFF',
  text: '#1D1D1F',
  muted: '#6B6B70',
  border: '#E2E0DB',
  is: '#1F5FA8',
  isSoft: '#E4EEF9',
  ozel: '#2E7D4F',
  ozelSoft: '#E3F2E8',
  danger: '#B3261E',
  dangerSoft: '#FBE9E7',
  warn: '#9A6700',
  warnSoft: '#FFF4D6',
  done: '#5F6368',
  accent: '#3A3A3C',
};

export const areaColor = (area: 'is' | 'ozel') => (area === 'is' ? C.is : C.ozel);
export const areaSoft = (area: 'is' | 'ozel') => (area === 'is' ? C.isSoft : C.ozelSoft);

export const s = StyleSheet.create({
  card: {
    backgroundColor: C.card,
    borderRadius: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  h1: { fontSize: 20, fontWeight: '700', color: C.text },
  h2: { fontSize: 16, fontWeight: '700', color: C.text },
  section: { fontSize: 13, fontWeight: '700', color: C.muted, textTransform: 'uppercase', marginTop: 16, marginBottom: 6 },
  text: { fontSize: 15, color: C.text },
  muted: { fontSize: 13, color: C.muted },
  input: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: C.text,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
