export type TaskPriority = 'Urgent' | 'Medium' | 'Low'
export type TaskCategory = 'Admin' | 'Content' | 'Social' | 'Search' | 'Review'
export interface TaskSchedule { day: string; hour: number; minute?: 0 | 30 }
export interface PlannerPreferences {
  useWeekends: boolean
  dailyCapacityMinutes: number
  maxTasksPerDay: number
  horizonWeeks: number
  timeZone: string | null
}
export interface PlannerTask {
  id: string
  title: string
  explanation: string
  guidance: string
  priority: TaskPriority
  category: TaskCategory
  source: string
  mode: 'demo' | 'saved' | 'custom'
  destination?: string
  status: 'Needs Action' | 'Done'
  schedule?: TaskSchedule
  notes?: string
  estimatedDurationMinutes?: number
  durationEstimateSource?: 'default' | 'legacy-default' | 'user' | 'muse-estimate' | 'offline-estimate'
  scheduledBy?: 'manual' | 'auto' | 'legacy-unknown' | 'muse' | 'offline-preview' | null
}
export interface TaskEdit { status?: PlannerTask['status']; schedule?: TaskSchedule | null }
export interface PlannerLocalState {
  edits: Record<string, TaskEdit>
  completed: Record<string, PlannerTask>
  custom: PlannerTask[]
  useWeekends: boolean
}
