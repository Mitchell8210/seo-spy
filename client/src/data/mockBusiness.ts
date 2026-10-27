import type { Business, Connection } from '../types/dashboard'

export const mockBusiness: Business = {
  id: 'demo-guzman',
  name: 'Guzman Tax Accounting',
  website: 'https://guzmantaxaccounting.com',
  status: 'Ready for analysis',
}

export const mockConnections: Connection[] = [
  { id: 'website', name: 'Website', platform: 'website', identity: 'guzmantaxaccounting.com', status: 'Connected' },
  { id: 'facebook', name: 'Facebook Business Page', platform: 'facebook', identity: 'Guzman Tax Accounting', status: 'Connected' },
]
