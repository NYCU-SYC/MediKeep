/**
 * record-types.ts
 * Single source of truth for all health record type metadata.
 * Import from here instead of defining TYPE_LABELS / VITAL_TYPES / METRICS / TYPE_META locally.
 */

export const RECORD_TYPE_META = {
  blood_pressure: { label: '血壓',   icon: '❤️',  color: '#f44336', unit: 'mmHg' },
  heart_rate:     { label: '心跳',   icon: '💓',  color: '#e91e63', unit: 'bpm'  },
  glucose:        { label: '血糖',   icon: '🩸',  color: '#ff9800', unit: 'mg/dL'},
  weight:         { label: '體重',   icon: '⚖️',  color: '#2196f3', unit: 'kg'   },
  bmi:            { label: 'BMI',    icon: '📊',  color: '#00bcd4', unit: ''     },
  body_fat:       { label: '體脂率', icon: '🔬',  color: '#795548', unit: '%'    },
  steps:          { label: '步數',   icon: '👟',  color: '#4caf50', unit: '步'   },
  sleep:          { label: '睡眠',   icon: '😴',  color: '#9c27b0', unit: 'h'    },
  other:          { label: '其他',   icon: '📝',  color: '#607d8b', unit: ''     },
} as const;

export type RecordTypeKey = keyof typeof RECORD_TYPE_META;

export interface RecordTypeMeta {
  label: string;
  icon: string;
  color: string;
  unit: string;
}

/** Returns metadata for a record type, falling back to 'other' for unknown types. */
export function getTypeMeta(type: string): RecordTypeMeta {
  return (RECORD_TYPE_META as Record<string, RecordTypeMeta>)[type]
    ?? RECORD_TYPE_META.other;
}
