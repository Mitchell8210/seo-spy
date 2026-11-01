import { mapSocialMediaReport } from '../services/socialMediaMapping'
import { mapDashboardAssessment } from '../services/dashboardAssessment'
import { useDashboardReports } from './useDashboardReports'

export function useDashboardAssessment(businessId: string, auditId?: string, auditStatus?: string) {
  const reports = useDashboardReports(businessId, auditId, auditStatus)
  return { ...reports, ...mapDashboardAssessment(businessId, reports.website.dashboard, reports.websiteReport, reports.social.data),
    socialView: reports.social.data ? mapSocialMediaReport(reports.social.data) : null }
}
export type DashboardAssessmentModel = ReturnType<typeof useDashboardAssessment>
