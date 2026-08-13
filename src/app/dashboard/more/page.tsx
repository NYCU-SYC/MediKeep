import Link from 'next/link';
import { PageHeader, ReadOnlyNotice, SourceBadge, TaskLinkCard } from '../_components/Shared';

const moreLinks = [
  { title: '家庭與權限', description: '查看家庭成員、目前身份與可管理的家庭設定。', href: '/dashboard/settings', icon: 'user', badge: <SourceBadge source="目前登入身份" /> },
  { title: '分享管理', description: '查看已建立的影像分享與可撤銷的分享狀態。', href: '/dashboard/imaging/shares', icon: 'share', badge: <SourceBadge source="分享紀錄" /> },
  { title: '帳號與登入', description: '回到家庭與權限頁查看目前帳號與登入相關設定。', href: '/dashboard/settings', icon: 'settings', badge: <SourceBadge source="目前登入身份" /> },
];

export default function MoreLandingPage() {
  return (
    <div className="page-wrap">
      <div className="hk-health-wrap">
        <PageHeader
          eyebrow="更多"
          title="更多"
          description="把家庭管理、分享與帳號相關工作集中在這裡；未完成的通知控制不會被做成假按鈕。"
        />
        <div className="hk-landing-stack">
          <section className="hk-card">
            <div className="hk-section-heading">
              <div>
                <h2>家庭與帳號</h2>
                <p>只有目前登入身份可管理的設定會在下一頁顯示。</p>
              </div>
            </div>
            <div className="hk-landing-grid">
              {moreLinks.map((item) => <TaskLinkCard key={`${item.title}-${item.href}`} {...item} />)}
            </div>
          </section>

          <ReadOnlyNotice title="通知說明">
            提醒會顯示在頁首提醒鈴與「待辦」入口。通知偏好控制尚未提供完整操作流程，因此這裡只說明目前行為，不放置不可用的切換控制。
          </ReadOnlyNotice>

          <section className="hk-card">
            <div className="hk-section-heading">
              <div>
                <h2>需要快速前往？</h2>
                <p>常用的新增與急診入口固定在 shell 的快速操作區。</p>
              </div>
            </div>
            <div className="hk-page-header-actions">
              <Link href="/dashboard/upload" className="hk-btn hk-btn-primary">新增紀錄</Link>
              <Link href="/dashboard/emergency" className="hk-btn hk-btn-ghost">急診資訊</Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
