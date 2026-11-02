// Institutional custody walkthrough: seven stages over live data from the
// backend (npm start). Polls the backend; the backend polls DFNS.
'use strict'

const POLL_MS = 3000
const data = { state: null, timeline: [], config: null, gate: null, approvals: {} }
const $ = id => document.getElementById(id)

// ── Helpers ─────────────────────────────────────────────────────────

// Everything from the backend is escaped before it goes into HTML
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// Wei → ETH, exact (no floats)
function eth(wei) {
    if (wei === undefined || wei === null) return '–'
    const s = BigInt(wei).toString().padStart(19, '0')
    const frac = s.slice(-18).replace(/0+$/, '')
    return `${s.slice(0, -18)}${frac ? '.' + frac : ''} ETH`
}

const short = (id, n = 6) => !id ? '' : id.length > 2 * n + 3 ? `${id.slice(0, n + 2)}…${id.slice(-n)}` : id
const time = iso => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''
const dateTime = iso => iso ? new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' }) : ''
const explorer = () => data.config?.explorer || 'https://sepolia.etherscan.io'
const txLink = h => h ? `<a class="mono" href="${esc(explorer())}/tx/${esc(h)}" target="_blank" rel="noopener">${esc(short(h, 8))}</a>` : '<span class="muted">–</span>'
const addrLink = a => a ? `<a class="mono" href="${esc(explorer())}/address/${esc(a)}" target="_blank" rel="noopener" title="${esc(a)}">${esc(short(a, 6))}</a>` : ''
const raw = (id, v) => { $(id).textContent = JSON.stringify(v, null, 2) }

// Who an approver is, for people watching: the checker or a person
function who(userId) {
    if (data.config?.checkerUserId && userId === data.config.checkerUserId) return `<span class="chip info">checker</span> <span class="mono">${esc(short(userId))}</span>`
    return `<span class="chip good">person</span> <span class="mono">${esc(short(userId))}</span>`
}

const CHIPS = {
    Quarantined: ['warn', 'Quarantined'],
    PendingPolicyApproval: ['info', 'Release requested'],
    Released: ['good', 'Released'],
    Pending: ['info', 'Awaiting approval'],
    Executing: ['info', 'Signing'],
    Broadcasted: ['info', 'Broadcasted'],
    Confirmed: ['good', 'Confirmed'],
    Failed: ['crit', 'Failed'],
    Rejected: ['crit', 'Rejected'],
    Approved: ['good', 'Approved'],
    Denied: ['crit', 'Denied'],
    Expired: ['crit', 'Expired'],
}
const chip = status => { const [k, label] = CHIPS[status] ?? ['info', status]; return `<span class="chip ${k}">${esc(label)}</span>` }

async function get(path) {
    const res = await fetch(path)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    return body
}

async function post(path, body) {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`)
    return out
}

// ── Stepper ─────────────────────────────────────────────────────────

const stages = [...document.querySelectorAll('.stage')]
let current = 0

function buildStepper() {
    $('stepper').innerHTML = stages.map((s, i) =>
        `<button class="step" type="button" data-i="${i}"><span class="n">${i + 1}</span>${esc(s.dataset.title)}<span class="dot" hidden></span></button>`).join('')
    stages.forEach((s, i) => s.insertAdjacentHTML('afterbegin', `<h2>${i + 1}. ${esc(s.dataset.title)}</h2>`))
    $('stepper').addEventListener('click', e => { const b = e.target.closest('.step'); if (b) go(+b.dataset.i) })
    $('prev').onclick = () => go(current - 1)
    $('next').onclick = () => go(current + 1)
    document.addEventListener('keydown', e => {
        if (e.target.closest('input, textarea')) return
        if (e.key === 'ArrowRight') go(current + 1)
        if (e.key === 'ArrowLeft') go(current - 1)
    })
    window.addEventListener('hashchange', () => go(stageFromHash(), false))
    go(stageFromHash(), false)
}

const stageFromHash = () => Math.max(0, Math.min(stages.length - 1, (parseInt(location.hash.replace('#stage-', ''), 10) || 1) - 1))

function go(i, push = true) {
    current = Math.max(0, Math.min(stages.length - 1, i))
    stages.forEach((s, j) => s.classList.toggle('active', j === current))
    document.querySelectorAll('.step').forEach((b, j) => b.classList.toggle('active', j === current))
    $('prev').disabled = current === 0
    $('next').disabled = current === stages.length - 1
    $('where').textContent = `Stage ${current + 1} of ${stages.length}`
    if (push) history.replaceState(null, '', `#stage-${current + 1}`)
}

