'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useToast } from '../../toast-context';
import { useActiveMember } from '../../member-context';
import { memberHref } from '@/lib/members';
import { ConfirmDialog } from '../../_components/Shared';

type ChangeRequest = {
  id: string;
  target_type: string;
  target_id: string | null;
  member_name?: string | null;
  target_label: string;
  action: string;
  current_snapshot: Record<string, unknown> | null;
  proposed_payload: Record<string, unknown>;
  patient_note: string | null;
  status: string;
  reviewer_note: string | null;
  requested_action: string;
  patient_facing_note: string | null;
  available_actions: string[];
  created_at: string;
  updated_at: string;
  withdrawn_at: string | null;
};

const ACTION_LABELS: Record<string, string> = {
  upload_clearer_photo: '上傳更清楚的照片',
  provide_date: '補充日期',
  provide_hospital: '補充醫院或診所',
  confirm_medication_name: '確認藥名',
  confirm_whether_taking: '確認是否正在服用',
  confirm_follow_up_date: '確認回診日期',
  confirm_allergy_reaction: '確認過敏反應',
  provide_note: '補充說明',
  upload_document: '上傳文件',
};

const TARGET_TYPE_LABELS: Record<string, string> = {
  problem: '醫療團隊確認的病況',
  condition: '我管理的病況',
  allergy: '過敏資料',
  medication_regimen: '目前用藥',
  medication_event: '用藥紀錄',
  vaccine: '疫苗紀錄',
  measurement: '量測紀錄',
  appointment: '回診提醒',
  reminder: '提醒',
  family_medical_history: '家族病史',
  patient_profile: '基本健康資料',
  source_document: '健康文件',
  red_zone: '急診重要資訊',
  change_request: '資料異動',
  other: '其他健康資料',
};

const REQUEST_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  pending_review: '等待醫療團隊確認',
  accepted: '醫療團隊已確認',
  modified_and_accepted: '醫療團隊已修正並確認',
  rejected: '未採用',
  withdrawn: '已撤回',
  needs_clarification: '需要補充',
  needs_secondary_review: '等待進一步確認',
  replied: '已回覆',
  completed: '已完成',
};

const HEALTH_STATUS_LABELS: Record<string, string> = {
  ...REQUEST_STATUS_LABELS,
  active: '目前有效',
  inactive: '目前未啟用',
  underlying: '重要病史',
  following: '持續追蹤',
  resolved: '已結束',
  deleted: '已移除',
  taking: '目前服用',
  not_taking: '目前未服用',
  unknown: '尚未確認',
};

function targetTypeLabel(value?: string | null): string {
  return value ? TARGET_TYPE_LABELS[value] ?? '其他健康資料' : '其他健康資料';
}

function requestStatusLabel(value?: string | null): string {
  return value ? REQUEST_STATUS_LABELS[value] ?? '狀態待確認' : '狀態待確認';
}

function requestedActionLabel(value?: string | null): string {
  return value ? ACTION_LABELS[value] ?? '補充相關資料' : '補充相關資料';
}

function healthStatusLabel(value: unknown): string {
  const key = String(value ?? '').trim();
  return key ? HEALTH_STATUS_LABELS[key] ?? '狀態待確認' : '未記錄';
}

