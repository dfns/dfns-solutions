// In-memory timeline: one entry per status change or action, newest last.
// It's what the step 6 UI will show, and what a person reads to follow a
// deposit or a withdrawal through its states.
export interface TimelineEntry {
    id: number
    // When it happened in DFNS when known (a status date on the transfer or
    // approval), otherwise when the backend saw it
    at: string
    // When the backend saw it
    seenAt: string
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

export function record(entry: Omit<TimelineEntry, 'id' | 'at' | 'seenAt'> & { at?: string }) {
    const seenAt = new Date().toISOString()
    // Normalized, so dates from different sources sort as strings
    const at = entry.at && !isNaN(Date.parse(entry.at)) ? new Date(entry.at).toISOString() : seenAt
    const full = { ...entry, id: nextId++, at, seenAt }
    timeline.push(full)
    if (timeline.length > MAX_ENTRIES) timeline.shift()
    console.log(`  ${full.at.slice(11, 19)} ${full.kind.padEnd(10)} ${full.title}`)
    return full
}

// In the order things happened, not the order polling noticed them: one
// poll can see a withdrawal both approved and broadcasted
export function recentTimeline(limit = 200) {
    return [...timeline].sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id).slice(-limit)
}
