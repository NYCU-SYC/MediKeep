'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { getNhiOnboarding, NhiOnboardingState } from '@/lib/nhiImports'
import styles from './NhiReminderCard.module.css'

export default function NhiReminderCard() {
  const [state, setState] = useState<NhiOnboardingState | null>(null)
  const load = useCallback(async () => {
    try {
      setState(await getNhiOnboarding())
    } catch {
      // The dashboard stays usable when this optional reminder is unavailable.
      setState(null)
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  if (!state || !state.feature_enabled || state.completed_at) return null

  return (
    <section className={`hk-card ${styles.card}`} aria-label="健保資料匯入提醒">
      <div className={styles.copy}>
        <div className={styles.title}>近三年健康時間軸還可以更完整</div>
        <p className={styles.text}>
          您可以匯入健保資料，完成後在健康時間軸查看整理結果。這張提醒會保留到匯入完成。
        </p>
      </div>
      <Link className={`hk-btn hk-btn-sm ${styles.action}`} href="/dashboard/upload?mode=nhi-first">
        開始匯入
      </Link>
    </section>
  )
}