// A count on a stage's step when something there waits for someone
function badge(i, n) {
    const dot = document.querySelectorAll('.step .dot')[i]
    if (!dot) return
    dot.hidden = !n
    dot.textContent = n || ''
}

// ── Stage 1: the vault and its controls ─────────────────────────────

function renderPolicy(title, p) {
    if (!p) return ''
    if (p.error) return `<div class="card"><h3>${esc(title)}</h3><p class="msg err">${esc(p.error)}</p></div>`
    const groups = p.approvalGroups.map(g => {
        const people = g.anyone ? '<span class="muted">anyone in the organization</span>' : g.approvers.map(who).join('<br>')
        return `<dt>Approvals</dt><dd><b>${esc(g.quorum)}</b> of ${g.anyone ? 'any' : esc(g.approvers.length)}${g.name ? ` <span class="muted">(${esc(g.name)})</span>` : ''}</dd>
                <dt>Approvers</dt><dd>${people}</dd>
                <dt>Requester</dt><dd>${g.initiatorCanApprove ? 'can approve their own' : 'can never approve their own'}</dd>
                <dt>Service accounts</dt><dd>${g.serviceAccountsCanApprove ? 'can vote (the checker)' : 'cannot vote'}</dd>`
    }).join('')
    return `<div class="card"><h3>${esc(title)}</h3><dl class="kv">
        <dt>Policy</dt><dd>${esc(p.name)} <span class="mono muted">${esc(p.id)}</span></dd>
        <dt>Gates</dt><dd class="mono">${esc(p.activityKind)}</dd>
        <dt>Triggers</dt><dd>${p.rule === 'AlwaysTrigger' ? 'every time' : esc(p.rule)}</dd>
        <dt>Scope</dt><dd class="mono">${esc(JSON.stringify(p.filters ?? 'whole organization'))}</dd>
        ${groups}</dl></div>`
}

function gateRules(rules) {
    if (!rules) return '<p class="empty">The gate isn\'t running, so its rules aren\'t known here. Start it with <code>npm run gate</code>.</p>'
    return `<dl class="kv">
        <dt>Operation</dt><dd>signing only${rules.allowKeyExport ? ', key export allowed' : ', key export refused'}</dd>
        <dt>Amount cap</dt><dd>${eth(rules.maxAmountWei)} per transfer, native ETH only</dd>
        <dt>Destinations</dt><dd>${rules.allowlist.length ? rules.allowlist.map(addrLink).join('<br>') : '<span class="msg err">none: every transfer is refused</span>'}</dd>
        <dt>Hours</dt><dd>${rules.hours ? `${esc(rules.hours)} ${esc(rules.timeZone)}` : 'any time'}</dd>
        <dt>Without an intent</dt><dd>${rules.allowNoIntent ? 'allowed' : 'refused (raw signatures)'}</dd></dl>`
}

function renderControls() {
    const c = data.config
    if (!c) { $('p-controls').innerHTML = '<p class="empty">Loading…</p>'; return }
    // The address comes with the first DFNS poll, which may land after the config
    const v = { ...c.vault, ...(data.state?.vault ?? {}) }
    $('p-controls').innerHTML = `<div class="cards">
        <div class="card"><h3>Vault</h3><dl class="kv">
            <dt>ID</dt><dd class="mono">${esc(v.id)}</dd>
            <dt>Tag</dt><dd><span class="chip info">${esc(v.tag)}</span> <span class="muted">policies follow the tag</span></dd>
            <dt>Network</dt><dd>${esc(v.network)}</dd>
            <dt>Address</dt><dd>${v.address ? `${addrLink(v.address)} <span class="mono muted">${esc(v.address)}</span>` : '<span class="muted">loading…</span>'}</dd>
        </dl></div>
        ${renderPolicy('Deposit release', c.policies.quarantine)}
        ${renderPolicy('Withdrawal approval', c.policies.withdrawal)}
        <div class="card"><h3>Validation Gate</h3>${gateRules(data.gate?.running ? data.gate.rules : null)}</div>
    </div>`
    raw('r-controls', { 'GET /api/config': c })
}

