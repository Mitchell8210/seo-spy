import { useEffect, useRef, useState } from 'react'

// One animated value drives both the number and its progress indicator.
export function useAnimatedScore(value: number | null, maximum: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [frame, setFrame] = useState({ target: value, maximum, value: 0 })
  const targetChanged = frame.target !== value || frame.maximum !== maximum
  if (targetChanged) setFrame({ target: value, maximum, value: 0 })
  const displayed = targetChanged ? 0 : frame.value

  useEffect(() => {
    if (value === null) return
    const element = ref.current
    if (!element) return
    let request = 0
    let started = false
    let startTime: number | null = null
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = (next: number) => setFrame({ target: value, maximum, value: next })
    const tick = (time: number) => {
      startTime ??= time
      const progress = motion.matches ? 1 : Math.min(1, (time - startTime) / 1600)
      update(progress === 1 ? value : Math.round(value * (1 - (1 - progress) ** 2)))
      if (progress < 1) request = requestAnimationFrame(tick)
    }
    const start = () => {
      if (started) return
      started = true
      request = requestAnimationFrame(tick)
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect()
        start()
      }
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(request)
    }
  }, [value, maximum])

  return {
    ref,
    value: value === null ? null : displayed,
    fraction: maximum > 0 ? Math.max(0, Math.min(1, displayed / maximum)) : 0,
  }
}
