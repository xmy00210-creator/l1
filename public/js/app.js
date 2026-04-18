// ==================== 全局状态 ====================
let ws = null;
let currentRoom = 'demo';
let tasks = [];
let selectedTags = [];
let trendChart = null;
let pieChart = null;
let draggedId = null;

const colors = { A: '#fbbf24', B: '#60a5fa', C: '#34d399', D: '#a78bfa', E: '#f472b6' };

// ==================== WebSocket ====================
function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}?room=${currentRoom}`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        updateStatus(true);
        console.log('Connected:', currentRoom);
    };
    
    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
    };
    
    ws.onclose = () => {
        updateStatus(false);
        setTimeout(connect, 3000);
    };
}

function handleMessage(msg) {
    switch (msg.type) {
        case 'init':
            tasks = msg.tasks;
            render();
            break;
        case 'add':
            tasks.push(msg.task);
            render();
            showToast('新任务添加');
            break;
        case 'move':
            const task = tasks.find(t => t.id === msg.taskId);
            if (task) {
                task.status = msg.status;
                task.completedAt = msg.completedAt;
                render();
            }
            break;
        case 'delete':
            tasks = tasks.filter(t => t.id !== msg.taskId);
            render();
            break;
    }
}

function send(msg) {
    if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    }
}

function updateStatus(online) {
    const el = document.getElementById('connStatus');
    el.className = `status ${online ? 'online' : 'offline'}`;
    el.textContent = online ? '实时同步中' : '离线';
}

// ==================== 渲染 ====================
function render() {
    renderColumns();
    updateStats();
    updateCharts();
}

function renderColumns() {
    ['todo', 'doing', 'done'].forEach(status => {
        const container = document.getElementById(`col-${status}`);
        container.innerHTML = '';
        tasks.filter(t => t.status === status).forEach(task => {
            container.appendChild(createTaskCard(task));
        });
    });
    
    document.getElementById('badge-todo').textContent = tasks.filter(t => t.status === 'todo').length;
    document.getElementById('badge-doing').textContent = tasks.filter(t => t.status === 'doing').length;
    document.getElementById('badge-done').textContent = tasks.filter(t => t.status === 'done').length;
}

function createTaskCard(task) {
    const div = document.createElement('div');
    div.className = `task-card task-p-${task.priority}`;
    div.draggable = true;
    div.dataset.id = task.id;
    
    const priorityLabels = {low: '低', med: '中', high: '高'};
    const dateStr = new Date(task.createdAt).toLocaleDateString('zh-CN', {month:'short', day:'numeric'});
    
    div.innerHTML = `
        <div class="task-title">${escapeHtml(task.title)}</div>
        ${task.content ? `<div class="task-content">${escapeHtml(task.content)}</div>` : ''}
        <div class="task-meta">
            <div class="task-tags">
                ${(task.tags || []).map(t => `<span class="task-tag">${t}</span>`).join('')}
                <span class="task-tag priority-${task.priority}">${priorityLabels[task.priority]}</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
                <span style="font-size:11px;color:#9ca3af;">${dateStr}</span>
                <div class="task-assignee" style="background:${colors[task.assignee]};">${task.assignee}</div>
            </div>
        </div>
    `;
    
    div.addEventListener('dragstart', (e) => {
        draggedId = task.id;
        div.classList.add('dragging');
        e.dataTransfer.setData('text/plain', task.id);
    });
    
    div.addEventListener('dragend', () => {
        div.classList.remove('dragging');
        draggedId = null;
    });
    
    // 触摸支持
    div.addEventListener('touchstart', handleTouchStart, {passive: false});
    div.addEventListener('touchmove', handleTouchMove, {passive: false});
    div.addEventListener('touchend', handleTouchEnd);
    
    return div;
}

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ==================== 拖拽 ====================
function handleDragOver(e) {
    e.preventDefault();
    e.currentTarget.style.background = '#eef2ff';
}

function handleDragLeave(e) {
    e.currentTarget.style.background = '';
}

function handleDrop(e, newStatus) {
    e.preventDefault();
    e.currentTarget.style.background = '';
    
    const taskId = e.dataTransfer.getData('text/plain');
    const task = tasks.find(t => t.id === taskId);
    
    if (task && task.status !== newStatus) {
        send({ type: 'move', taskId, status: newStatus });
    }
}

// 触摸拖拽
let touchItem = null;
let touchClone = null;

function handleTouchStart(e) {
    if (e.target.closest('.task-tags')) return;
    touchItem = e.currentTarget;
    touchClone = touchItem.cloneNode(true);
    touchClone.style.cssText = 'position:fixed;opacity:0.9;z-index:10000;pointer-events:none;';
    touchClone.classList.add('dragging');
    document.body.appendChild(touchClone);
    updateTouchPos(e.touches[0]);
}

function handleTouchMove(e) {
    if (!touchClone) return;
    e.preventDefault();
    updateTouchPos(e.touches[0]);
}

function handleTouchEnd(e) {
    if (!touchItem) return;
    const touch = e.changedTouches[0];
    const elem = document.elementFromPoint(touch.clientX, touch.clientY);
    const col = elem?.closest('.column-body');
    
    if (col) {
        const newStatus = col.id.replace('col-', '');
        const task = tasks.find(t => t.id === touchItem.dataset.id);
        if (task && task.status !== newStatus) {
            send({ type: 'move', taskId: task.id, status: newStatus });
        }
    }
    
    touchClone?.remove();
    touchItem = null;
    touchClone = null;
}

function updateTouchPos(touch) {
    if (touchClone) {
        touchClone.style.left = (touch.clientX - touchClone.offsetWidth/2) + 'px';
        touchClone.style.top = (touch.clientY - 30) + 'px';
    }
}

// ==================== 添加任务 ====================
function openModal(status) {
    document.getElementById('taskStatus').value = status;
    document.getElementById('taskModal').classList.add('show');
    document.getElementById('taskTitle').focus();
    selectedTags = [];
    document.querySelectorAll('.tags-select button').forEach(b => b.classList.remove('active'));
}

function closeModal() {
    document.getElementById('taskModal').classList.remove('show');
    document.getElementById('taskForm').reset();
}

function toggleTag(btn, tag) {
    if (selectedTags.includes(tag)) {
        selectedTags = selectedTags.filter(t => t !== tag);
        btn.classList.remove('active');
    } else {
        selectedTags.push(tag);
        btn.classList.add('active');
    }
}

function saveTask(e) {
    e.preventDefault();
    
    const task = {
        title: document.getElementById('taskTitle').value.trim(),
        content: document.getElementById('taskContent').value.trim(),
        assignee: document.getElementById('taskAssignee').value,
        priority: document.getElementById('taskPriority').value,
        status: document.getElementById('taskStatus').value,
        tags: selectedTags.length ? selectedTags : ['任务']
    };
    
    send({ type: 'add', task });
    closeModal();
    showToast('任务已添加');
}

// ==================== 统计图表 ====================
function updateStats() {
    const todo = tasks.filter(t => t.status === 'todo').length;
    const doing = tasks.filter(t => t.status === 'doing').length;
    const done = tasks.filter(t => t.status === 'done').length;
    const total = tasks.length;
    
    document.getElementById('stat-todo').textContent = todo;
    document.getElementById('stat-doing').textContent = doing;
    document.getElementById('stat-done').textContent = done;
    document.getElementById('stat-rate').textContent = total ? Math.round(done/total*100) + '%' : '0%';
}

function initCharts() {
    trendChart = new Chart(document.getElementById('trendChart'), {
        type: 'line',
        data: {
            labels: getLast7Days(),
            datasets: [{
                label: '新增',
                data: [0,0,0,0,0,0,0],
                borderColor: '#6366f1',
                backgroundColor: 'rgba(99,102,241,0.1)',
                fill: true,
                tension: 0.3,
                pointRadius: 2
            }, {
                label: '完成',
                data: [0,0,0,0,0,0,0],
                borderColor: '#10b981',
                backgroundColor: 'rgba(16,185,129,0.1)',
                fill: true,
                tension: 0.3,
                pointRadius: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'top', align: 'end', labels: { boxWidth: 8, font: {size: 10} } } },
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: {size: 9} } },
                x: { grid: { display: false }, ticks: { font: {size: 9} } }
            }
        }
    });
    
    pieChart = new Chart(document.getElementById('pieChart'), {
        type: 'doughnut',
        data: {
            labels: ['待办', '进行中', '已完成'],
            datasets: [{
                data: [0,0,0],
                backgroundColor: ['#f59e0b', '#3b82f6', '#10b981'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '60%',
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 8, font: {size: 10} } } }
        }
    });
}

function updateCharts() {
    if (!trendChart || !pieChart) return;
    
    const trendData = [[], []];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        trendData[0].push(tasks.filter(t => new Date(t.createdAt).toDateString() === d.toDateString()).length);
        trendData[1].push(tasks.filter(t => t.completedAt && new Date(t.completedAt).toDateString() === d.toDateString()).length);
    }
    trendChart.data.datasets[0].data = trendData[0];
    trendChart.data.datasets[1].data = trendData[1];
    trendChart.update();
    
    const todo = tasks.filter(t => t.status === 'todo').length;
    const doing = tasks.filter(t => t.status === 'doing').length;
    const done = tasks.filter(t => t.status === 'done').length;
    pieChart.data.datasets[0].data = [todo, doing, done];
    pieChart.update();
}

function getLast7Days() {
    const days = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        days.push(d.toLocaleDateString('zh-CN', {month:'short', day:'numeric'}));
    }
    return days;
}

// ==================== 工具功能 ====================
function joinRoom() {
    const room = document.getElementById('roomInput').value.trim();
    if (room && room !== currentRoom) {
        currentRoom = room;
        if (ws) ws.close();
        connect();
    }
}

async function exportData() {
    const res = await fetch(`/api/room/${currentRoom}/export`);
    const data = await res.json();
    
    const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `teamflow-${currentRoom}-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function clearAll() {
    if (!confirm('确定清空所有任务？')) return;
    tasks.forEach(t => send({ type: 'delete', taskId: t.id }));
    showToast('看板已清空');
}

function showToast(msg) {
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#1f2937;color:white;padding:12px 20px;border-radius:8px;font-size:14px;z-index:1000;';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
}

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', () => {
    initCharts();
    connect();
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });
});