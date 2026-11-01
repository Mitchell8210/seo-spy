export type TaskPriority = 'Urgent' | 'Medium' | 'Low'
export type TaskCategory = 'Admin' | 'Content' | 'Social' | 'Search' | 'Review'
export interface TaskSchedule { day: string; hour: number }
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
}
export interface TaskEdit { status?: PlannerTask['status']; schedule?: TaskSchedule | null }
export interface PlannerLocalState {
  edits: Record<string, TaskEdit>
  completed: Record<string, PlannerTask>
  custom: PlannerTask[]
  useWeekends: boolean
}
