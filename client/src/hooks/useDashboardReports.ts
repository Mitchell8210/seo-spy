import { useEffect } from 'react'
import { useWebsiteReport } from './useWebsiteReport'
import { useFacebookReport } from './useFacebookReport'
import { mapDashboardReports } from '../services/dashboardMapping'

export function useDashboardReports(businessId: string, auditId?: string, auditStatus?: string) {
  const website = useWebsiteReport(businessId)
  const social = useFacebookReport(businessId)
  const refreshWebsite = website.refresh
  const refreshSocial = social.refresh
  useEffect(() => {
    const refresh = () => { refreshWebsite(); refreshSocial() }
    const timer = setInterval(refreshSocial, 15000)
    window.addEventListener('focus', refreshSocial)
    // Updates from the existing investigation flow re-read the durable reports.
    if (auditId) refresh()
    return () => { clearInterval(timer); window.removeEventListener('focus', refreshSocial) }
  }, [refreshWebsite, refreshSocial, auditId, auditStatus])
  return {
    ...mapDashboardReports(website.dashboard, website.report, social.data),
    loading: website.loading || social.loading,
    refreshSocial,
    websiteReport: website.report,
    socialReport: social.data?.report ?? null,
    latestWebsiteAttempt: website.latestAttempt,
    latestSocialAttempt: social.data?.latestAttempt ?? null,
    error: [website.error, social.error].filter(Boolean).join(' ') || null,
    refresh: () => { refreshWebsite(); refreshSocial() },
  }
}