// ── Stage 2: deposit and quarantine ─────────────────────────────────

function renderDeposits() {
    const s = data.state
    if (!s) return
    const deposits = (s.deposits ?? []).slice(0, 10)
    badge(1, deposits.filter(d => d.status !== 'Released').length)
    const rows = deposits.map(d => {
        const action = d.status === 'Quarantined'
            ? `<form class="inline release" data-id="${esc(d.quarantineId)}">
                 <label>Reason<input name="reason" required placeholder="Sender known, deposit expected"></label>
                 <button class="primary" type="submit">Release</button></form><div class="msg"></div>`
            : d.status === 'PendingPolicyApproval'
                ? '<span class="hint">A second person approves it in the DFNS dashboard. The requester can\'t.</span>'
                : `<span class="hint">Available since ${esc(dateTime(d.dateReleased))}</span>`
        return `<tr><td>${chip(d.status)}<div class="hint">${esc(dateTime(d.timestamp))}</div></td>
            <td><b>${eth(d.amount)}</b></td>
            <td>${d.senders.map(addrLink).join('<br>') || '<span class="muted">unknown</span>'}</td>
            <td>${txLink(d.txHash)}</td><td>${action}</td></tr>`
    }).join('')
    const addr = s.vault?.address ?? data.config?.vault?.address
    // Don't wipe a reason someone is typing
    if ($('p-deposits').contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return
    $('p-deposits').innerHTML = deposits.length
        ? `<div class="card table-wrap"><table><thead><tr><th>Status</th><th>Amount</th><th>From</th><th>Transaction</th><th>Release</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<p class="empty">No deposits yet. Send Sepolia ETH to ${addr ? `<span class="mono">${esc(addr)}</span>` : 'the vault address'}: it appears here as Quarantined within a few seconds of DFNS seeing it.</p>`
    raw('r-deposits', { 'deposits (List Vault History)': s.deposits, 'pending quarantines (List Vault Quarantines)': s.quarantines })
}

$('p-deposits').addEventListener('submit', async e => {
    const form = e.target.closest('form.release')
    if (!form) return
    e.preventDefault()
    const msg = form.nextElementSibling
    const button = form.querySelector('button')
    button.disabled = true
    try {
        const reason = form.querySelector('[name=reason]')
        const r = await post(`/api/quarantines/${encodeURIComponent(form.dataset.id)}/release`, { reason: reason.value })
        msg.className = 'msg ok'
        msg.textContent = r.status === 'Pending' ? 'Release requested: waiting for a second person to approve it.' : `Release ${r.status}.`
        reason.blur()
    } catch (err) {
        msg.className = 'msg err'
        msg.textContent = err.message
        button.disabled = false
    }
})

// ── Stage 3: safekeeping ────────────────────────────────────────────

const KINDS = [
    ['Available', 'Free to move'],
    ['Quarantined', 'Waiting for release'],
    ['Locked', 'Reserved for an obligation'],
    ['Outgoing', 'In a pending withdrawal'],
    ['Incoming', 'Arriving'],
    ['Fee', 'Reserved for network fees'],
]

function renderBalances() {
    const s = data.state
    if (!s) return
    const ethBalances = s.balances['native:eth'] ?? {}
    $('p-balances').innerHTML = `<div class="big">${KINDS.map(([k, lbl]) => {
        const v = ethBalances[k] ?? '0'
        return `<div class="card${v === '0' ? ' zero' : ''}"><div class="lbl">${esc(k)}</div><div class="amt">${eth(v)}</div><div class="hint">${esc(lbl)}</div></div>`
    }).join('')}</div>
    <p class="hint">Updated ${esc(time(s.updatedAt))}. Other assets: ${Object.keys(s.balances).filter(t => t !== 'native:eth').map(esc).join(', ') || 'none'}.</p>`
    raw('r-balances', { 'balances (List Vault Balances, summed by asset and kind)': s.balances })
}

// ── Stage 4: withdrawal and approval ────────────────────────────────

function decisionsOf(approvalId) {
    const a = approvalId && data.approvals[approvalId]
    if (!a) return approvalId ? '<span class="muted">loading…</span>' : '<span class="muted">no approval needed</span>'
    if (!a.decisions.length) return a.status === 'Pending' ? '<span class="hint">no decision yet</span>' : chip(a.status)
    return a.decisions.map(d => `${chip(d.value)} ${who(d.userId)}${d.reason ? `<div class="hint">“${esc(d.reason)}”</div>` : ''}`).join('<br>')
}

let withdrawFormBuilt = false
function renderWithdraw() {
    const s = data.state
    if (!s) return
    if (!withdrawFormBuilt) {
        const allow = data.gate?.rules?.allowlist?.[0] ?? ''
        $('p-withdraw').innerHTML = `<div class="card"><h3>Request a withdrawal</h3>
            <form class="inline" id="withdraw-form">
              <label>Amount (ETH)<input class="amt" name="amountEth" required inputmode="decimal" value="0.001"></label>
              <label>Destination<input class="addr" name="to" required pattern="0x[0-9a-fA-F]{40}" placeholder="0x…" value="${esc(allow)}"></label>
              <button class="primary" type="submit">Request withdrawal</button>
            </form><div class="msg" id="withdraw-msg"></div>
            <p class="hint">A small amount to an allowlisted address is approved by the checker within seconds. Above its cap, or to another address, it waits for a person.</p></div>
            <div id="withdraw-list"></div>`
        $('withdraw-form').addEventListener('submit', submitWithdrawal)
        withdrawFormBuilt = true
    }
    const pending = s.approvals ?? []
    badge(3, pending.length)
    const recent = (s.withdrawals ?? []).slice(0, 8)
    $('withdraw-list').innerHTML = `
        <div class="card table-wrap"><h3>Waiting for approval</h3>${pending.length
            ? `<table><thead><tr><th>Requested</th><th>What</th><th>Decisions so far</th></tr></thead><tbody>${pending.map(a =>
                `<tr><td>${esc(dateTime(a.dateCreated))}</td><td>${esc(a.summary)}</td><td>${a.decisions.length ? a.decisions.map(d => `${chip(d.value)} ${who(d.userId)}`).join('<br>') : '<span class="hint">none yet</span>'}</td></tr>`).join('')}</tbody></table>`
            : '<p class="empty">Nothing is waiting for approval.</p>'}</div>
        <div class="card table-wrap"><h3>Recent withdrawals: who decided, and why</h3>${recent.length
            ? `<table><thead><tr><th>Status</th><th>Amount</th><th>To</th><th>Requested by</th><th>Decision</th></tr></thead><tbody>${recent.map(w =>
                `<tr><td>${chip(w.status)}<div class="hint">${esc(dateTime(w.dateRequested))}</div></td><td><b>${eth(w.amount)}</b></td><td>${addrLink(w.to)}</td>
                 <td class="mono">${esc(short(w.requester))}</td><td>${decisionsOf(w.approvalId)}</td></tr>`).join('')}</tbody></table>`
            : '<p class="empty">No withdrawals yet.</p>'}</div>`
    raw('r-withdraw', { 'pending approvals (List Approvals)': pending, 'approvals behind recent withdrawals (Get Approval)': recent.map(w => w.approvalId && data.approvals[w.approvalId]).filter(Boolean) })
}

async function submitWithdrawal(e) {
    e.preventDefault()
    const form = e.target
    const msg = $('withdraw-msg')
    const button = form.querySelector('button')
    button.disabled = true
    msg.className = 'msg'
    msg.textContent = 'Requesting…'
    try {
        const field = name => form.querySelector(`[name=${name}]`).value.trim()
        const r = await post('/api/withdrawals', { amountEth: field('amountEth'), to: field('to') })
        msg.className = 'msg ok'
        msg.textContent = `Requested: ${r.transferId} is ${r.status}${r.approvalId ? `, approval ${r.approvalId}` : ''}. Follow it below and in stage 6.`
    } catch (err) {
        msg.className = 'msg err'
        msg.textContent = err.message
    } finally {
        button.disabled = false
    }
}

// Fetch who decided each recent withdrawal's approval; decided ones don't change
async function loadApprovals() {
    const ids = (data.state?.withdrawals ?? []).slice(0, 8).map(w => w.approvalId).filter(Boolean)
    for (const id of ids) {
        const known = data.approvals[id]
        if (known && known.status !== 'Pending') continue
        try { data.approvals[id] = await get(`/api/approvals/${encodeURIComponent(id)}`) } catch { /* shown as loading; retried next poll */ }
    }
}

// ── Stage 5: the Validation Gate ────────────────────────────────────

function renderGate() {
    const g = data.gate
    if (!g) return
    if (!g.running) {
        $('p-gate').innerHTML = `<div class="card"><h3>Gate not running</h3>
            <p>Start it in another terminal with <code>npm run gate</code>, then send it the signer's requests with <code>npm run simulate</code>.</p>
            <p class="hint">The backend looks for it at ${esc(g.url)} (${esc(g.error)}).</p></div>`
        raw('r-gate', { 'GET /api/gate': g })
        return
    }
    const rows = g.decisions.map(d => `<tr><td>${d.approved ? '<span class="chip good">Approved</span>' : '<span class="chip crit">Refused</span>'}<div class="hint">${esc(time(d.at))} · HTTP ${esc(d.status)}</div></td>
        <td>${esc(d.kind ?? '–')}</td><td>${d.amount ? eth(d.amount) : '–'}</td><td>${addrLink(d.to) || '–'}</td><td>${esc(d.reason)}</td></tr>`).join('')
    $('p-gate').innerHTML = `<div class="cards">
        <div class="card"><h3>Rules in force</h3>${gateRules(g.rules)}</div>
        <div class="card"><h3>Where its requests come from</h3>
          <p>A self-hosted DFNS signer calls the gate before every signature (<code>--validation-gate-url</code>). This organization's signer is hosted by DFNS and isn't configured to call it, so the requests below come from the <b>signer simulator</b>. It sends the same JSON and the same HMAC headers, so a real signer would get the same answers.</p>
          <p class="hint">Run <code>npm run simulate</code> to send its six scenarios.</p></div></div>
        <div class="card table-wrap"><h3>Recent decisions</h3>${rows
            ? `<table><thead><tr><th>Answer</th><th>Operation</th><th>Amount</th><th>To</th><th>Reason</th></tr></thead><tbody>${rows}</tbody></table>`
            : '<p class="empty">No requests yet. Run <code>npm run simulate</code>.</p>'}</div>`
    raw('r-gate', { 'GET /api/gate (proxied from the gate\'s GET /decisions)': g })
}

// ── Stage 6: broadcast and confirmation ─────────────────────────────

function renderBroadcast() {
    const s = data.state
    if (!s) return
    const list = (s.withdrawals ?? []).slice(0, 8)
    if (!list.length) {
        $('p-broadcast').innerHTML = '<p class="empty">No withdrawals yet. Request one in stage 4.</p>'
        raw('r-broadcast', [])
        return
    }
    $('p-broadcast').innerHTML = list.map(w => {
        const failed = w.status === 'Failed' || w.status === 'Rejected'
        const steps = [
            ['Requested', w.dateRequested, true],
            ['Approved', w.datePolicyResolved, !!w.datePolicyResolved && w.status !== 'Rejected'],
            ['Broadcasted', w.dateBroadcasted, !!w.dateBroadcasted],
            ['Confirmed', w.dateConfirmed, w.status === 'Confirmed'],
        ]
        const track = steps.map(([label, at, done]) => `<div class="s${done ? ' done' : ''}"><b>${label}</b>${done && at ? esc(time(at)) : ''}</div>`).join('')
            + (failed ? `<div class="s fail"><b>${esc(w.status)}</b>${esc(w.reason ?? '')}</div>` : '')
        return `<div class="card"><h3>${eth(w.amount)} to ${addrLink(w.to)} ${chip(w.status)}</h3>
            <div class="track">${track}</div>
            <p class="hint">Transfer <span class="mono">${esc(w.transferId)}</span> · transaction ${txLink(w.txHash)}</p></div>`
    }).join('')
    raw('r-broadcast', list)
}

// ── Stage 7: audit trail ────────────────────────────────────────────

const KIND_CLASS = { deposit: 'warn', withdrawal: 'good', approval: 'info', action: 'info', error: 'crit' }
const kindChip = kind => `<span class="chip ${KIND_CLASS[kind] ?? 'info'}">${esc(kind)}</span>`

function renderAudit() {
    const tl = [...data.timeline].reverse()
    $('p-audit').innerHTML = `<div class="card"><h3>Ledger export</h3>
        <p>The vault's full history from DFNS (List Vault History): date, kind, amount, asset, counterparty, transaction hash, status and requester.</p>
        <a href="/api/audit.csv" download><button class="primary" type="button" tabindex="-1">Download CSV</button></a></div>
        <div class="card"><h3>Live timeline</h3>${tl.length
            ? `<ul class="tl">${tl.map(e => `<li><span class="t">${esc(time(e.at))}</span><span class="k">${kindChip(e.kind)}</span><span>${esc(e.title)}${e.txHash ? ` · ${txLink(e.txHash)}` : ''}</span></li>`).join('')}</ul>`
            : '<p class="empty">Nothing yet. Status changes appear here as the backend sees them.</p>'}</div>`
    raw('r-audit', { 'GET /api/timeline': data.timeline })
}

// ── Polling ─────────────────────────────────────────────────────────

function banner(errors, offline) {
    const b = $('banner')
    const entries = Object.entries(errors ?? {})
    if (offline) {
        b.innerHTML = `<b>The backend isn't answering.</b> Is <code>npm start</code> still running? (${esc(offline)})`
    } else if (entries.length) {
        b.innerHTML = `<b>Some DFNS data couldn't be refreshed.</b> The rest is live.<ul>${entries.map(([k, v]) => `<li>${esc(k)}: ${esc(v)}</li>`).join('')}</ul>`
    }
    b.hidden = !offline && !entries.length
}

function renderAll() {
    renderControls(); renderDeposits(); renderBalances(); renderWithdraw(); renderGate(); renderBroadcast(); renderAudit()
}

async function tick() {
    try {
        const [state, timeline, gate] = await Promise.all([get('/api/state'), get('/api/timeline'), get('/api/gate')])
        Object.assign(data, { state, timeline, gate })
        await loadApprovals()
        $('live').className = 'live on'
        $('live').textContent = state.updatedAt ? `live · DFNS polled ${time(state.updatedAt)}` : 'live · waiting for the first DFNS poll'
        banner(state.errors)
    } catch (err) {
        $('live').className = 'live off'
        $('live').textContent = 'offline'
        banner(null, err.message)
    }
    renderAll()
}

async function loadConfig() {
    try { data.config = await get('/api/config') } catch (err) { data.config = null; banner(null, err.message) }
}

// ── Theme ───────────────────────────────────────────────────────────

function initTheme() {
    let saved = null
    try { saved = localStorage.getItem('theme') } catch { /* storage may be blocked */ }
    if (saved) document.documentElement.dataset.theme = saved
    $('theme').onclick = () => {
        const dark = document.documentElement.dataset.theme
            ? document.documentElement.dataset.theme === 'dark'
            : matchMedia('(prefers-color-scheme: dark)').matches
        document.documentElement.dataset.theme = dark ? 'light' : 'dark'
        try { localStorage.setItem('theme', document.documentElement.dataset.theme) } catch { /* ignore */ }
    }
}

initTheme()
buildStepper()
loadConfig().then(tick)
setInterval(tick, POLL_MS)
// Policies and the vault address rarely change
setInterval(loadConfig, 60_000)
