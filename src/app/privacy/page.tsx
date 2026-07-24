export default function PrivacyPage() {
  return (
    <div style={{
      maxWidth: '720px', margin: '0 auto', padding: '48px 24px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: '#333', lineHeight: 1.8,
    }}>
      <h1 style={{ fontSize: '28px', fontWeight: '800', marginBottom: '8px' }}>隱私權政策</h1>
      <p style={{ color: '#888', marginBottom: '40px' }}>最後更新：2025 年</p>

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '12px', color: '#111' }}>1. 服務說明</h2>
        <p>
          HealthKeep 是一款家庭健康管理應用程式，協助您記錄、追蹤及管理家庭成員的健康資訊。
          本應用程式透過 LINE 帳號進行身分驗證，不另行儲存您的 LINE 密碼。
        </p>
      </section>

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '12px', color: '#111' }}>2. 收集的資料</h2>
        <p>我們收集以下資料以提供服務：</p>
        <ul style={{ paddingLeft: '20px', marginTop: '8px' }}>
          <li>LINE 帳號識別碼（經過雜湊處理，不可還原）</li>
          <li>您手動輸入的健康紀錄（血壓、血糖、體重等）</li>
          <li>您上傳的健康文件圖片</li>
          <li>您設定的家庭成員資訊（姓名、關係、年齡）</li>
          <li>回診提醒與藥物資訊</li>
        </ul>
      </section>

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '12px', color: '#111' }}>3. 資料使用方式</h2>
        <p>收集的資料僅用於：</p>
        <ul style={{ paddingLeft: '20px', marginTop: '8px' }}>
          <li>提供健康紀錄管理功能</li>
          <li>顯示趨勢分析與健康統整報告</li>
          <li>發送回診提醒通知（如已啟用）</li>
        </ul>
        <p style={{ marginTop: '12px' }}>我們不會將您的資料出售或提供給第三方。</p>
      </section>

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '12px', color: '#111' }}>4. LINE 登入</h2>
        <p>
          本應用程式使用 LINE Login 進行身分驗證。我們僅取得您的 LINE 用戶識別碼，
          並透過單向雜湊演算法處理後儲存，無法還原為原始 LINE ID。
          我們不會存取您的 LINE 好友清單、訊息記錄或其他個人資訊。
        </p>
      </section>

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '12px', color: '#111' }}>5. 資料安全</h2>
        <p>
          所有資料傳輸均透過 HTTPS 加密。Session 憑證採用 HMAC-SHA256 簽署。
          伺服器存取受限於授權人員。
        </p>
      </section>

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '12px', color: '#111' }}>6. 資料刪除</h2>
        <p>
          您可隨時透過設定頁面刪除個別健康紀錄。
          如需完整刪除帳號及所有相關資料，請透過下方聯絡方式提出申請。
        </p>
      </section>

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '12px', color: '#111' }}>7. 聯絡我們</h2>
        <p>
          如有任何關於隱私權的疑問，歡迎透過 LINE 官方帳號或應用程式內的設定頁面聯繫我們。
        </p>
      </section>

      <div style={{
        marginTop: '48px', padding: '20px', background: '#f2f5f7',
        borderRadius: '12px', fontSize: '13px', color: '#888',
      }}>
        本隱私權政策適用於 HealthKeep 應用程式的所有功能與服務。
        我們保留隨時修改本政策的權利，重大變更將透過應用程式通知您。
      </div>
    </div>
  );
}
