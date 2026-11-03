import { test } from 'node:test'
import assert from 'node:assert/strict'
import { record, recentTimeline } from '../src/events.js'

test('the timeline follows when things happened in DFNS, not when polling saw them', () => {
    // One poll sees the broadcast first, then the approval that came before it
    record({ kind: 'withdrawal', title: 'broadcasted', at: '2026-11-02T10:00:30Z' })
    record({ kind: 'approval', title: 'approved', at: '2026-11-02T10:00:10.500Z' })
    record({ kind: 'withdrawal', title: 'requested', at: '2026-11-02T10:00:00Z' })
    const titles = recentTimeline().map(e => e.title)
    assert.deepEqual(titles, ['requested', 'approved', 'broadcasted'])
})

test('entries without a DFNS date use the time they were seen', () => {
    const before = new Date().toISOString()
    const e = record({ kind: 'action', title: 'no date' })
    assert.ok(e.at >= before)
    assert.equal(e.at, e.seenAt)
    // An unparseable date falls back too, rather than sorting wrongly
    assert.equal(record({ kind: 'action', title: 'bad date', at: 'not a date' }).at >= before, true)
})
