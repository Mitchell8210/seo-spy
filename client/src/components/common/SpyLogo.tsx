import catLogo from '../../assets/seo-spy-cat.png'

export function SpyLogo() {
  return (
    <span className="inline-flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-1">
      <img src={catLogo} alt="" className="h-full w-full object-contain" />
    </span>
  )
}
