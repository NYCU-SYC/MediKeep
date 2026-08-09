'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getNhiImportJob, NhiImportJob, retryNhiImport } from '@/lib/nhiImports'
import styles from './NhiImportLoading.module.css'

const TERMINAL_STATES = new Set(['completed', 'stalled', 'failed', 'partial', 'needs_review'])
const POLL_DELAYS = [1000, 2000, 5000]
const LEASE_MS = 150_000

const STAGE_LABELS: Record<string, string> = {
  awaiting_upload: '等待上傳資料',
  queued: '已排入匯入佇列',
  preprocessing: '準備匯入資料',
  deidentifying: '進行去識別化',
  codex_parsing: '解析健保資料',
  validating: '驗證資料格式',
  importing: '寫入健康資料',
  running: '正在整理資料',
  processing: '正在整理資料',
  completed: '匯入完成',
  stalled: '匯入暫停，需要重新嘗試',
  failed: '匯入未完成',
  partial: '部分資料已匯入',
  needs_review: '匯入完成，等待確認',
}

function normalizedState(job: NhiImportJob | null): string {
  return job?.state.trim().toLowerCase() ?? ''
}

function isTerminal(job: NhiImportJob | null): boolean {
  return Boolean(job && TERMINAL_STATES.has(normalizedState(job)))
}

function stateLabel(state: string): string {
  return STAGE_LABELS[state] || '正在處理匯入'
}

function stageLabel(stage: string): string {
  const normalized = stage.trim().toLowerCase()
  return STAGE_LABELS[normalized] || stage
}

function isLeaseExpired(job: NhiImportJob | null, now: number): boolean {
  if (!job || isTerminal(job)) return false
  // Older API rows used a naive ISO string even though the value is UTC.
  // Interpret that legacy shape explicitly so an Asia/Taipei browser does
  // not make a fresh job look eight hours stale.
  const timestamp = /(?:Z|[+-]\d{2}:\d{2})$/i.test(job.updated_at)
    ? job.updated_at
    : `${job.updated_at}Z`
  const updatedAt = Date.parse(timestamp)
  return Number.isFinite(updatedAt) && now - updatedAt > LEASE_MS
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const timestamp = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-TW')
}

