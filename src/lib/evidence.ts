export type EvidenceDocument = {
  id: string;
  member_name?: string | null;
  file_name: string | null;
  doc_type: string | null;
  doc_date: string | null;
  status: string;
  processing_status?: string;
  processing_status_label?: string;
  is_verified: boolean;
  linked_to_verified_data: boolean;
  download_url: string | null;
  available: boolean;
  unavailable_reason?: string | null;
};

export function evidenceTitle(doc: EvidenceDocument): string {
  return doc.file_name || `來源文件 ${doc.id}`;
}

export function evidenceMeta(doc: EvidenceDocument): string {
  const parts = [
    doc.doc_type,
    doc.doc_date ? doc.doc_date.replace(/T.*$/, '') : null,
    doc.processing_status_label || doc.status,
    doc.is_verified ? '已確認' : '未確認',
  ].filter(Boolean);
  return parts.join(' · ');
}

export function evidenceUnavailableText(doc?: EvidenceDocument | null): string {
  if (!doc) return '尚未連結原始文件';
  return doc.unavailable_reason || '原始文件目前無法檢視';
}
