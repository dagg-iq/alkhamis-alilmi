import type { File } from 'expo-file-system';

/** نتيجة آخر تحويل (ملف PDF + نص عادي) تنتقل من شاشة التصوير إلى شاشة النتيجة */
export interface ScanResult { file: File; text: string; title: string; subjectId?: string; kind?: 'expected' | 'school_exam' }
let last: ScanResult | null = null;
export const setScanResult = (r: ScanResult | null) => { last = r; };
export const getScanResult = () => last;
