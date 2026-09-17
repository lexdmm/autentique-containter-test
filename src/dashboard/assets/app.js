const MAX_VISIBLE_ENTRIES = 200;
const dashboardModel = window.DashboardModel;

const state = {
    entries: [],
    typeFilter: 'all',
    statusFilter: 'all',
    search: '',
    controller: null,
    reconnectTimer: null,
    reconnectAttempts: 0,
    closed: false,
};

const elements = {
    activityList: document.getElementById('activity-list'),
    connectionLabel: document.getElementById('connection-label'),
    connectionStatus: document.getElementById('connection-status'),
    emptyState: document.getElementById('empty-state'),
    metricErrors: document.getElementById('metric-errors'),
    metricHttp: document.getElementById('metric-http'),
    metricTotal: document.getElementById('metric-total'),
    metricWebhooks: document.getElementById('metric-webhooks'),
    resultCount: document.getElementById('result-count'),
    search: document.getElementById('activity-search'),
    statusFilter: document.getElementById('status-filter'),
    toast: document.getElementById('toast'),
    typeButtons: [...document.querySelectorAll('[data-type]')],
};

function formatTime(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return '--:--:--';
    }

    return new Intl.DateTimeFormat('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).format(date);
}

function setConnection(stateName, label) {
    elements.connectionStatus.dataset.state = stateName;
    elements.connectionLabel.textContent = label;
}

function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add('visible');
    window.setTimeout(() => elements.toast.classList.remove('visible'), 1800);
}

async function copyJson(value) {
    try {
        await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
        showToast('JSON copiado');
    } catch {
        showToast('Não foi possível copiar');
    }
}

function payloadCard(title, value) {
    const card = document.createElement('section');
    const heading = document.createElement('div');
    const label = document.createElement('span');
    const copyButton = document.createElement('button');
    const content = document.createElement('pre');

    card.className = 'payload-card';
    heading.className = 'payload-heading';
    label.textContent = title;
    copyButton.className = 'copy-button';
    copyButton.type = 'button';
    copyButton.textContent = 'Copiar';
    copyButton.addEventListener('click', () => copyJson(value));
    content.textContent = JSON.stringify(value ?? null, null, 2);

    heading.append(label, copyButton);
    card.append(heading, content);

    return card;
}

function activityCard(entry) {
    const article = document.createElement('article');
    const summary = document.createElement('button');
    const type = document.createElement('span');
    const title = document.createElement('span');
    const titleStrong = document.createElement('strong');
    const requestId = document.createElement('small');
    const status = document.createElement('span');
    const time = document.createElement('time');
    const details = document.createElement('div');
    const meta = document.createElement('div');
    const payloads = document.createElement('div');
    const failed = dashboardModel.isFailure(entry);

    article.className = 'activity-item';
    summary.className = 'activity-summary';
    summary.type = 'button';
    summary.setAttribute('aria-expanded', 'false');
    type.className = `type-badge ${entry.type === 'webhook' ? 'webhook' : ''}`;
    type.textContent = entry.type === 'webhook' ? 'Webhook' : 'HTTP';
    title.className = 'activity-title';
    titleStrong.textContent = dashboardModel.eventTitle(entry);
    requestId.textContent = entry.request_id || entry.id;
    status.className = `status-badge ${failed ? 'error' : ''}`;
    status.textContent = dashboardModel.eventStatus(entry);
    time.className = 'activity-time';
    time.dateTime = entry.recorded_at;
    time.textContent = formatTime(entry.recorded_at);
    title.append(titleStrong, requestId);
    summary.append(type, title, status, time);

    details.className = 'activity-details';
    details.hidden = true;
    meta.className = 'detail-meta';
    meta.append(
        document.createTextNode(`Duração: ${entry.duration_ms ?? '—'} ms`),
        document.createTextNode(`Registro: ${entry.recorded_at || '—'}`),
    );
    payloads.className = 'payload-grid';
    payloads.append(payloadCard('Request', entry.request), payloadCard('Response', entry.response));
    details.append(meta, payloads);

    summary.addEventListener('click', () => {
        const expanded = summary.getAttribute('aria-expanded') === 'true';
        summary.setAttribute('aria-expanded', String(!expanded));
        details.hidden = expanded;
    });

    article.append(summary, details);

    return article;
}

