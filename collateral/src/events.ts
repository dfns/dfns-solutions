import { EventEmitter } from 'events'
import type { Response } from 'express'

export type Actor = 'borrower' | 'lender' | 'risk' | 'system'

export interface TimelineEntry {
    id: number
    at: string
    actor: Actor
    kind: 'dfns' | 'transition' | 'info' | 'error'
    title: string
    loanId?: string
    txHash?: string
    // Raw Dfns request/response, shown in the UI so the API calls stay visible
    request?: unknown
    response?: unknown
}

const MAX_ENTRIES = 300
const timeline: TimelineEntry[] = []
const bus = new EventEmitter()
bus.setMaxListeners(100)
let nextId = 1

export function record(entry: Omit<TimelineEntry, 'id' | 'at'>) {
    const full = { id: nextId++, at: new Date().toISOString(), ...entry }
    timeline.push(full)
    if (timeline.length > MAX_ENTRIES) timeline.shift()
    bus.emit('message', { type: 'timeline', data: full })
    return full
}

// Lightweight live data (price, LTV) that is not worth a timeline entry
export function broadcast(type: string, data: unknown) {
    bus.emit('message', { type, data })
}

export function recentTimeline() {
    return timeline.slice(-100)
}

export function subscribe(res: Response) {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    res.flushHeaders()
    const send = (msg: { type: string; data: unknown }) => {
        res.write(`event: ${msg.type}\ndata: ${JSON.stringify(msg.data)}\n\n`)
    }
    const ping = setInterval(() => res.write(': ping\n\n'), 20000)
    bus.on('message', send)
    res.on('close', () => {
        clearInterval(ping)
        bus.off('message', send)
    })
}