function fmtDate(value?: string | null): string {
  if (!value) return '未記錄';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.replace(/T.*$/, '');
  return d.toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function textValue(value: unknown): string {
  if (value == null || value === '') return '未記錄';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return value.length ? value.map(textValue).join('、') : '未記錄';
  if (typeof value === 'object') return '已記錄';
  return String(value);
}

function payloadText(payload: Record<string, unknown> | null | undefined, keys: string[]): string {
  for (const key of keys) {
    const value = payload?.[key];
    if (value != null && value !== '') {
      if (key === 'status' || key === 'to_status' || key.endsWith('_status')) return healthStatusLabel(value);
      return textValue(value);
    }
  }
  return '未記錄';
}

export default function ClarificationReplyPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { showToast } = useToast();
  const { activeMember } = useActiveMember();
  const [requestItem, setRequestItem] = useState<ChangeRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [replyDate, setReplyDate] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploadedDocId, setUploadedDocId] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [loadError, setLoadError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [withdrawDialogOpen, setWithdrawDialogOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError('');
    api.get(`/api/patients/me/change-requests/${id}`)
      .then((payload) => {
        if (!alive) return;
        const req = payload as ChangeRequest;
        const draft = req.proposed_payload?.clarification_draft as Record<string, unknown> | undefined;
        const reply = req.proposed_payload?.clarification_reply as Record<string, unknown> | undefined;
        setRequestItem(req);
        setReplyText(String(draft?.reply_text ?? reply?.reply_text ?? ''));
        setReplyDate(String(draft?.reply_date ?? reply?.reply_date ?? ''));
        setUncertain(Boolean(draft?.uncertain ?? reply?.uncertain ?? false));
        setUploadedDocId(String(draft?.source_document_id ?? reply?.source_document_id ?? '') || null);
      })
      .catch((error) => {
        if (!alive) return;
        setRequestItem(null);
        setLoadError(error instanceof Error ? error.message : '無法載入補充資料');
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id, reloadToken]);

  const canReply = requestItem?.status === 'needs_clarification';
  const canWithdraw = requestItem ? ['draft', 'pending_review', 'needs_clarification'].includes(requestItem.status) : false;
  const requestedAction = requestItem?.requested_action || String(requestItem?.proposed_payload?.requested_action || 'provide_note');
  const question = useMemo(() => {
    if (!requestItem) return '';
    return String(requestItem.proposed_payload?.question || requestItem.patient_facing_note || requestItem.reviewer_note || '醫療團隊需要你補充這筆資料。');
  }, [requestItem]);
  const submittedReply = requestItem?.proposed_payload?.clarification_reply as Record<string, unknown> | undefined;
  const savedDraft = requestItem?.proposed_payload?.clarification_draft as Record<string, unknown> | undefined;

  const uploadIfNeeded = async () => {
    if (!file) return uploadedDocId;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('member_name', requestItem?.member_name || '本人');
    fd.append('doc_type', 'clarification_reply');
    fd.append('note', `補充資料 · ${requestItem?.target_label || requestItem?.id}`);
    const res = await fetch('/api/documents', { method: 'POST', credentials: 'include', body: fd });
    if (!res.ok) throw new Error('upload_failed');
    const doc = await res.json() as { id: string };
    setUploadedDocId(doc.id);
    return doc.id;
  };

  const saveDraft = async () => {
    if (!requestItem) return;
    setBusy('draft');
    try {
      const docId = await uploadIfNeeded();
      const updated = await api.post(`/api/patients/me/change-requests/${requestItem.id}/draft`, {
        reply_text: replyText,
        reply_date: replyDate || null,
        uncertain,
        source_document_id: docId,
        attachment_ids: docId ? [docId] : [],
      }) as ChangeRequest;
      setRequestItem(updated);
      showToast(`已儲存補充草稿 · ${requestItem.target_label}`, 'success');
    } catch {
      showToast('草稿儲存失敗，請稍後再試', 'error');
    } finally {
      setBusy('');
    }
  };

  const submitReply = async () => {
    if (!requestItem || !canReply) return;
    if (!replyText.trim() && !replyDate && !uncertain && !file && !uploadedDocId) {
      showToast('請先填寫說明、日期、選擇不確定，或上傳文件', 'info');
      return;
    }
    setBusy('submit');
    try {
      const docId = await uploadIfNeeded();
      const updated = await api.post(`/api/patients/me/change-requests/${requestItem.id}/reply`, {
        reply_text: replyText,
        reply_date: replyDate || null,
        uncertain,
        source_document_id: docId,
        attachment_ids: docId ? [docId] : [],
      }) as ChangeRequest;
      setRequestItem(updated);
      showToast(`已送出補充 · ${requestItem.target_label}`, 'success');
      router.push(memberHref('/dashboard/history', requestItem?.member_name ?? activeMember));
    } catch {
      showToast('送出失敗，請稍後再試', 'error');
    } finally {
      setBusy('');
    }
  };

  const withdraw = async () => {
    if (!requestItem || !canWithdraw) return;
    setWithdrawDialogOpen(false);
    setBusy('withdraw');
    try {
      const updated = await api.post(`/api/patients/me/change-requests/${requestItem.id}/withdraw`) as ChangeRequest;
      setRequestItem(updated);
      showToast(`已撤回 · ${requestItem.target_label}`, 'success');
      router.push(memberHref('/dashboard/history', requestItem?.member_name ?? activeMember));
    } catch {
      showToast('撤回失敗，請稍後再試', 'error');
    } finally {
      setBusy('');
    }
  };

  if (loading) {
    return (
      <div className="page-wrap" style={{ maxWidth: 980, margin: '0 auto' }}>
        <section style={card} aria-busy="true">
          <div style={{ width: '38%', height: 18, borderRadius: 999, background: '#e3e9ee', marginBottom: 12 }} />
          <div style={{ width: '70%', height: 12, borderRadius: 999, background: '#eef2f5', marginBottom: 8 }} />
          <div style={{ width: '52%', height: 12, borderRadius: 999, background: '#eef2f5' }} />
        </section>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="page-wrap" style={{ maxWidth: 860, margin: '0 auto' }}>
        <button onClick={() => router.push(memberHref('/dashboard/history', activeMember))} style={backBtn}>← 返回健康歷程</button>
        <section style={{ ...card, borderColor: '#fecdd3', background: '#faecea' }}>
          <h1 style={{ ...title, color: '#8f342b' }}>補充資料暫時無法載入</h1>
          <p style={{ color: '#7f1d1d', lineHeight: 1.7 }}>這可能是 API、登入或權限狀態問題，不代表這筆 request 不存在。錯誤：{loadError}</p>
          <button onClick={() => setReloadToken((value) => value + 1)} style={primaryBtn}>重新載入</button>
        </section>
      </div>
    );
  }

  if (!requestItem) {
    return (
      <div className="page-wrap" style={{ maxWidth: 860, margin: '0 auto' }}>
        <button onClick={() => router.push(memberHref('/dashboard/history', activeMember))} style={backBtn}>← 返回健康歷程</button>
        <section style={card}>
          <h1 style={title}>找不到這筆補充資料</h1>
          <p style={{ color: '#6b7c8c' }}>這筆 request 可能已不存在，或目前不屬於你的帳號。</p>
        </section>
      </div>
    );
  }

  return (
    <div className="page-wrap" style={{ maxWidth: 980, margin: '0 auto' }}>
      <button onClick={() => router.push(memberHref('/dashboard/history', requestItem?.member_name ?? activeMember))} style={backBtn}>← 返回健康歷程</button>
      <header style={{ marginBottom: 16 }}>
        <h1 style={title}>補充資料</h1>
        <p style={{ color: '#6b7c8c', margin: '4px 0 0', lineHeight: 1.6 }}>
          醫療團隊需要你補充 · {requestItem.target_label}
        </p>
      </header>

      <section style={card}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <span style={badge}>{targetTypeLabel(requestItem.target_type)}</span>
          <span style={badge}>{requestStatusLabel(requestItem.status)}</span>
          <span style={badge}>{requestedActionLabel(requestedAction)}</span>
        </div>
        <h2 style={{ margin: '0 0 8px', fontSize: 18, color: '#22313f' }}>{question}</h2>
        <div style={{ color: '#6b7c8c', fontSize: 13, lineHeight: 1.7 }}>
          建立時間：{fmtDate(requestItem.created_at)} · 更新時間：{fmtDate(requestItem.updated_at)}
        </div>
        {!canReply && (
          <div style={{ ...notice, marginTop: 12 }}>
            這筆目前狀態是「{requestStatusLabel(requestItem.status)}」，不能再送出補充。你仍可查看已送出的內容與歷史紀錄。
          </div>
        )}
      </section>

      <section style={{ ...card, marginTop: 14 }}>
        <h2 style={{ margin: 0, fontSize: 18, color: '#22313f' }}>你的回覆</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginTop: 12 }}>
          <label style={labelStyle}>
            補充說明
            <textarea value={replyText} disabled={!canReply} onChange={(e) => setReplyText(e.target.value)} rows={7} placeholder="請用自己的話補充。例：我不確定藥名，但藥袋上寫每日一次。" style={textarea} />
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={labelStyle}>
              相關日期
              <input type="date" value={replyDate} disabled={!canReply} onChange={(e) => setReplyDate(e.target.value)} style={input} />
            </label>
            <label style={{ ...labelStyle, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, border: '1px solid #e3e9ee', borderRadius: 10, padding: 10 }}>
              <input type="checkbox" checked={uncertain} disabled={!canReply} onChange={(e) => setUncertain(e.target.checked)} />
              我不確定
            </label>
            <label style={labelStyle}>
              上傳照片/文件
              <input type="file" disabled={!canReply} onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={input} />
              {uploadedDocId && <span style={{ color: '#2e8b57', fontSize: 12 }}>已上傳文件：{uploadedDocId}</span>}
            </label>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
          <button onClick={saveDraft} disabled={!canReply || busy !== ''} title={!canReply ? '目前狀態不能儲存草稿' : '先儲存，稍後再送出'} style={secondaryBtn}>儲存草稿</button>
          <button onClick={submitReply} disabled={!canReply || busy !== ''} title={!canReply ? '目前狀態不能送出' : '送回醫療團隊工作台'} style={primaryBtn}>送出補充</button>
          <button onClick={() => setWithdrawDialogOpen(true)} disabled={!canWithdraw || busy !== ''} title={!canWithdraw ? '已處理或關閉，不能撤回' : '撤回尚未完成的補充/異動'} style={dangerBtn}>撤回</button>
        </div>
        {busy && (
          <div style={{ ...notice, marginTop: 12, background: '#e7f3f5', borderColor: '#cfe3e8', color: '#33596a' }}>
            {busy === 'draft' ? '正在儲存草稿...' : busy === 'submit' ? '正在送回醫療團隊...' : busy === 'withdraw' ? '正在撤回...' : '正在處理...'}
          </div>
        )}
      </section>

      <section style={{ ...card, marginTop: 14 }}>
        <h2 style={{ margin: 0, fontSize: 16, color: '#22313f' }}>這筆補充會回到哪裡</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 10 }}>
          <InfoTile label="資料項目" value={requestItem.target_label || payloadText(requestItem.current_snapshot, ['display_layman', 'display_name', 'drug_name', 'substance', 'title'])} />
          <InfoTile label="目前正式紀錄" value={payloadText(requestItem.current_snapshot, ['status', 'display_layman', 'display_name', 'drug_name', 'substance', 'title'])} />
          <InfoTile label="你先前提出" value={requestItem.patient_note || payloadText(requestItem.proposed_payload, ['to_status', 'display_layman', 'display_name', 'drug_name', 'substance', 'title'])} />
          <InfoTile label="醫療團隊需要" value={requestedActionLabel(requestedAction)} />
        </div>
        {(savedDraft || submittedReply) && (
          <div style={{ ...notice, marginTop: 12, background: submittedReply ? '#e7f4ec' : '#f6f9fa', borderColor: submittedReply ? '#bfe0cd' : '#e3e9ee', color: submittedReply ? '#2e8b57' : '#56687a' }}>
            <strong>{submittedReply ? '已送出的補充' : '已儲存的草稿'}：</strong>
            {payloadText((submittedReply || savedDraft) as Record<string, unknown>, ['reply_text'])}
            {payloadText((submittedReply || savedDraft) as Record<string, unknown>, ['reply_date']) !== '未記錄' && ` · 日期 ${payloadText((submittedReply || savedDraft) as Record<string, unknown>, ['reply_date'])}`}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={withdrawDialogOpen}
        onCancel={() => setWithdrawDialogOpen(false)}
        onConfirm={() => { void withdraw(); }}
        title="撤回這次補充？"
        description={`「${requestItem.target_label}」的草稿或待處理回報會被撤回；已建立的正式健康紀錄不會被刪除。`}
        confirmLabel="確認撤回"
        danger
      />
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#f6f9fa', border: '1px solid #e3e9ee', borderRadius: 10, padding: 10 }}>
      <div style={{ fontSize: 12, color: '#6b7c8c', fontWeight: 850, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 13, color: '#22313f', lineHeight: 1.5, wordBreak: 'break-word' }}>{value}</div>
    </div>
  );
}

