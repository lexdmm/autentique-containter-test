const SESSION_KEY = 'autentique-dashboard-token';
const MAX_VISIBLE_ENTRIES = 200;

const state = {
    entries: [],
    token: null,
    typeFilter: 'all',
    statusFilter: 'all',
    search: '',
    controller: null,
    reconnectTimer: null,
    reconnectAttempts: 0,
};

const elements = {
    activityList: document.getElementById('activity-list'),
    connectionLabel: document.getElementById('connection-label'),
    connectionStatus: document.getElementById('connection-status'),
    dashboardView: document.getElementById('dashboard-view'),
    emptyState: document.getElementById('empty-state'),
    loginError: document.getElementById('login-error'),
    loginForm: document.getElementById('login-form'),
    loginView: document.getElementById('login-view'),
    logoutButton: document.getElementById('logout-button'),
    metricErrors: document.getElementById('metric-errors'),
    metricHttp: document.getElementById('metric-http'),
    metricTotal: document.getElementById('metric-total'),
    metricWebhooks: document.getElementById('metric-webhooks'),
    resultCount: document.getElementById('result-count'),
    search: document.getElementById('activity-search'),
    statusFilter: document.getElementById('status-filter'),
    toast: document.getElementById('toast'),
    tokenInput: document.getElementById('dashboard-token'),
    tokenToggle: document.getElementById('token-toggle'),
    typeButtons: [...document.querySelectorAll('[data-type]')],
};

function isFailure(entry) {
    if (entry.type === 'webhook') {
        return entry.response?.delivered === false
            || (entry.response?.status && entry.response.status >= 400);
    }

    return entry.status >= 400;
}

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

function eventTitle(entry) {
    if (entry.type === 'webhook') {
        return entry.event_type || 'Webhook';
    }

    return `${entry.method || 'HTTP'} ${entry.path || ''}`.trim();
}

function eventStatus(entry) {
    if (entry.type === 'webhook') {
        if (entry.response?.status) {
            return String(entry.response.status);
        }

        return entry.response?.delivered ? 'Entregue' : 'Falhou';
    }

    return String(entry.status || '—');
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
    const failed = isFailure(entry);

    article.className = 'activity-item';
    summary.className = 'activity-summary';
    summary.type = 'button';
    summary.setAttribute('aria-expanded', 'false');
    type.className = `type-badge ${entry.type === 'webhook' ? 'webhook' : ''}`;
    type.textContent = entry.type === 'webhook' ? 'Webhook' : 'HTTP';
    title.className = 'activity-title';
    titleStrong.textContent = eventTitle(entry);
    requestId.textContent = entry.request_id || entry.id;
    status.className = `status-badge ${failed ? 'error' : ''}`;
    status.textContent = eventStatus(entry);
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
    return state.entries.filter((entry) => {
        const matchesType = state.typeFilter === 'all' || entry.type === state.typeFilter;
        const result = isFailure(entry) ? 'error' : 'success';
        const matchesStatus = state.statusFilter === 'all' || result === state.statusFilter;
        const matchesSearch = !state.search
            || JSON.stringify(entry).toLowerCase().includes(state.search);

        return matchesType && matchesStatus && matchesSearch;
    });
}

function updateMetrics() {
    elements.metricTotal.textContent = state.entries.length;
    elements.metricHttp.textContent = state.entries.filter((entry) => entry.type === 'http').length;
    elements.metricWebhooks.textContent = state.entries.filter((entry) => entry.type === 'webhook').length;
    elements.metricErrors.textContent = state.entries.filter(isFailure).length;
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
    const lines = frame.split('\n');
    const eventName = lines.find((line) => line.startsWith('event: '))?.slice(7);
    const data = lines
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6))
        .join('\n');

    if (!eventName || !data) {
        return;
    }

    const parsed = JSON.parse(data);

    if (eventName === 'snapshot' && Array.isArray(parsed)) {
        replaceEntries(parsed);
    } else if (eventName === 'activity') {
        prependEntry(parsed);
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
            const frames = buffer.split('\n\n');
            buffer = frames.pop();

            for (const frame of frames) {
                processFrame(frame);
            }
        }
    } finally {
        reader.releaseLock();
    }
}

function enterDashboard() {
    elements.loginView.hidden = true;
    elements.dashboardView.hidden = false;
    elements.loginError.textContent = '';
}

function showLogin(message = '') {
    elements.dashboardView.hidden = true;
    elements.loginView.hidden = false;
    elements.loginError.textContent = message;
    elements.tokenInput.focus();
}

function scheduleReconnect() {
    if (!state.token || state.reconnectTimer) {
        return;
    }

    state.reconnectAttempts += 1;
    const delay = Math.min(1000 * (2 ** (state.reconnectAttempts - 1)), 10_000);
    setConnection('disconnected', `Reconectando em ${Math.ceil(delay / 1000)}s`);
    state.reconnectTimer = window.setTimeout(() => {
        state.reconnectTimer = null;
        connect(state.token, true);
    }, delay);
}

async function connect(token, reconnecting = false) {
    if (!token) {
        showLogin('Informe o token do painel.');

        return false;
    }

    state.controller?.abort();
    const controller = new AbortController();
    state.controller = controller;
    setConnection('connecting', reconnecting ? 'Reconectando' : 'Conectando');

    try {
        const response = await fetch('/dashboard/api/stream', {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
        });

        if (response.status === 401) {
            sessionStorage.removeItem(SESSION_KEY);
            state.token = null;
            showLogin('Token inválido. Confira o valor de DASHBOARD_TOKEN.');

            return false;
        }

        if (!response.ok || !response.body) {
            throw new Error(`Stream indisponível (${response.status})`);
        }

        state.token = token;
        state.reconnectAttempts = 0;
        sessionStorage.setItem(SESSION_KEY, token);
        enterDashboard();
        setConnection('connected', 'Conectado');

        consumeStream(response.body, controller)
            .then(() => {
                if (!controller.signal.aborted && state.token) {
                    scheduleReconnect();
                }
            })
            .catch((error) => {
                if (error.name !== 'AbortError' && state.token) {
                    scheduleReconnect();
                }
            });

        return true;
    } catch (error) {
        if (error.name === 'AbortError') {
            return false;
        }

        if (reconnecting) {
            scheduleReconnect();
        } else {
            showLogin('Não foi possível conectar ao monitor. Tente novamente.');
        }

        return false;
    }
}

function logout() {
    state.token = null;
    state.entries = [];
    state.controller?.abort();
    state.controller = null;
    window.clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
    sessionStorage.removeItem(SESSION_KEY);
    elements.tokenInput.value = '';
    render();
    showLogin();
}

elements.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = elements.loginForm.querySelector('[type="submit"]');
    const token = elements.tokenInput.value.trim();

    button.disabled = true;
    button.textContent = 'Conectando…';
    await connect(token);
    button.disabled = false;
    button.textContent = 'Abrir monitor';
});

elements.tokenToggle.addEventListener('click', () => {
    const revealing = elements.tokenInput.type === 'password';
    elements.tokenInput.type = revealing ? 'text' : 'password';
    elements.tokenToggle.textContent = revealing ? 'Ocultar' : 'Mostrar';
    elements.tokenToggle.setAttribute('aria-label', revealing ? 'Ocultar token' : 'Mostrar token');
});

elements.logoutButton.addEventListener('click', logout);

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

window.addEventListener('beforeunload', () => state.controller?.abort());
render();

const storedToken = sessionStorage.getItem(SESSION_KEY);
if (storedToken) {
    connect(storedToken);
}
