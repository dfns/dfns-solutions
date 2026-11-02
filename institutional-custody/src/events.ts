// In-memory timeline: one entry per status change or action, newest last.
// It's what the step 6 UI will show, and what a person reads to follow a
// deposit or a withdrawal through its states.
export interface TimelineEntry {
    id: number
    at: string
    kind: 'deposit' | 'withdrawal' | 'approval' | 'action' | 'error'
    // The Dfns object the entry is about (quarantine, transfer, approval id)
    ref?: string
    status?: string
    title: string
    txHash?: string
}

const MAX_ENTRIES = 500
const timeline: TimelineEntry[] = []
let nextId = 1

export function record(entry: Omit<TimelineEntry, 'id' | 'at'>) {
    const full = { id: nextId++, at: new Date().toISOString(), ...entry }
    timeline.push(full)
    if (timeline.length > MAX_ENTRIES) timeline.shift()
    console.log(`  ${full.at.slice(11, 19)} ${full.kind.padEnd(10)} ${full.title}`)
    return full
}

export function recentTimeline(limit = 200) {
    return timeline.slice(-limit)
}