export default function NhiImportLoadingPage() {
  const params = useParams<{ jobId: string }>()
  const router = useRouter()
  const jobId = typeof params?.jobId === 'string' ? params.jobId : ''
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [job, setJob] = useState<NhiImportJob | null>(null)
  const [loading, setLoading] = useState(true)
  const [paused, setPaused] = useState(false)
  const [error, setError] = useState('')
  const [retrying, setRetrying] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!jobId) {
      setLoading(false)
      setError('找不到匯入工作編號。')
      return
    }

    let cancelled = false
    let timer: number | undefined
    let pollStep = 0

    const clearTimer = () => {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = undefined
    }

    const schedule = (run: () => void) => {
      clearTimer()
      const delay = POLL_DELAYS[Math.min(pollStep, POLL_DELAYS.length - 1)]
      pollStep = Math.min(pollStep + 1, POLL_DELAYS.length - 1)
      timer = window.setTimeout(() => {
        timer = undefined
        run()
      }, delay)
    }

    const load = async () => {
      if (cancelled) return
      if (document.hidden || !navigator.onLine) {
        setPaused(true)
        return
      }

      setLoading(true)
      try {
        const next = await getNhiImportJob(jobId)
        if (cancelled) return
        setJob(next)
        setError('')
        setPaused(false)

        if (normalizedState(next) === 'completed') {
          router.replace(`/dashboard/timeline?import=${encodeURIComponent(next.id)}`)
          return
        }
        if (!isTerminal(next) && !isLeaseExpired(next, Date.now())) schedule(() => void load())
      } catch {
        if (cancelled) return
        clearTimer()
        setLoading(false)
        setError('目前無法取得匯入進度，請確認網路後重試。')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    const resume = () => {
      if (document.hidden || !navigator.onLine || cancelled) return
      setPaused(false)
      void load()
    }
    const onVisibility = () => {
      if (document.hidden) {
        clearTimer()
        setPaused(true)
      } else {
        resume()
      }
    }
    const onOnline = () => resume()
    const onOffline = () => {
      clearTimer()
      setPaused(true)
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    void load()

    return () => {
      cancelled = true
      clearTimer()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [jobId, reloadToken, router])

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 5000)
    return () => window.clearInterval(interval)
  }, [])

  const terminal = isTerminal(job)
  const state = normalizedState(job)
  const leaseExpired = isLeaseExpired(job, now)
  const canRetry = Boolean(job && (leaseExpired || (job.retryable && ['stalled', 'failed', 'partial', 'needs_review'].includes(state))))
  const progress = job ? Math.max(0, Math.min(100, job.progress)) : 0
  const liveText = useMemo(() => {
    if (error) return error
    if (leaseExpired) return '可能卡住：這個匯入工作超過約 150 秒沒有更新。'
    if (paused) return '頁面暫停更新；回到頁面或恢復網路後會繼續。'
    if (!job) return '正在取得匯入進度。'
    const currentStage = job ? stageLabel(job.stage) : stateLabel(state)
    return `${currentStage}，目前進度 ${progress}%。`
  }, [error, job, leaseExpired, paused, progress, state])

  const previousState = useRef<string | null>(null)
  const previousError = useRef(false)
  const initialFocusDone = useRef(false)

  // Keep only the first response, terminal transitions, and error transitions
  // discoverable to keyboard users; ordinary polling must not steal focus.
  useEffect(() => {
    const nextState = normalizedState(job)
    const stateChanged = nextState !== previousState.current
    const errorActive = Boolean(error)
    const errorChanged = errorActive !== previousError.current
    const firstResponse = !initialFocusDone.current && (Boolean(job) || errorActive)
    const terminalTransition = stateChanged && TERMINAL_STATES.has(nextState)
    if (firstResponse || terminalTransition || (errorChanged && errorActive)) {
      headingRef.current?.focus()
      initialFocusDone.current = true
    }
    previousState.current = nextState
    previousError.current = errorActive
  }, [error, job])

  const handleRetry = useCallback(async () => {
    if (!jobId) return
    setRetrying(true)
    setError('')
    try {
      const next = await retryNhiImport(jobId)
      setJob(next)
      setPaused(false)
      setReloadToken((value) => value + 1)
    } catch {
      setError('重新匯入未完成，請稍後再試。')
    } finally {
      setRetrying(false)
    }
  }, [jobId])

  return (
    <div className={styles.page}>
      <section className={`hk-card ${styles.card}`}>
        <h1 ref={headingRef} tabIndex={-1} className={styles.heading}>健保資料匯入進度</h1>
        <p className={styles.description}>這個頁面會從匯入工作編號恢復進度；您可以切換頁面，之後再從相同網址回來查看。</p>

        <div className={styles.statusRow} role="status" aria-live="polite">
          {!terminal && !paused && !error && !leaseExpired && <span className={styles.spinner} aria-label="處理中" />}
          {(paused || error || leaseExpired) && <span className={`${styles.spinner} ${styles.paused}`} aria-hidden="true" />}
          <span className={styles.statusText}>{liveText}</span>
        </div>

        {job && (
          <>
            <div
              className={styles.progressTrack}
              role="progressbar"
              aria-label="匯入進度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
            >
              <div className={styles.progressBar} style={{ width: `${progress}%` }} />
            </div>
            <div className={styles.progressMeta}>
              <span>目前階段：{stageLabel(job.stage)}</span>
              <span>{job.processed_sections} / {job.total_sections} 個區段</span>
            </div>
            <div className={styles.details}>
              <div className={styles.detail}>
                <div className={styles.detailLabel}>工作編號</div>
                <div className={styles.detailValue}>{job.id}</div>
              </div>
              <div className={styles.detail}>
                <div className={styles.detailLabel}>最近更新</div>
                <div className={styles.detailValue}>{formatDate(job.updated_at)}</div>
              </div>
              <div className={styles.detail}>
                <div className={styles.detailLabel}>版本</div>
                <div className={styles.detailValue}>{job.version}</div>
              </div>
            </div>
          </>
        )}

        {job && ['failed', 'stalled'].includes(state) && (
          <div className={styles.alert} role="alert">
            {job.error_message || '匯入工作已停止。請確認資料後重新嘗試。'}
            {job.error_code && <span>（{job.error_code}）</span>}
          </div>
        )}
        {job && ['partial', 'needs_review'].includes(state) && (
          <div className={styles.notice} role="status">
            這次匯入已停止，請先查看目前結果；若要再次處理，可使用重新嘗試。
            {job.imported_sections && job.imported_sections.length > 0 && (
              <div>已匯入區段：{job.imported_sections.join('、')}</div>
            )}
            {job.failed_sections && job.failed_sections.length > 0 && (
              <div>失敗區段：{job.failed_sections.join('、')}</div>
            )}
          </div>
        )}

        {(error || canRetry || (terminal && state !== 'completed')) && (
          <div className={styles.actions}>
            {canRetry && (
              <button type="button" className={`hk-btn hk-btn-primary ${styles.action}`} onClick={() => void handleRetry()} disabled={retrying}>
                {retrying ? '重新整理中…' : '重新嘗試'}
              </button>
            )}
            {error && (
              <button type="button" className={`hk-btn hk-btn-ghost ${styles.action}`} onClick={() => setReloadToken((value) => value + 1)} disabled={loading}>
                {loading ? '讀取中…' : '重試進度'}
              </button>
            )}
            {terminal && !canRetry && (
              <Link className={`hk-btn hk-btn-ghost ${styles.action}`} href="/dashboard/nhi">回到健保資料</Link>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
