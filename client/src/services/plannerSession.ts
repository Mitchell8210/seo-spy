import { PlannerApiError, plannerTasks, requestPlanner, type PlannerResponse } from './plannerApi'
import type { PlannerPreferences, PlannerTask } from '../types/planner'

interface PlannerView { tasks: PlannerTask[]; preferences: PlannerPreferences; useWeekends: boolean; loading: boolean; saving: boolean; message: string; error: string | null }
type Transport = typeof requestPlanner
interface PendingMutation { expectedRevision: number; mutationId: string }

/** One business per session. No localStorage reads, writes or imports. */
export class PlannerSession {
  private view: PlannerView = { tasks: [], preferences: { useWeekends: false, dailyCapacityMinutes: 120, maxTasksPerDay: 3, horizonWeeks: 4, timeZone: null }, useWeekends: false, loading: true, saving: false, message: 'Loading saved planner…', error: null }
  private response: PlannerResponse | null = null
  private listeners = new Set<() => void>()
  private controller = new AbortController()
  private epoch = 0
  private ready: Promise<void> = Promise.resolve()
  private queue: Promise<unknown> = Promise.resolve()
  private inflight = new Map<string, Promise<boolean>>()
  private uncertain = new Map<string, PendingMutation>()
  private conflictVersion = 0
  readonly businessId: string
  private transport: Transport
  constructor(businessId: string, transport: Transport = requestPlanner) { this.businessId = businessId; this.transport = transport }
  getSnapshot = () => this.view
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(value: Partial<PlannerView>) { this.view = { ...this.view, ...value }; for (const listener of this.listeners) listener() }
  private adopt(response: PlannerResponse) {
    if (this.response && response.revision < this.response.revision) return
    this.response = response
    this.update({ tasks: plannerTasks(response), preferences: { ...{ dailyCapacityMinutes: 120, maxTasksPerDay: 3, horizonWeeks: 4, timeZone: null }, ...response.preferences }, useWeekends: response.preferences.useWeekends, error: null })
  }
  start() {
    const epoch = ++this.epoch
    this.controller = new AbortController()
    this.ready = this.read(epoch)
    return () => { if (epoch === this.epoch) { this.epoch++; this.controller.abort() } }
  }
  private async read(epoch: number) {
    this.update({ loading: true })
    try {
      const response = await this.transport(this.businessId, this.controller.signal)
      if (epoch !== this.epoch) return
      this.adopt(response)
      this.update({ message: 'Planner loaded from the backend. Existing browser planner data has not been imported.' })
    } catch (error) {
      if (epoch === this.epoch) this.update({ message: this.response ? 'Planner refresh was not confirmed. Your last loaded planner was kept.' : 'The planner could not be loaded. Use Re-scan to retry.', error: error instanceof Error ? error.message : 'The planner could not be loaded.' })
    } finally { if (epoch === this.epoch) this.update({ loading: false }) }
  }
  serverId(taskKey: string) { return this.response?.tasks.find(task => task.taskKey === taskKey)?.id }
  mutate(method: 'POST' | 'PATCH', suffix: string, body: object, message: string): Promise<boolean> {
    const signature = JSON.stringify([method, suffix, body])
    const existing = this.inflight.get(signature)
    if (existing) return existing
    const epoch = this.epoch, conflictVersion = this.conflictVersion
    const operation = this.queue.then(async () => {
      await this.ready
      if (epoch !== this.epoch) return false
      if (!this.response || conflictVersion !== this.conflictVersion) {
        this.update({ message: 'Your action has not been saved.', error: 'Your action has not been saved. Refresh with Re-scan, then retry your intended action.' }); return false
      }
      this.update({ saving: true, message: 'Saving planner changes…', error: null })
      const mutation = this.uncertain.get(signature) ?? { expectedRevision: this.response.revision, mutationId: crypto.randomUUID() }
      try {
        const response = await this.transport(this.businessId, this.controller.signal, method, suffix, { ...body, ...mutation })
        if (epoch !== this.epoch) return false
        this.uncertain.delete(signature)
        this.adopt(response)
        if (response.planning) {
          const plan = response.planning
          const lastDay = new Date(`${plan.range.end}T12:00:00Z`); lastDay.setUTCDate(lastDay.getUTCDate() - 1)
          const unscheduled = new Set(response.tasks.filter(task => task.status === 'Needs Action' && !task.schedule).map(task => task.id))
          const reasons = [...new Set(plan.remaining.filter(item => unscheduled.has(item.taskId)).map(item => item.reason))].map(reason => reason === 'duration_exceeds_daily_capacity' ? 'a duration exceeds the daily budget' : reason === 'no_contiguous_slot' ? 'no continuous time slot fits' : 'the planning period is full')
          this.update({ message: `Scheduled ${plan.scheduledCount} ${plan.scheduledCount === 1 ? 'task' : 'tasks'} from ${plan.range.start} through ${lastDay.toISOString().slice(0, 10)}. ${unscheduled.size} ${unscheduled.size === 1 ? 'task remains' : 'tasks remain'} unscheduled.${reasons.length ? ` Reasons: ${reasons.join('; ')}.` : ''} Existing schedules were kept.${plan.overloadedDays.length ? ` ${plan.overloadedDays.length} existing ${plan.overloadedDays.length === 1 ? 'day exceeds' : 'days exceed'} your workload limits.` : ''} No AI service was called.` })
        } else this.update({ message })
        return true
      } catch (error) {
        if (epoch !== this.epoch) return false
        if (error instanceof PlannerApiError && (error.status === 0 || error.status >= 500)) this.uncertain.set(signature, mutation)
        else this.uncertain.delete(signature)
        if (error instanceof PlannerApiError && error.status === 409) {
          this.conflictVersion++
          await this.read(epoch)
          if (epoch === this.epoch) this.update({ message: 'Newer planner changes were loaded. Your intended action was not replayed.', error: 'Another planner change conflicted with this action. Your dialog entries are kept; review the current planner and retry your intended action.' })
        } else this.update({ message: 'Planner changes were not confirmed. Your last loaded planner was kept.', error: error instanceof Error ? error.message : 'The planner save failed. Your last loaded planner was kept.' })
        return false
      } finally { if (epoch === this.epoch) this.update({ saving: false }) }
    })
    this.queue = operation.catch(() => false)
    this.inflight.set(signature, operation)
    void operation.finally(() => this.inflight.delete(signature))
    return operation
  }
  refresh() {
    if (!this.response) { this.ready = this.read(this.epoch); return this.ready.then(() => Boolean(this.response)) }
    return this.mutate('POST', '/reconcile', { confirmed: true }, '')
  }
}
