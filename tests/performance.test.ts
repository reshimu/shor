import { describe, it, expect } from 'vitest'
import { classify } from '../src/classifier.js'

// v8 coverage instrumentation roughly 2–3x the runtime per call, which
// invalidates wall-clock measurements. The perf gate is enforced in the
// uninstrumented `npm test` run; under coverage we skip it.
const COVERAGE_ON =
  process.env.NODE_V8_COVERAGE !== undefined ||
  process.env.npm_lifecycle_event === 'test:coverage' ||
  process.argv.some(a => a === '--coverage' || a.startsWith('--coverage.'))

describe('performance', () => {
  it.skipIf(COVERAGE_ON)('classifies a ~50k-token context in <50ms p99', () => {
    const seed =
      'Routine status update with no specific numbers. Team members met as scheduled. Various items were discussed. '
    const noise = seed.repeat(Math.ceil(200_000 / seed.length)).slice(0, 200_000)
    const half = Math.floor(noise.length / 2)
    const context =
      noise.slice(0, half) +
      ' The CEO reported Q3 revenue of $4.2M from 47 customers. ' +
      noise.slice(half)
    const output = 'Q3 revenue was $4.2M from 47 customers.'

    // Warmup
    for (let i = 0; i < 10; i++) {
      classify({ output, context })
    }

    const N = 100
    const times: number[] = []
    for (let i = 0; i < N; i++) {
      const t0 = performance.now()
      classify({ output, context })
      times.push(performance.now() - t0)
    }
    times.sort((a, b) => a - b)
    const p50 = times[Math.floor(N * 0.5)]!
    const p99 = times[Math.floor(N * 0.99)] ?? times[times.length - 1]!
    // eslint-disable-next-line no-console
    console.log(`SHOR perf (context ~${context.length} chars): p50=${p50.toFixed(2)}ms p99=${p99.toFixed(2)}ms`)
    expect(p99).toBeLessThan(50)
  }, 60_000)
})
