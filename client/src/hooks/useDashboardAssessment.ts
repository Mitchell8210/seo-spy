import { mapSocialMediaReport } from '../services/socialMediaMapping'
import { mapDashboardAssessment } from '../services/dashboardAssessment'
import { useDashboardReports } from './useDashboardReports'
import { useReportInterpretation } from './useReportInterpretation'

export function useDashboardAssessment(businessId: string, auditId?: string, auditStatus?: string) {
  const reports = useDashboardReports(businessId, auditId, auditStatus)
  const interpretation = useReportInterpretation(businessId, [reports.websiteReport?.auditId, reports.socialReport?.auditId].filter((id): id is string => !!id), auditStatus)
  return { ...reports, ...mapDashboardAssessment(businessId, reports.website.dashboard, reports.websiteReport, reports.social.data, interpretation),
    socialView: reports.social.data ? mapSocialMediaReport(reports.social.data) : null }
}
export type DashboardAssessmentModel = ReturnType<typeof useDashboardAssessment>
