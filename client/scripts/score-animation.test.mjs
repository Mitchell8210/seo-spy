import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'

test('scores animate in view, stay synchronized, update, and clean up', async () => {
  let state, effect, cleanup, dependencies, observer, reduced = false, queued = new Map(), nextId = 0
  const element = {}
  globalThis.__scoreHooks = {
    useRef: () => ({ current: element }),
    useState: initial => { state ??= initial; return [state, next => { state = next }] },
    useEffect: (callback, deps) => {
      if (!dependencies || deps.some((value, index) => value !== dependencies[index])) {
        cleanup?.(); effect = callback; dependencies = deps
      }
    },
  }
  const originals = Object.fromEntries(['window', 'IntersectionObserver', 'requestAnimationFrame', 'cancelAnimationFrame'].map(key => [key, globalThis[key]]))
  globalThis.window = { matchMedia: () => ({ get matches() { return reduced } }) }
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; observer = this }
    observe(target) { assert.equal(target, element) }
    disconnect() { this.disconnected = true }
  }
  globalThis.requestAnimationFrame = callback => { queued.set(++nextId, callback); return nextId }
  globalThis.cancelAnimationFrame = id => queued.delete(id)
  const step = time => {
    const callbacks = [...queued.values()]; queued.clear()
    callbacks.forEach(callback => callback(time))
  }
  try {
    const source = await readFile(new URL('../src/hooks/useAnimatedScore.ts', import.meta.url), 'utf8')
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
      .replace(/import .* from 'react';?/, 'const { useEffect, useRef, useState } = globalThis.__scoreHooks;')
    const { useAnimatedScore } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
    const statusSource = await readFile(new URL('../src/utils/scoreStatus.ts', import.meta.url), 'utf8')
    const statusCode = ts.transpileModule(statusSource, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
    const { getScoreStatus } = await import(`data:text/javascript;base64,${Buffer.from(statusCode).toString('base64')}`)
    const render = (target = 93, maximum = 100) => {
      const result = useAnimatedScore(target, maximum)
      if (effect) { const pending = effect; effect = null; cleanup = pending() }
      return result
    }
    assert.equal(render().value, 0)
    assert.equal(queued.size, 0, 'offscreen scores wait')
    observer.callback([{ isIntersecting: true }])
    assert.ok(observer.disconnected)
    const tones = new Set()
    let previous = 0
    for (let time = 0; time <= 1600; time += 100) {
      step(time)
      const current = render()
      assert.ok(current.value >= previous && current.value <= 93)
      assert.equal(current.fraction, current.value / 100)
      tones.add(getScoreStatus(current.fraction * 100).tone)
      previous = current.value
    }
    assert.equal(previous, 93)
    assert.deepEqual([...tones], ['poor', 'improvement', 'good', 'excellent'])
    assert.equal(queued.size, 0)
    render(); assert.equal(queued.size, 0, 'unrelated renders do not restart')
    assert.equal(render(null).value, null)
    assert.equal(render().value, 0, 'the same score reloads from zero after being unavailable')
    render(null)
    assert.equal(render(60).value, 0, 'loaded scores start at zero')
    reduced = true
    observer.callback([{ isIntersecting: true }]); step(2000)
    assert.equal(render(60).value, 60)
    assert.equal(render(120, 200).fraction, 0)
    observer.callback([{ isIntersecting: true }]); step(2100)
    assert.equal(render(120, 200).fraction, 0.6)
    reduced = false
    render(80); observer.callback([{ isIntersecting: true }]); step(2200)
    cleanup()
    assert.equal(queued.size, 0, 'unmount cancels pending frames')
  } finally {
    cleanup?.()
    delete globalThis.__scoreHooks
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
  }
})