function filteredEntries() {
    return dashboardModel.filterEntries(state.entries, {
        type: state.typeFilter,
        status: state.statusFilter,
        search: state.search,
    });
}

function updateMetrics() {
    elements.metricTotal.textContent = state.entries.length;
    elements.metricHttp.textContent = state.entries.filter((entry) => entry.type === 'http').length;
    elements.metricWebhooks.textContent = state.entries.filter((entry) => entry.type === 'webhook').length;
    elements.metricErrors.textContent = state.entries.filter(dashboardModel.isFailure).length;
}

function render() {
    const entries = filteredEntries();
    const fragment = document.createDocumentFragment();

    for (const entry of entries) {
        fragment.append(activityCard(entry));
    }

    elements.activityList.replaceChildren(fragment);
    elements.resultCount.textContent = `${entries.length} ${entries.length === 1 ? 'evento' : 'eventos'}`;
    elements.emptyState.hidden = entries.length > 0;
    elements.activityList.hidden = entries.length === 0;

    const emptyTitle = elements.emptyState.querySelector('h3');
    const emptyCopy = elements.emptyState.querySelector('p');

    if (state.entries.length > 0) {
        emptyTitle.textContent = 'Nenhum evento encontrado';
        emptyCopy.textContent = 'Ajuste os filtros ou o texto da busca para ver outras atividades.';
    } else {
        emptyTitle.textContent = 'Aguardando atividade';
        emptyCopy.textContent = 'Conecte sua aplicação ao mock. Os eventos aparecerão aqui automaticamente.';
    }

    updateMetrics();
}

function replaceEntries(entries) {
    state.entries = entries.slice(0, MAX_VISIBLE_ENTRIES);
    render();
}

function prependEntry(entry) {
    state.entries = [entry, ...state.entries.filter((item) => item.id !== entry.id)]
        .slice(0, MAX_VISIBLE_ENTRIES);
    render();
}

function processFrame(frame) {
    const parsed = dashboardModel.parseSseFrame(frame);

    if (!parsed) {
        return;
    }

    if (parsed.event === 'snapshot' && Array.isArray(parsed.data)) {
        replaceEntries(parsed.data);
    } else if (parsed.event === 'activity') {
        prependEntry(parsed.data);
    }
}

async function consumeStream(body, controller) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (!controller.signal.aborted) {
            const { done, value } = await reader.read();

            if (done) {
                break;
            }

            buffer += decoder.decode(value, { stream: true });
            const extracted = dashboardModel.extractSseFrames(buffer);
            buffer = extracted.remainder;
            extracted.frames.forEach(processFrame);
        }
    } finally {
        reader.releaseLock();
    }
}

function scheduleReconnect() {
    if (state.closed || state.reconnectTimer) {
        return;
    }

    state.reconnectAttempts += 1;
    const delay = Math.min(1000 * (2 ** (state.reconnectAttempts - 1)), 10_000);
    setConnection('disconnected', `Reconectando em ${Math.ceil(delay / 1000)}s`);
    state.reconnectTimer = window.setTimeout(() => {
        state.reconnectTimer = null;
        connect(true);
    }, delay);
}

async function connect(reconnecting = false) {
    state.controller?.abort();
    const controller = new AbortController();
    state.controller = controller;
    setConnection('connecting', reconnecting ? 'Reconectando' : 'Conectando');

    try {
        const response = await fetch('/dashboard/api/stream', { signal: controller.signal });

        if (!response.ok || !response.body) {
            throw new Error(`Stream indisponível (${response.status})`);
        }

        state.reconnectAttempts = 0;
        setConnection('connected', 'Conectado');
        await consumeStream(response.body, controller);

        if (!controller.signal.aborted) {
            scheduleReconnect();
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            scheduleReconnect();
        }
    }
}

elements.search.addEventListener('input', (event) => {
    state.search = event.target.value.trim().toLowerCase();
    render();
});

elements.statusFilter.addEventListener('change', (event) => {
    state.statusFilter = event.target.value;
    render();
});

for (const button of elements.typeButtons) {
    button.addEventListener('click', () => {
        state.typeFilter = button.dataset.type;
        elements.typeButtons.forEach((item) => item.classList.toggle('active', item === button));
        render();
    });
}

window.addEventListener('beforeunload', () => {
    state.closed = true;
    state.controller?.abort();
    window.clearTimeout(state.reconnectTimer);
});

render();
connect();
