import { Ghost, Globe, MessagesSquare, Pin } from 'lucide-react'
import type { ConnectionPlatform } from '../../types/settings'
import { useId } from 'react'
import { platformBrandMarks } from './platformBrandMarks'

const icons = { website: Globe, pinterest: Pin, snapchat: Ghost, reddit: MessagesSquare }
const tones: Record<ConnectionPlatform, string> = {
  website: 'border-blue-400/25 bg-blue-500/15 text-blue-300', facebook: 'border-blue-400/25 bg-blue-600 text-white',
  instagram: 'border-pink-400/25 bg-pink-500/15 text-pink-300', whatsapp: 'border-emerald-400/25 bg-emerald-500/15 text-emerald-300',
  threads: 'border-slate-400/25 bg-slate-950 text-white', tiktok: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-300',
  linkedin: 'border-sky-400/25 bg-sky-500/15 text-sky-300', youtube: 'border-red-400/25 bg-red-500/15 text-red-300',
  x: 'border-slate-400/25 bg-slate-950 text-white', pinterest: 'border-red-400/25 bg-red-400/10 text-red-300',
  snapchat: 'border-yellow-400/25 bg-yellow-400/10 text-yellow-300', reddit: 'border-orange-400/25 bg-orange-400/10 text-orange-300',
  search: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300', analytics: 'border-amber-400/25 bg-amber-400/10 text-amber-300',
  shopify: 'border-lime-400/25 bg-lime-500/15 text-lime-300', woocommerce: 'border-purple-400/25 bg-purple-500/20 text-purple-200',
  lightspeed: 'border-red-400/25 bg-red-500/15 text-red-300', wix: 'border-slate-400/25 bg-white text-slate-950',
  bigcommerce: 'border-indigo-400/25 bg-indigo-500/15 text-indigo-200', square: 'border-slate-400/25 bg-slate-950 text-white',
  'business-profile': 'border-blue-400/25 bg-blue-500/10 text-blue-300', 'google-ads': 'border-blue-400/25 bg-blue-500/10 text-blue-300',
  'merchant-center': 'border-blue-400/25 bg-blue-500/10 text-blue-300', lighthouse: 'border-orange-400/25 bg-orange-400/10 text-orange-300',
  amazon: 'border-amber-400/25 bg-amber-400/10 text-amber-300', ebay: 'border-slate-400/25 bg-white text-slate-950', etsy: 'border-orange-400/25 bg-orange-400/10 text-orange-300',
  'tiktok-shop': 'border-cyan-400/25 bg-cyan-400/10 text-cyan-300', 'facebook-marketplace': 'border-blue-400/25 bg-blue-600 text-white',
}

// One shared local renderer for Available Connections and the picker.
export function PlatformIcon({ platform }: { platform: ConnectionPlatform }) {
  const gradientId = useId()
  const mark = platformBrandMarks[platform]
  const Icon = platform in icons ? icons[platform as keyof typeof icons] : null
  return <span aria-hidden="true" className={`relative flex size-11 shrink-0 items-center justify-center rounded-xl border ${tones[platform]}`}>
    {mark ? <svg width={platform === 'facebook' ? 32 : 25} height={platform === 'facebook' ? 32 : 25} viewBox={mark.viewBox} focusable="false" aria-hidden="true">
      {platform === 'instagram' && <defs><linearGradient id={gradientId} x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stopColor="#FEDA75" /><stop offset="45%" stopColor="#FA7E1E" /><stop offset="70%" stopColor="#D62976" /><stop offset="100%" stopColor="#962FBF" /></linearGradient></defs>}
      {platform === 'linkedin' && <rect x="1" y="1" width="22" height="22" rx="1" fill="#ffffff" />}
      <path d={mark.path} fill={platform === 'instagram' ? `url(#${gradientId})` : mark.color} />
      {mark.layers?.map((layer, index) => <path key={index} d={layer.path} fill={layer.fill} fillRule="evenodd" />)}
    </svg> : Icon ? <Icon size={25} /> : null}
  </span>
}
