import { describe, expect, it } from 'vitest';
import { groupActivityLifecycles, humanActivityDescription, humanActivityTitle } from './activity-lifecycle';

describe('activity lifecycle presentation', () => {
  it('replaces actual audit action codes with patient-facing language', () => {
    const cases = [
      ['source_document_delete', '文件已移至最近刪除'],
      ['source_document_restore', '文件已從最近刪除恢復'],
      ['condition_delete', '健康狀況已移至最近刪除'],
      ['medication_restore', '用藥已從最近刪除恢復'],
      ['dicom_study_delete', '醫療影像已移至最近刪除'],
      ['undo', '醫療團隊已復原上一個操作'],
    ];
    for (const [event_type, expected] of cases) {
      const title = humanActivityTitle({ id: event_type, event_type, title: event_type, target_label: '測試項目' });
      expect(title).toBe(`${expected} · 測試項目`);
      expect(title).not.toContain('_');
    }
    expect(humanActivityDescription({
      id: '1',
      event_type: 'source_document_delete',
      short_description: 'actor=patient target=source_document status=completed',
    })).toContain('目前狀態與下一步');
  });

  it('consumes a server lifecycle without duplicating nested events', () => {
    const events = [{
      id: 'undo',
      event_type: 'undo',
      lifecycle_id: 'lifecycle:change_request:req-1',
      lifecycle_kind: 'change_request',
      resource_kind: 'condition',
      correlation_key: 'change_request:req-1',
      request_id: 'req-1',
      phase: 'undo',
      occurred_at: '2026-08-12T10:02:00Z',
      lifecycle_events: [
        { id: 'request', event_type: 'change_request_pending_review', lifecycle_kind: 'change_request', resource_kind: 'condition', correlation_key: 'change_request:req-1', request_id: 'req-1', phase: 'request', occurred_at: '2026-08-12T10:00:00Z' },
        { id: 'complete', event_type: 'change_request_accepted', lifecycle_kind: 'change_request', resource_kind: 'condition', correlation_key: 'change_request:req-1', request_id: 'req-1', phase: 'completion', occurred_at: '2026-08-12T10:01:00Z' },
        { id: 'undo', event_type: 'undo', lifecycle_kind: 'change_request', resource_kind: 'condition', correlation_key: 'change_request:req-1', request_id: 'req-1', phase: 'undo', occurred_at: '2026-08-12T10:02:00Z' },
      ],
    }];
    const grouped = groupActivityLifecycles(events);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].id).toBe('undo');
    expect(grouped[0].latest_phase).toBe('undo');
    expect(grouped[0].lifecycle_events.map(event => event.id)).toEqual(['request', 'complete', 'undo']);
  });

  it('groups only an exact correlation key with a compatible resource lifecycle', () => {
    const events = [
      { id: 'complete', event_type: 'source_document_delete', lifecycle_kind: 'deletion_recovery', correlation_key: 'operation:delete-1', target_type: 'source_document', resource_kind: 'document', target_id: 'doc-1', phase: 'completion', created_at: '2026-08-12T10:01:00Z' },
      { id: 'request', event_type: 'source_document_delete_requested', lifecycle_kind: 'deletion_recovery', correlation_key: 'operation:delete-1', target_type: 'source_document', resource_kind: 'document', target_id: 'doc-1', phase: 'request', created_at: '2026-08-12T10:00:00Z' },
      { id: 'other-target', event_type: 'source_document_delete', lifecycle_kind: 'deletion_recovery', correlation_key: 'operation:delete-1', target_type: 'source_document', resource_kind: 'document', target_id: 'doc-2', phase: 'completion', created_at: '2026-08-12T09:59:00Z' },
    ];
    const grouped = groupActivityLifecycles(events);
    expect(grouped).toHaveLength(2);
    expect(grouped[0].id).toBe('complete');
    expect(grouped[0].lifecycle_events).toHaveLength(2);
    expect(grouped[1].id).toBe('other-target');
  });

  it('keeps old same-target events separate when correlation is missing', () => {
    const events = [
      { id: 'complete', event_type: 'source_document_delete', target_type: 'source_document', target_id: 'doc-1', created_at: '2026-08-12T10:01:00Z' },
      { id: 'request', event_type: 'source_document_delete_requested', target_type: 'source_document', target_id: 'doc-1', created_at: '2026-08-12T10:00:00Z' },
    ];
    const grouped = groupActivityLifecycles(events);
    expect(grouped).toHaveLength(2);
    expect(grouped.every(item => item.lifecycle_events.length === 1)).toBe(true);
  });
});
