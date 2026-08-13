'use client'

/**
 * HealthKeep client-side sync layer.
 *
 * The server is the single source of truth; this module is the heartbeat that
 * keeps every open view converged on it.  A `SyncProvider` polls the relevant
 * `/sync-state` cursor, and `useSyncedQuery` re-runs a fetcher whenever an event
 * touches one of the views it watches — so a CMO accept refreshes the User's
 * open page, and a User request refreshes the CMO workbench, without either side
 * holding a stale local copy.
 *
 * No external query library: a tiny, dependency-free cache built on the existing
 * `api` client.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { api, invalidateApiGetCache } from '@/lib/api'

export type AffectedView =
  | 'patient_dashboard'
  | 'patient_problem_detail'
  | 'patient_medications'
  | 'patient_reminders'
  | 'patient_timeline'
  | 'patient_red_zone'
  | 'patient_nhi_imports'
  | 'cmo_workbench'
  | 'cmo_patient_pov'
  | 'cmo_red_zone'
  | 'cmo_medications'
  | 'cmo_activity'
  | 'cmo_audit_log'

export interface SyncEvent {
  id: number
  patient_id: string
  actor_role: string
  event_type: string
  target_type?: string | null
  target_id?: string | null
  affected_views: string[]
  summary?: string | null
  created_at?: string | null
}

export interface SyncState {
  sync_version: number
  server_time?: string
  counts?: Record<string, number>
  events: SyncEvent[]
}

interface SyncContextValue {
  /** Highest event id seen for this scope. */
  version: number
  /** Per-view cursor: viewVersions[view] = latest event id that touched it. */
  viewVersions: Record<string, number>
  /** Derived counts from the last poll (pending requests, drafts, …). */
  counts: Record<string, number>
  /** Most recent events, newest last. */
  events: SyncEvent[]
  /** Force an immediate poll (e.g. right after a local mutation). */
  refreshNow: () => void
  connected: boolean
}

const defaultValue: SyncContextValue = {
  version: 0,
  viewVersions: {},
  counts: {},
  events: [],
  refreshNow: () => {},
  connected: false,
}

const SyncContext = createContext<SyncContextValue>(defaultValue)

export function useSync(): SyncContextValue {
  return useContext(SyncContext)
}

interface ProviderProps {
  scope: 'patient' | 'cmo'
  /** When set with scope="cmo", polls that patient's CMO sync-state. */
  patientId?: string
  enabled?: boolean
  intervalMs?: number
  children: React.ReactNode
}

export function SyncProvider({
  scope,
  patientId,
  enabled = true,
  intervalMs = 5000,
  children,
}: ProviderProps) {
  const [version, setVersion] = useState(0)
  const [viewVersions, setViewVersions] = useState<Record<string, number>>({})
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [events, setEvents] = useState<SyncEvent[]>([])
  const [connected, setConnected] = useState(false)
  const cursorRef = useRef(0)
  const pollRef = useRef<() => void>(() => {})

  const path =
    scope === 'patient'
      ? '/api/patients/me/sync-state'
      : patientId
        ? `/api/cmo/patients/${patientId}/sync-state`
        : '/api/cmo/sync-state'

  useEffect(() => {
    // Reset the cursor whenever the polled target changes.
    cursorRef.current = 0
    setVersion(0)
    setViewVersions({})
    if (!enabled) return

    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined

    const poll = async () => {
      try {
        const params = cursorRef.current
          ? { since: String(cursorRef.current) }
          : undefined
        const state = (await api.get(path, params)) as SyncState
        if (!alive) return
        if (state.events && state.events.length) {
          invalidateApiGetCache()
          setViewVersions((prev) => {
            const next = { ...prev }
            for (const ev of state.events) {
              for (const view of ev.affected_views || []) {
                next[view] = Math.max(next[view] || 0, ev.id)
              }
            }
            return next
          })
          setEvents((prev) => [...prev, ...state.events].slice(-50))
        }
        cursorRef.current = state.sync_version ?? cursorRef.current
        setVersion(state.sync_version ?? 0)
        setCounts(state.counts ?? {})
        setConnected(true)
      } catch {
        // Auth/network errors: the api client handles 401 redirects; stay quiet.
        if (alive) setConnected(false)
      } finally {
        if (alive) timer = setTimeout(poll, intervalMs)
      }
    }

    pollRef.current = () => {
      if (timer) clearTimeout(timer)
      poll()
    }
    poll()

    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [enabled, path, intervalMs])

  const refreshNow = useCallback(() => pollRef.current(), [])

  const value: SyncContextValue = {
    version,
    viewVersions,
    counts,
    events,
    refreshNow,
    connected,
  }

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}

interface QueryOptions {
  /** Views to watch; refetch when any of them advances. Omit to watch everything. */
  watch?: AffectedView[]
  enabled?: boolean
}

interface QueryResult<T> {
  data: T | null
  loading: boolean
  error: unknown
  refresh: () => Promise<void>
}

/**
 * Run `fetcher` on mount and whenever a watched view advances. Returns the
 * cached data plus a manual `refresh()` for optimistic flows.
 */
export function useSyncedQuery<T>(
  fetcher: () => Promise<T>,
  opts?: QueryOptions,
): QueryResult<T> {
  const { version, viewVersions } = useSync()
  const enabled = opts?.enabled ?? true
  const watch = opts?.watch
  const trigger =
    watch && watch.length
      ? watch.reduce((max, v) => Math.max(max, viewVersions[v] || 0), 0)
      : version

  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const refresh = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    try {
      const result = await fetcherRef.current()
      setData(result)
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    refresh()
  }, [refresh, trigger])

  return { data, loading, error, refresh }
}
