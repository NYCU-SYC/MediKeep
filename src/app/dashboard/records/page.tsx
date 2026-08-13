import { PageHeader, ReadOnlyNotice, SourceBadge, TaskLinkCard } from '../_components/Shared';

const recordLinks = [
  { title: '量測與健康事件', description: '新增或查看本人保存的量測與健康事件紀錄。', href: '/dashboard/history', icon: 'records', badge: <SourceBadge source="本人紀錄" /> },
  { title: '健康時間軸', description: '依時間查看量測、文件、醫療團隊整理與其他事件。', href: '/dashboard/timeline', icon: 'activity', badge: <SourceBadge source="健康活動紀錄" /> },
  { title: '上傳資料', description: '上傳報告或文件，讓資料進入既有整理流程。', href: '/dashboard/upload', icon: 'upload', badge: <SourceBadge source="本人上傳" /> },
  { title: '文件', description: '查看已上傳文件與目前處理狀態。', href: '/dashboard/documents', icon: 'folder', badge: <SourceBadge source="文件庫" /> },
  { title: '影像', description: '查看影像資料與已建立的分享。', href: '/dashboard/imaging', icon: 'scan', badge: <SourceBadge source="影像資料" /> },
  { title: '健保資料', description: '查看健康存摺匯入的來源與整理狀態。', href: '/dashboard/nhi', icon: 'archive', badge: <SourceBadge source="健保健康存摺" /> },
];

export default function RecordsLandingPage() {
  return (
    <div className="page-wrap">
      <div className="hk-health-wrap">
        <PageHeader
          eyebrow="紀錄"
          title="紀錄"
          description="依任務查看量測、事件、上傳資料與來源，不需要在同一頁面平鋪所有功能。"
        />
        <div className="hk-landing-stack">
          <section className="hk-card">
            <div className="hk-section-heading">
              <div>
                <h2>新增與查看資料</h2>
                <p>新增紀錄與上傳資料會沿用現有權限和成員範圍。</p>
              </div>
            </div>
            <div className="hk-landing-grid">
              {recordLinks.slice(0, 3).map((item) => <TaskLinkCard key={item.title} {...item} />)}
            </div>
          </section>
          <section className="hk-card">
            <div className="hk-section-heading">
              <div>
                <h2>尋找既有資料</h2>
                <p>文件、影像與健保來源分開呈現；量測與操作狀態都集中在「量測與健康事件」。</p>
              </div>
            </div>
            <div className="hk-landing-grid">
              {recordLinks.slice(3).map((item) => <TaskLinkCard key={item.title} {...item} />)}
            </div>
          </section>
          <ReadOnlyNotice>
            「紀錄」頁只提供入口與狀態摘要；各資料頁仍會依目前登入身份與成員權限限制可讀寫範圍。
          </ReadOnlyNotice>
        </div>
      </div>
    </div>
  );
}
