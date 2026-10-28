import type { PerformanceTrackerApi } from './models'

declare global {
  interface Window {
    performanceTracker: PerformanceTrackerApi
  }
}

export {}
