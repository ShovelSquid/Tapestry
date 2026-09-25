/**
 * The person's motion settings as React state (Line Lab v2 wave 6), for the
 * motion panel and for animations that run until told to stop.
 */

import { useSyncExternalStore } from 'react'
import { readMotionSettings, subscribeMotionSettings, type MotionSettings } from './motion'

export function useMotionSettings(): MotionSettings {
  return useSyncExternalStore(subscribeMotionSettings, readMotionSettings, readMotionSettings)
}