const title: React.CSSProperties = { margin: '8px 0 0', color: '#22313f', fontSize: 28, fontWeight: 900 };
const card: React.CSSProperties = { background: '#fff', border: '1px solid #e3e9ee', borderRadius: 14, padding: 18, boxShadow: 'var(--shadow-sm)' };
const badge: React.CSSProperties = { display: 'inline-flex', borderRadius: 999, background: '#eef2f5', color: '#56687a', padding: '3px 8px', fontSize: 11, fontWeight: 850 };
const notice: React.CSSProperties = { background: '#fdf1e0', border: '1px solid #fed7aa', color: '#b06a10', borderRadius: 10, padding: 10, fontSize: 13, lineHeight: 1.6 };
const backBtn: React.CSSProperties = { border: '1px solid #e3e9ee', background: '#fff', color: '#45596a', borderRadius: 10, padding: '8px 12px', fontWeight: 800, cursor: 'pointer' };
const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#6b7c8c', fontWeight: 850 };
const input: React.CSSProperties = { border: '1px solid #c8d4dc', borderRadius: 10, padding: 10, fontSize: 13, background: '#fff' };
const textarea: React.CSSProperties = { ...input, resize: 'vertical', minHeight: 160 };
const primaryBtn: React.CSSProperties = { border: 'none', background: '#3e6b7e', color: '#fff', borderRadius: 10, padding: '10px 14px', fontWeight: 850, cursor: 'pointer' };
const secondaryBtn: React.CSSProperties = { border: '1px solid #c8d4dc', background: '#fff', color: '#45596a', borderRadius: 10, padding: '10px 14px', fontWeight: 850, cursor: 'pointer' };
const dangerBtn: React.CSSProperties = { border: '1px solid #fecdd3', background: '#faecea', color: '#a03a30', borderRadius: 10, padding: '10px 14px', fontWeight: 850, cursor: 'pointer' };
